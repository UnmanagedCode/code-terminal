// Real bash and zsh from PATH, started with the spec shellLaunch builds, over
// pipes (no cc, no pty). A temp HOME carries user startup files that try to
// take HISTFILE back.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { createShellLaunch } from '../lib/shellLaunch.js';
import { createCcClient } from '../lib/ccClient.js';
import { startFakeCc, runForReal } from './fakeCc.mjs';
import { tmpDir, until } from './helpers.mjs';

const which = (bin) => { try { return execFileSync('sh', ['-c', `command -v ${bin}`], { encoding: 'utf8' }).trim(); } catch { return ''; } };

class Shell {
  constructor(argv, env) {
    this.out = '';
    this.n = 0;
    this.proc = spawn(argv[0], argv.slice(1), { env, stdio: ['pipe', 'pipe', 'pipe'] });
    this.proc.stdout.on('data', (d) => { this.out += d.toString('utf8'); });
    this.proc.stderr.on('data', () => {});
  }
  // Runs `cmd` and resolves its stdout once the shell has printed a marker after it.
  async run(cmd) {
    const mark = `__mark_${++this.n}__`;
    const from = this.out.length;
    this.proc.stdin.write(`${cmd}\necho ${mark}\n`);
    await until(() => this.out.includes(mark, from), 10000, `${mark} after ${cmd}`);
    return this.out.slice(from, this.out.indexOf(mark, from));
  }
  close() { this.proc.stdin.end(); this.proc.kill('SIGKILL'); }
}

async function setup(shellPath) {
  const home = tmpDir('code-terminal-home-');
  const dataDir = tmpDir();
  // User files that point history elsewhere, the way a dotfile repo would.
  fs.writeFileSync(path.join(home, '.profile'), '[ -n "$BASH_VERSION" ] && [ -r "$HOME/.bashrc" ] && . "$HOME/.bashrc"\n');
  fs.writeFileSync(path.join(home, '.bashrc'), 'HISTFILE=$HOME/.bash_history; export HISTFILE; PROMPT_COMMAND="history -a"\n');
  fs.writeFileSync(path.join(home, '.zshrc'), 'HISTFILE=$HOME/.zsh_history; SAVEHIST=0; unsetopt SHARE_HISTORY\n');
  const env = { PATH: process.env.PATH, HOME: home, SHELL: shellPath, TERM: 'dumb', LANG: 'C.UTF-8' };
  // A target whose login shell is `shellPath`: the installer's report is rewritten to say so.
  const fake = await startFakeCc({
    exec: async (body) => {
      const r = await runForReal({ ...body, env: { ...env, ...body.env } });
      r.body.stdout = r.body.stdout.replace(/^shell=.*$/m, `shell=${shellPath}`);
      return r;
    },
  });
  const launch = createShellLaunch({ cc: createCcClient(fake.url), dataDir });
  const start = async (project) => {
    const spec = await launch.specFor({ project, worktree: null, cols: 80, rows: 24, system: 'local', remoteId: null });
    // A pty makes the shell interactive by itself; over pipes zsh needs -i.
    const argv = [...spec.argv];
    if (!argv.includes('-i')) argv.push('-i');
    const sh = new Shell(argv, { ...env, ...spec.env });
    sh.histfile = spec.env.HISTFILE;
    await sh.run('true');
    return sh;
  };
  return { home, start, close: () => fake.close() };
}

for (const name of ['bash', 'zsh']) {
  const shellPath = which(name);
  test(`${name}: history is per project, shared live between shells of a project, and the user's files cannot redirect it`,
    { skip: shellPath ? false : `${name} is not on PATH` }, async () => {
      const ctx = await setup(shellPath);
      const shells = [];
      try {
        const listHistory = name === 'bash' ? 'history' : 'fc -ln 1';
        const running = await ctx.start('alpha');
        shells.push(running);
        const a1 = await ctx.start('alpha');
        shells.push(a1);
        const nonce = `only-in-alpha-${process.pid}-${Date.now()}`;
        await a1.run(`echo ${nonce} >/dev/null`);

        // A running shell of the same project sees it after its next prompt.
        await running.run('');
        assert.match(await running.run(listHistory), new RegExp(nonce));

        // A new shell of the same project starts with it.
        const a2 = await ctx.start('alpha');
        shells.push(a2);
        assert.match(await a2.run(listHistory), new RegExp(nonce));

        // Another project never sees it.
        const b = await ctx.start('beta');
        shells.push(b);
        assert.doesNotMatch(await b.run(listHistory), new RegExp(nonce));

        assert.match(fs.readFileSync(a1.histfile, 'utf8'), new RegExp(nonce));
        assert.notEqual(a1.histfile, b.histfile);
        for (const f of ['.bash_history', '.zsh_history']) {
          const p = path.join(ctx.home, f);
          assert.ok(!fs.existsSync(p) || !fs.readFileSync(p, 'utf8').includes(nonce), `${f} must not get the command`);
        }
      } finally {
        for (const s of shells) s.close();
        await ctx.close();
      }
    });
}
