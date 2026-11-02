// A throwaway code-conductor for the real-cc tests and the Playwright scenarios.
// It never touches the user's own cc: a `--no-hardlinks` clone of the cc
// checkout at a pinned commit, started isolated (its own projects root, Claude
// config dir, port and a temp HOME, with a sanitized environment), with a copy
// of this worktree adopted as the code-terminal plugin. Teardown stops the
// plugin and kills only the cc pid it verified as this scratch instance.
//
// Needs CC_PROJECTS_ROOT (the directory holding the code-conductor checkout).
import { execFileSync, spawn } from 'node:child_process';
import fs from 'node:fs';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// The cc commit whose `GET /api/terminal` and plugin manifest rules (`menuItems`) this plugin is built against;
// it must also pass `CONDUCTOR_PLUGIN_DATA_DIR` to the plugin backend.
export const CC_COMMIT = '32f0b60d';
export const PLUGIN_ID = 'code-terminal';
const BOOT_TIMEOUT_MS = 240_000;
const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const sh = (cmd, args, opts = {}) => execFileSync(cmd, args, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], ...opts });

async function freePort() {
  const srv = net.createServer();
  await new Promise((r) => srv.listen(0, '127.0.0.1', r));
  const { port } = srv.address();
  await new Promise((r) => srv.close(r));
  return port;
}

function linkNodeModules(from, to) {
  fs.mkdirSync(path.join(to, 'node_modules'));
  for (const e of fs.readdirSync(path.join(from, 'node_modules'))) {
    fs.symlinkSync(path.join(from, 'node_modules', e), path.join(to, 'node_modules', e));
  }
}

// The worktree's tracked and unignored files, copied into a fresh git repo.
function copyPlugin(dest) {
  const files = sh('git', ['ls-files', '-co', '--exclude-standard', '-z'], { cwd: repo }).split('\0').filter(Boolean);
  for (const f of files) {
    const src = path.join(repo, f);
    if (!fs.existsSync(src) || fs.lstatSync(src).isSymbolicLink()) continue;
    fs.mkdirSync(path.dirname(path.join(dest, f)), { recursive: true });
    fs.copyFileSync(src, path.join(dest, f));
  }
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(dest, 'node_modules'));
  const git = (...a) => sh('git', ['-c', 'user.name=scratch', '-c', 'user.email=scratch@localhost', ...a], { cwd: dest });
  git('init', '-q');
  git('add', '-A');
  git('commit', '-qm', 'scratch copy');
  sh('npm', ['run', 'prepare'], { cwd: dest });
}

export async function startScratchCc({ log = (m) => console.error(`[scratch-cc] ${m}`) } = {}) {
  const projectsRoot = process.env.CC_PROJECTS_ROOT;
  if (!projectsRoot) throw new Error('CC_PROJECTS_ROOT is not set: export the absolute projects root');
  const ccSource = path.join(projectsRoot, 'code-conductor');
  const tmp = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'code-terminal-scratch-')));
  const ccDir = path.join(tmp, 'cc');
  const home = path.join(tmp, 'home');
  fs.mkdirSync(home);

  log(`cloning cc at ${CC_COMMIT} into ${ccDir}`);
  sh('git', ['clone', '-q', '--no-hardlinks', ccSource, ccDir]);
  sh('git', ['checkout', '-q', CC_COMMIT], { cwd: ccDir });
  linkNodeModules(ccSource, ccDir);

  const port = await freePort();
  const env = {
    PATH: process.env.PATH, HOME: home, USER: process.env.USER ?? os.userInfo().username, LANG: 'C.UTF-8', TERM: 'xterm-256color',
    PORT: String(port), CC_ISOLATED_ROOT: tmp, ORCH_DISABLE_MCP_AUTOREGISTER: '1',
  };
  const logFile = path.join(tmp, 'cc.log');
  const out = fs.openSync(logFile, 'a');
  log(`starting cc on port ${port} (log ${logFile})`);
  const child = spawn('scripts/run-isolated.sh', [], { cwd: ccDir, env, stdio: ['ignore', out, out], detached: true });
  child.unref();
  const url = `http://127.0.0.1:${port}`;

  async function api(method, p, body) {
    const res = await fetch(`${url}${p}`, {
      method,
      ...(body !== undefined ? { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(120_000),
    });
    const text = await res.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* streaming or text */ }
    if (!res.ok) throw new Error(`${method} ${p} → ${res.status}: ${text.slice(0, 2000)}`);
    return json ?? text;
  }

  const deadline = Date.now() + BOOT_TIMEOUT_MS;
  for (;;) {
    try {
      const r = await fetch(`${url}/api/projects`, { signal: AbortSignal.timeout(5000) });
      if (r.ok) break;
    } catch { /* not up yet */ }
    if (child.exitCode !== null) throw new Error(`scratch cc exited ${child.exitCode}; see ${logFile}`);
    if (Date.now() > deadline) throw new Error(`scratch cc did not come up in ${BOOT_TIMEOUT_MS} ms; see ${logFile}`);
    await new Promise((r) => setTimeout(r, 500));
  }

  const pluginDir = path.join(tmp, 'plugin', PLUGIN_ID);
  let ccAlive = true;
  const scratch = {
    url, port, tmp, home, ccDir, pluginDir, logFile,
    dataDir: path.join(tmp, 'projects', '.code-conductor', 'plugins', 'data', PLUGIN_ID), pid: child.pid, api,
    pluginBase: `${url}/plugins/${PLUGIN_ID}/`,
    // The plugin backend's {port, pid}, remembered so teardown can stop it once cc is gone.
    plugin: null,
    async pluginRuntime() {
      const row = await api('GET', `/api/plugins/${PLUGIN_ID}/status`);
      scratch.plugin = { port: row.port, pid: row.pid };
      return scratch.plugin;
    },
    // Kills the scratch cc, after proving the pid is this instance: its cwd is
    // the clone and its environment names this port and isolated root.
    killCc() {
      const pid = scratch.pid;
      let cwd;
      let environ;
      try {
        cwd = fs.readlinkSync(`/proc/${pid}/cwd`);
        environ = fs.readFileSync(`/proc/${pid}/environ`, 'utf8').split('\0');
      } catch { return false; }
      if (cwd !== ccDir || !environ.includes(`PORT=${port}`) || !environ.includes(`CC_ISOLATED_ROOT=${tmp}`)) {
        throw new Error(`refusing to kill pid ${pid}: it is not the scratch cc (cwd ${cwd})`);
      }
      process.kill(pid, 'SIGTERM');
      ccAlive = false;
      return true;
    },
    async stop() {
      if (ccAlive) {
        try { await api('POST', `/api/plugins/${PLUGIN_ID}/stop`); } catch (e) { log(`plugin stop: ${e.message}`); }
        scratch.killCc();
      } else if (scratch.plugin?.pid) {
        // cc is gone, so nothing else stops the backend: its process group, once its cwd proves it is ours.
        let cwd = null;
        try { cwd = fs.readlinkSync(`/proc/${scratch.plugin.pid}/cwd`); } catch { /* already gone */ }
        if (cwd === pluginDir) process.kill(-scratch.plugin.pid, 'SIGTERM');
        else if (cwd) log(`not stopping pid ${scratch.plugin.pid}: cwd ${cwd} is not the scratch plugin`);
      }
      if (!process.env.KEEP_SCRATCH) fs.rmSync(tmp, { recursive: true, force: true });
      else log(`kept ${tmp}`);
    },
  };

  try {
    log(`copying the plugin to ${pluginDir}`);
    copyPlugin(pluginDir);
    await api('POST', '/api/projects/external', { name: PLUGIN_ID, path: pluginDir });
    await api('POST', '/api/plugins/rescan');
    await api('POST', `/api/plugins/${PLUGIN_ID}/enable`);
    await api('POST', `/api/plugins/${PLUGIN_ID}/start`);
    for (const name of ['alpha', 'beta']) await api('POST', '/api/projects', { name, noProjectConventions: true });
  } catch (e) {
    await scratch.stop();
    throw e;
  }
  return scratch;
}

// Registers a System served by cc's reference provider (extra `args`, e.g. `--no-pty`)
// and creates project `name` on it; returns the project's path.
export async function addProviderProject(scratch, { system, name, args = [] }) {
  await scratch.api('POST', '/api/settings/systems', {
    id: system, label: system, launch: [process.execPath, path.join(scratch.ccDir, 'src/systems/referenceProvider.ts'), ...args],
  });
  const systemPath = path.join(scratch.tmp, 'remote', name);
  fs.mkdirSync(path.dirname(systemPath), { recursive: true });
  await scratch.api('POST', '/api/projects', { name, system, systemPath, noProjectConventions: true });
  return systemPath;
}

// Creates worktree `name` of `project` through cc's MCP `create_worktree`, giving
// the project a first commit when it has none; returns {name, path}.
export async function createWorktree(scratch, project, name) {
  const row = (await scratch.api('GET', '/api/projects')).find((p) => p.name === project);
  if (!row) throw new Error(`no project ${project} in the scratch cc`);
  const git = (...a) => sh('git', ['-c', 'user.name=scratch', '-c', 'user.email=scratch@localhost', ...a], { cwd: row.path });
  try { git('rev-parse', '--verify', 'HEAD'); } catch { git('commit', '--allow-empty', '-qm', 'scratch'); }
  const res = await fetch(`${scratch.url}/mcp`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/call', params: { name: 'create_worktree', arguments: { project, name } } }),
    signal: AbortSignal.timeout(120_000),
  });
  const body = await res.json();
  if (!res.ok || body.error || body.result?.isError) throw new Error(`create_worktree failed: ${JSON.stringify(body).slice(0, 2000)}`);
  const made = (await scratch.api('GET', `/api/projects/${encodeURIComponent(project)}/worktrees`)).find((w) => w.worktreeName.includes(name));
  if (!made) throw new Error(`worktree ${name} not listed after create_worktree`);
  return { name: made.worktreeName, path: made.worktreePath };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  // Manual use: boot one, print where, stop on Ctrl+C.
  const s = await startScratchCc();
  console.log(`scratch cc: ${s.url}  plugin: ${s.pluginBase}  root: ${s.tmp}`);
  process.once('SIGINT', () => { void s.stop().then(() => process.exit(0)); });
}
