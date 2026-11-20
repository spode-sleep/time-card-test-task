import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import pg from 'pg';

const root = fileURLToPath(new URL('../', import.meta.url));
const runtimeRoot = process.argv[2] ? resolve(process.argv[2]) : root;
const name = `time_card_production_test_${randomUUID().replaceAll('-', '')}`;
assert.match(name, /^time_card_production_test_[a-f0-9]{32}$/);
const directory = await mkdtemp(
  resolve(tmpdir(), 'time-card-production-test-'),
);
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
let created = false,
  child,
  base,
  logs = '';
await admin.connect();
const url = new URL(process.env.DATABASE_URL);
url.pathname = `/${name}`;
const env = {
  ...process.env,
  DATABASE_URL: url.href,
  NODE_ENV: 'production',
  IP: '127.0.0.1',
};
delete env.HOST;

function run(args, cwd = root) {
  const result = spawnSync(process.execPath, args, {
    cwd,
    env,
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
}
async function stop() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const current = child;
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      current.kill('SIGKILL');
      reject(new Error('Production process failed to stop'));
    }, 6000);
    current.once('exit', () => {
      clearTimeout(timeout);
      resolve();
    });
    current.kill('SIGTERM');
  });
}
async function start() {
  const probe = createServer();
  await new Promise((resolve, reject) => {
    probe.once('error', reject);
    probe.listen(0, '127.0.0.1', resolve);
  });
  const port = probe.address().port;
  await new Promise((resolve) => probe.close(resolve));
  logs = '';
  child = spawn(
    process.execPath,
    [resolve(runtimeRoot, 'backend/dist/server.js')],
    {
      cwd: directory,
      env: { ...env, PORT: String(port) },
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );
  child.stdout.on('data', (chunk) => {
    logs += chunk;
  });
  child.stderr.on('data', (chunk) => {
    logs += chunk;
  });
  base = `http://127.0.0.1:${port}`;
  for (let attempt = 0; attempt < 75; attempt++) {
    if (child.exitCode !== null) throw new Error(logs);
    try {
      if ((await fetch(base + '/api/health')).ok) return;
    } catch {
      /* Wait for listen. */
    }
    await delay(200);
  }
  throw new Error('Production health check timed out: ' + logs);
}
async function json(path, body) {
  const response = await fetch(
    base + path,
    body
      ? {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      : {},
  );
  return { status: response.status, body: await response.json() };
}
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  run(
    [resolve(root, 'node_modules/prisma/build/index.js'), 'migrate', 'deploy'],
    resolve(root, 'backend'),
  );
  run([resolve(runtimeRoot, 'backend/dist/seed.js')], directory);
  await start();
  const index = await fetch(base);
  assert.equal(index.status, 200);
  assert.equal(index.headers.get('cache-control'), 'no-store');
  assert.equal(index.headers.get('x-content-type-options'), 'nosniff');
  const html = await index.text();
  assert.match(html, /График смен/);
  const script = html.match(/<script[^>]+src="([^"]+)"/)[1];
  const asset = await fetch(base + script);
  assert.equal(asset.status, 200);
  assert.match(asset.headers.get('cache-control'), /immutable/);
  assert.match(asset.headers.get('content-type'), /javascript/);
  await asset.arrayBuffer();
  assert.equal(
    (await fetch(base + '/index.html')).headers.get('cache-control'),
    'no-store',
  );
  assert.equal((await fetch(base, { method: 'HEAD' })).status, 200);
  assert.equal(
    (await fetch(base + '/schedule', { headers: { Accept: 'text/html' } }))
      .status,
    200,
  );
  for (const path of [
    '/api/unknown',
    '/api',
    '/assets/missing.js',
    '/.env',
    '/.git/config',
    '/backend/src/config.ts',
  ]) {
    const result = await fetch(base + path, {
      headers: { Accept: 'text/html' },
    });
    assert.equal(result.status, 404, path);
    assert.match(result.headers.get('content-type'), /json/);
  }
  const employees = (await json('/api/employees')).body.employees;
  assert.equal(employees.length, 8);
  for (const employee of employees) {
    const avatar = await fetch(base + employee.avatarUrl);
    assert.equal(avatar.status, 200);
    assert.match(avatar.headers.get('content-type'), /image\/svg/);
  }
  const range = '/api/schedule?from=2026-11-01&to=2026-11-30';
  const empty = await json(range);
  assert.equal(empty.body.revision, 0);
  assert.deepEqual(empty.body.assignments, []);
  const body = {
    requestId: randomUUID(),
    baseRevision: 0,
    changes: [
      {
        type: 'assign-custom',
        cell: { employeeId: employees[0].id, date: '2026-11-20' },
        time: { startTime: '22:45', endTime: '06:15', endDayOffset: 1 },
      },
    ],
  };
  const saved = await json('/api/schedule/changes', body);
  assert.equal(saved.status, 200);
  assert.equal(saved.body.revision, 1);
  assert.deepEqual(await json('/api/schedule/changes', body), saved);
  assert.equal(
    (await json('/api/schedule/changes', { ...body, requestId: randomUUID() }))
      .status,
    409,
  );
  const publication = await json('/api/schedule/publish', {
    requestId: randomUUID(),
    baseRevision: 1,
    changes: [],
  });
  assert.equal(publication.status, 200);
  assert.equal(publication.body.publication.revision, 2);
  await stop();
  await start();
  const reloaded = await json(range);
  assert.equal(reloaded.body.revision, 2);
  assert.equal(reloaded.body.assignments.length, 1);
  assert.equal(reloaded.body.assignments[0].id, saved.body.assignments[0].id);
  assert.equal(reloaded.body.assignments[0].startTime, '22:45');
  assert.equal(
    reloaded.body.latestPublication.id,
    publication.body.publication.id,
  );
  console.log(
    'Production passed: clean migrations, compiled seed, same-origin HTML/assets/API, cache, 404s, eight SVGs, save/replay/conflict/publish and restart persistence.',
  );
} finally {
  await stop();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
  assert.equal(dirname(directory), resolve(tmpdir()));
  assert.match(
    directory.slice(dirname(directory).length + 1),
    /^time-card-production-test-/,
  );
  await rm(directory, { recursive: true, force: true });
}
