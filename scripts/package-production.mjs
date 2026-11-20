import assert from 'node:assert/strict';
import { cp, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const staging = await mkdtemp(resolve(tmpdir(), 'time-card-release-'));
const output = resolve(root, '.release');
await mkdir(output, { recursive: true });
const archive = resolve(output, 'time-card-production.tar.gz');
try {
  for (const path of [
    'package.json',
    'package-lock.json',
    '.npmrc',
    '.nvmrc',
    '.env.production.example',
    'DEPLOYMENT.md',
    'backend/package.json',
    'shared/package.json',
    'frontend/package.json',
    'backend/dist',
    'shared/dist',
    'frontend/dist',
  ]) {
    await mkdir(dirname(resolve(staging, path)), { recursive: true });
    await cp(resolve(root, path), resolve(staging, path), { recursive: true });
  }
  const result = spawnSync('tar', ['-czf', archive, '-C', staging, '.'], {
    encoding: 'utf8',
    timeout: 60_000,
  });
  assert.equal(result.status, 0, result.stderr);
  const bytes = await readFile(archive);
  const hash = createHash('sha256').update(bytes).digest('hex');
  await writeFile(
    archive + '.sha256',
    `${hash}  time-card-production.tar.gz\n`,
  );
  console.log(
    `Production archive: ${archive} (${bytes.length} bytes), SHA-256: ${hash}`,
  );
} finally {
  assert.equal(dirname(staging), resolve(tmpdir()));
  assert.match(
    staging.slice(dirname(staging).length + 1),
    /^time-card-release-/,
  );
  await rm(staging, { recursive: true, force: true });
}
