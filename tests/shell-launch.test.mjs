import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { buildSpec, createShellLaunch, validProjectName, SPEC_KEYS, SPEC_ENV_KEYS } from '../lib/shellLaunch.js';
import { createCcClient } from '../lib/ccClient.js';
import { startFakeCc, runForReal } from './fakeCc.mjs';
import { tmpDir } from './helpers.mjs';

const at = { base: '/data', dir: '/data/shell/abc', project: 'alpha', worktree: null, cols: 80, rows: 24 };

test('bash runs interactive with the integration init file and the project HISTFILE', () => {
  const s = buildSpec({ ...at, shell: '/usr/bin/bash' });
  assert.deepEqual(s.argv, ['/usr/bin/bash', '--init-file', '/data/shell/abc/bashrc', '-i']);
  assert.equal(s.env.HISTFILE, '/data/history/alpha');
  assert.equal(s.env.ZDOTDIR, undefined);
});

test('zsh runs as a login shell with ZDOTDIR on the wrapper directory', () => {
  const s = buildSpec({ ...at, shell: '/bin/zsh' });
  assert.deepEqual(s.argv, ['/bin/zsh', '-l']);
  assert.equal(s.env.ZDOTDIR, '/data/shell/abc/zsh');
  assert.equal(s.env.HISTFILE, '/data/history/alpha');
});

test("any other shell gets cc's default login shell (no argv) and HISTFILE only", () => {
  const s = buildSpec({ ...at, shell: '/usr/bin/fish' });
  assert.equal(s.argv, undefined);
  assert.equal(s.env.HISTFILE, '/data/history/alpha');
});

test('projects A and B get different HISTFILEs; worktrees of one project share one', () => {
  const a = buildSpec({ ...at, shell: '/bin/bash' });
  const b = buildSpec({ ...at, project: 'beta', shell: '/bin/bash' });
  const aw = buildSpec({ ...at, worktree: 'feature', shell: '/bin/bash' });
  assert.notEqual(a.env.HISTFILE, b.env.HISTFILE);
  assert.equal(a.env.HISTFILE, aw.env.HISTFILE);
  assert.equal(aw.worktree, 'feature');
});

test('the spec sent to cc carries exactly the allowed keys, and env only paths and names', () => {
  for (const shell of ['/bin/bash', '/bin/zsh', '/bin/sh']) {
    const s = buildSpec({ ...at, shell });
    for (const k of Object.keys(s)) assert.ok(SPEC_KEYS.includes(k), `${shell}: spec key ${k}`);
    for (const k of Object.keys(s.env)) assert.ok(SPEC_ENV_KEYS.includes(k), `${shell}: env key ${k}`);
    assert.equal(s.term, 'xterm-256color');
    assert.equal(s.env.COLORTERM, 'truecolor');
  }
  assert.deepEqual([...SPEC_KEYS].sort(), ['argv', 'cols', 'env', 'project', 'rows', 'term', 'worktree']);
  assert.deepEqual([...SPEC_ENV_KEYS].sort(), ['CODE_TERMINAL_HISTFILE', 'COLORTERM', 'HISTFILE', 'ZDOTDIR']);
});

test('a project name of . or .., or one with a slash or other path characters, is refused', async () => {
  for (const name of ['.', '..', 'a/b', '../x', 'a\\b', '', 'a b', 'a\0b']) assert.equal(validProjectName(name), false, JSON.stringify(name));
  for (const name of ['alpha', '.conduct', 'a.b-c_d', 'A1']) assert.equal(validProjectName(name), true, name);
  const launch = createShellLaunch({ cc: { exec: () => assert.fail('no exec for a refused name') }, dataDir: '/nowhere' });
  await assert.rejects(launch.specFor({ project: '..', worktree: null, cols: 80, rows: 24, system: 'local', remoteId: null }), (e) => e.status === 400);
});

test('the installer writes the integration files privately and reports the login shell', async () => {
  const dataDir = tmpDir();
  const fake = await startFakeCc({ exec: (body) => runForReal({ ...body, env: { ...body.env, SHELL: '/bin/zsh-not-used' } }) });
  try {
    const launch = createShellLaunch({ cc: createCcClient(fake.url), dataDir });
    const spec = await launch.specFor({ project: 'alpha', worktree: null, cols: 80, rows: 24, system: 'local', remoteId: null });
    assert.equal(spec.env.HISTFILE, path.join(dataDir, 'history', 'alpha'));
    const shellDir = path.join(dataDir, 'shell');
    const [hash] = fs.readdirSync(shellDir);
    for (const f of ['bashrc', 'zsh/.zshenv', 'zsh/.zprofile', 'zsh/.zshrc', 'zsh/.zlogin']) {
      const st = fs.statSync(path.join(shellDir, hash, f));
      assert.equal(st.mode & 0o077, 0, `${f} is private`);
    }
    assert.equal(fs.statSync(path.join(dataDir, 'history')).mode & 0o077, 0);
    // The shell is the passwd entry's, as cc's own default.
    const passwd = (await import('node:os')).userInfo().shell;
    if (passwd) assert.equal(spec.argv?.[0] ?? passwd, passwd);
    // A second open on the same System does not reinstall.
    await launch.specFor({ project: 'beta', worktree: null, cols: 80, rows: 24, system: 'local', remoteId: null });
    assert.equal(fake.execs.length, 1);
    // The installer itself rides argv, not stdin.
    assert.equal(fake.execs[0].stdin, undefined);
    assert.deepEqual(fake.execs[0].argv.slice(0, 2), ['sh', '-c']);
  } finally { await fake.close(); }
});

test('a remote System installs under $HOME/.local/state/code-terminal', async () => {
  const home = tmpDir();
  const fake = await startFakeCc({ exec: (body) => runForReal({ ...body, env: { ...body.env, HOME: home } }) });
  try {
    const launch = createShellLaunch({ cc: createCcClient(fake.url), dataDir: '/must-not-be-used' });
    const spec = await launch.specFor({ project: 'alpha', worktree: null, cols: 80, rows: 24, system: 'box', remoteId: null });
    assert.equal(spec.env.HISTFILE, path.join(home, '.local/state/code-terminal/history/alpha'));
    assert.ok(fs.existsSync(path.join(home, '.local/state/code-terminal/shell')));
  } finally { await fake.close(); }
});

test('a failed install refuses the open loudly with SHELL_SETUP_FAILED, and is retried next time', async () => {
  let fail = true;
  const fake = await startFakeCc({ exec: async (body) => (fail ? { status: 200, body: { exitCode: 1, stdout: '', stderr: 'mkdir: Permission denied' } } : runForReal(body)) });
  try {
    const launch = createShellLaunch({ cc: createCcClient(fake.url), dataDir: tmpDir() });
    const req = { project: 'alpha', worktree: null, cols: 80, rows: 24, system: 'local', remoteId: null };
    await assert.rejects(launch.specFor(req), (e) => e.code === 'SHELL_SETUP_FAILED' && /Permission denied/.test(e.error));
    fail = false;
    assert.ok((await launch.specFor(req)).env.HISTFILE);
  } finally { await fake.close(); }
});

test('an installer that loses the race to create the install directory leaves no temp directory behind', async () => {
  const dataDir = tmpDir();
  const fake = await startFakeCc();
  try {
    const launch = createShellLaunch({ cc: createCcClient(fake.url), dataDir });
    const req = { project: 'alpha', worktree: null, cols: 80, rows: 24, system: 'local', remoteId: null };
    await launch.specFor(req);
    const shellDir = path.join(dataDir, 'shell');
    const [hash] = fs.readdirSync(shellDir);
    // The state a loser sees: the directory exists (the winner renamed it in) but this run found it incomplete.
    fs.rmSync(path.join(shellDir, hash, '.complete'));
    const again = createShellLaunch({ cc: createCcClient(fake.url), dataDir });
    await again.specFor(req);
    assert.deepEqual(fs.readdirSync(shellDir), [hash]);
    assert.deepEqual(fs.readdirSync(path.join(shellDir, hash)).filter((f) => f.startsWith('.tmp')), []);
  } finally { await fake.close(); }
});
