// The program a terminal runs, and the per-project history it gets
// (docs/architecture.md → Shell integration). One `POST /api/exec` per System
// installs the integration files and reports the login shell; `buildSpec` then
// turns that into the spec cc's `GET /api/terminal` opens.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Refusal } from './refusal.js';

const SHELL_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'shell');
// The integration files, as paths under the installed directory.
const INTEGRATION_FILES = ['bashrc', 'zsh/.zshenv', 'zsh/.zprofile', 'zsh/.zshrc', 'zsh/.zlogin'];
const INSTALL_TIMEOUT_MS = 30_000;

// Every key the spec sent to cc may carry, and every env name in it. These are
// paths and names only: the spec rides cc's request line, which may be logged.
export const SPEC_KEYS = ['project', 'worktree', 'cols', 'rows', 'term', 'argv', 'env'];
export const SPEC_ENV_KEYS = ['HISTFILE', 'CODE_TERMINAL_HISTFILE', 'ZDOTDIR', 'COLORTERM'];

// cc's project NAME_RE, and never `.` or `..`: the name becomes a path segment.
const NAME_RE = /^[a-zA-Z0-9._-]+$/;
export const validProjectName = (name) => typeof name === 'string' && NAME_RE.test(name) && name !== '.' && name !== '..';

function loadIntegration() {
  const files = INTEGRATION_FILES.map((rel) => [rel, fs.readFileSync(path.join(SHELL_DIR, rel), 'utf8')]);
  const hash = crypto.createHash('sha256');
  for (const [rel, body] of files) hash.update(`${rel}\0${body}\0`);
  return { installer: fs.readFileSync(path.join(SHELL_DIR, 'install.sh'), 'utf8'), files, hash: hash.digest('hex').slice(0, 16) };
}

// The spec for one terminal. `shell` is the target's login shell, `base` the
// data directory on the target, `dir` the installed integration directory.
export function buildSpec({ shell, base, dir, project, worktree, cols, rows }) {
  const histfile = `${base}/history/${project}`;
  const env = { HISTFILE: histfile, CODE_TERMINAL_HISTFILE: histfile, COLORTERM: 'truecolor' };
  let argv;
  const name = path.posix.basename(shell);
  if (name === 'bash') {
    argv = [shell, '--init-file', `${dir}/bashrc`, '-i'];
  } else if (name === 'zsh') {
    argv = [shell, '-l'];
    env.ZDOTDIR = `${dir}/zsh`;
  }
  return { project, worktree, cols, rows, term: 'xterm-256color', ...(argv ? { argv } : {}), env };
}

const setupFailed = (system, why, status = 502) =>
  new Refusal(status, 'SHELL_SETUP_FAILED', `shell setup on system '${system}' failed: ${why}`);

function parseReport(stdout) {
  const out = {};
  for (const line of stdout.split('\n')) {
    const eq = line.indexOf('=');
    if (eq > 0) out[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return out;
}

export function createShellLaunch({ cc, dataDir }) {
  const integration = loadIntegration();
  // `(system, remoteId)` → the install's promise; a failure is forgotten so the next open retries.
  const installs = new Map();

  async function install(project, system) {
    // Local data lives in the plugin's data dir; elsewhere under the target user's $HOME.
    const base = system === 'local' ? dataDir : '';
    const argv = ['sh', '-c', integration.installer, 'sh', base, integration.hash, ...integration.files.flat()];
    let r;
    try {
      r = await cc.exec({ project, argv, timeoutMs: INSTALL_TIMEOUT_MS });
    } catch (e) {
      throw setupFailed(system, e.error ?? e.message, e.status ?? 502);
    }
    if (r.exitCode !== 0) throw setupFailed(system, `the installer exited ${r.exitCode}: ${String(r.stderr).trim().slice(0, 2000)}`);
    const rep = parseReport(String(r.stdout));
    if (!rep.shell?.startsWith('/') || !rep.base?.startsWith('/')) {
      throw setupFailed(system, `the installer's report is unreadable: ${JSON.stringify(String(r.stdout).slice(0, 500))}`);
    }
    return { shell: rep.shell, base: rep.base, dir: `${rep.base}/shell/${integration.hash}` };
  }

  return {
    async specFor({ project, worktree, cols, rows, system, remoteId }) {
      if (!validProjectName(project)) throw new Refusal(400, 'INVALID_ARGUMENT', `project name ${JSON.stringify(project)} is not usable as a history file name`);
      const key = JSON.stringify([system, remoteId ?? null]);
      if (!installs.has(key)) {
        installs.set(key, install(project, system).catch((e) => { installs.delete(key); throw e; }));
      }
      return buildSpec({ ...(await installs.get(key)), project, worktree, cols, rows });
    },
  };
}
