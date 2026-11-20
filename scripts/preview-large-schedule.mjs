import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

// A separate, read-only fixture API. It never connects to the project database.
const root = fileURLToPath(new URL('../frontend/dist/', import.meta.url));
const employees = Array.from({ length: 1000 }, (_, index) => ({
  id: `demo-${index + 1}`,
  fullName: `Сотрудник ${String(index + 1).padStart(4, '0')}`,
  position: 'агент',
  avatarUrl: null,
  sortOrder: index,
}));
const templates = [
  ['morning', 'Утро', '07:00', '15:00', '#E8ECFF'],
  ['day', 'День', '10:00', '18:00', '#E9DFFF'],
  ['evening', 'Вечер', '15:00', '23:00', '#FFE8D8'],
].map(([id, name, startTime, endTime, color], sortOrder) => ({
  id,
  code: id,
  name,
  startTime,
  endTime,
  color,
  endDayOffset: 0,
  sortOrder,
}));
const mimeTypes = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
};
await stat(resolve(root, 'index.html'));
createServer(async (request, response) => {
  if (request.method !== 'GET') {
    response.writeHead(405, { Allow: 'GET' });
    response.end();
    return;
  }
  try {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1:4180');
    const json = (value) => {
      response.writeHead(200, {
        'Content-Type': 'application/json',
        'Cache-Control': 'no-store',
      });
      response.end(JSON.stringify(value));
    };
    if (url.pathname === '/api/employees') return json({ employees });
    if (url.pathname === '/api/shift-templates') return json({ templates });
    if (url.pathname === '/api/schedule') {
      return json({
        from: url.searchParams.get('from'),
        to: url.searchParams.get('to'),
        revision: 0,
        readOnly: true,
        timeZone: 'Europe/Moscow',
        latestPublication: null,
        assignments: [],
      });
    }
    const path = resolve(
      root,
      `.${decodeURIComponent(url.pathname === '/' ? '/index.html' : url.pathname)}`,
    );
    if (
      !path.startsWith(root.endsWith(sep) ? root : root + sep) ||
      !(await stat(path)).isFile()
    ) {
      response.writeHead(404);
      response.end();
      return;
    }
    response.writeHead(200, {
      'Content-Type': mimeTypes[extname(path)] ?? 'application/octet-stream',
      'Cache-Control': 'no-store',
    });
    createReadStream(path)
      .on('error', () => response.destroy())
      .pipe(response);
  } catch {
    response.writeHead(404);
    response.end();
  }
}).listen(4180, '127.0.0.1', () => {
  console.log(
    'Large schedule preview: http://127.0.0.1:4180/ (1000 fictional employees; local drafts only)',
  );
});
