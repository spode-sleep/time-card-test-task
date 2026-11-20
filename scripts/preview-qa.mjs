import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer, request as proxyRequest } from 'node:http';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve, sep, extname } from 'node:path';
import { createInterface } from 'node:readline';
import pg from 'pg';

const databaseName = `time_card_qa11_${randomUUID().replaceAll('-', '')}`;
if (!/^time_card_qa11_[a-f0-9]{32}$/.test(databaseName))
  throw new Error('Invalid QA database name');
const root = fileURLToPath(new URL('../frontend/dist/', import.meta.url));
await stat(resolve(root, 'index.html'));
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
await admin.connect();
let created = false,
  backend,
  frontend,
  prisma,
  database,
  stopping = false;
let mode = 'online';
const mime = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
};
async function cleanup() {
  if (stopping) return;
  stopping = true;
  input.close();
  for (const server of [frontend, backend])
    if (server) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  await prisma?.$disconnect();
  await database?.end();
  if (created) await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin.end();
  console.log('QA servers stopped and temporary database removed.');
}
const input = createInterface({ input: process.stdin });
input.on('line', (line) => {
  const command = line.trim();
  if (command === 'quit') void cleanup();
  else if (
    ['online', 'offline', 'lose-next', 'reject-next'].includes(command)
  ) {
    mode = command;
    console.log(`QA mode: ${mode}`);
  }
});
try {
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = url.href;
  for (const command of [
    [
      fileURLToPath(
        new URL('../node_modules/prisma/build/index.js', import.meta.url),
      ),
      'migrate',
      'deploy',
    ],
    ['--import=tsx', 'prisma/seed.ts'],
  ]) {
    const result = spawnSync(process.execPath, command, {
      cwd: fileURLToPath(new URL('../backend/', import.meta.url)),
      env: process.env,
      encoding: 'utf8',
      timeout: 60000,
    });
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
  }
  const { app } = await import('../backend/src/app.ts');
  ({ prisma } = await import('../backend/src/prisma.ts'));
  ({ database } = await import('../backend/src/database.ts'));
  backend = await new Promise((resolve, reject) => {
    const server = app.listen(3000, '127.0.0.1', () => resolve(server));
    server.once('error', reject);
  });
  frontend = createServer(async (req, res) => {
    if (req.url?.startsWith('/api/')) {
      if (
        mode === 'offline' ||
        (mode === 'reject-next' && req.method === 'POST')
      ) {
        const status = mode === 'offline' ? 503 : 400;
        if (mode === 'reject-next') mode = 'online';
        res.writeHead(status, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error: {
              code: status === 400 ? 'VALIDATION_ERROR' : 'INTERNAL_ERROR',
              message: 'Controlled QA failure',
            },
          }),
        );
        return;
      }
      const lose = mode === 'lose-next' && req.method === 'POST';
      if (lose) mode = 'online';
      const upstream = proxyRequest(
        {
          host: '127.0.0.1',
          port: 3000,
          path: req.url,
          method: req.method,
          headers: { ...req.headers, host: '127.0.0.1:3000' },
        },
        (reply) => {
          if (lose) {
            reply.resume();
            reply.on('end', () => res.destroy());
          } else {
            res.writeHead(reply.statusCode ?? 502, reply.headers);
            reply.pipe(res);
          }
        },
      );
      upstream.on('error', () => {
        if (!res.headersSent) res.writeHead(502);
        res.end();
      });
      req.pipe(upstream);
      return;
    }
    try {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1:4173');
      const path = resolve(
        root,
        `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
      );
      if (
        !path.startsWith(root.endsWith(sep) ? root : root + sep) ||
        !(await stat(path)).isFile()
      )
        throw new Error('Not found');
      res.writeHead(200, {
        'Content-Type': mime[extname(path)] ?? 'application/octet-stream',
        'Cache-Control': 'no-store',
      });
      createReadStream(path)
        .on('error', () => res.destroy())
        .pipe(res);
    } catch {
      res.writeHead(404);
      res.end();
    }
  });
  await new Promise((resolve, reject) => {
    frontend.listen(4173, '127.0.0.1', resolve);
    frontend.once('error', reject);
  });
  console.log(
    'Isolated QA: http://127.0.0.1:4173/ — stdin: offline, online, lose-next, reject-next, quit.',
  );
} catch (error) {
  await cleanup();
  throw error;
}
process.once('SIGINT', () => void cleanup());
process.once('SIGTERM', () => void cleanup());
