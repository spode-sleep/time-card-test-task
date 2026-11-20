import assert from 'node:assert/strict';

const base = new URL(process.argv[2] ?? 'http://127.0.0.1:3000');
if (
  base.protocol !== 'https:' &&
  !(
    base.protocol === 'http:' &&
    ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname)
  )
) {
  throw new Error('A public deployment must use HTTPS.');
}
if (
  base.username ||
  base.password ||
  base.pathname !== '/' ||
  base.search ||
  base.hash
)
  throw new Error('Pass only the site origin, without credentials or a path.');
async function get(path) {
  const result = await fetch(new URL(path, base), {
    signal: AbortSignal.timeout(15_000),
  });
  assert.equal(
    new URL(result.url).origin,
    base.origin,
    'Unexpected redirect to a different origin',
  );
  assert.equal(result.status, 200, path);
  return result;
}
const html = await (await get('/')).text();
assert.match(html, /График смен/);
const script = html.match(/<script[^>]+src="([^"]+)"/)[1];
assert.match((await get(script)).headers.get('content-type'), /javascript/);
assert.deepEqual(await (await get('/api/health')).json(), {
  status: 'ok',
  database: 'connected',
});
const { employees } = await (await get('/api/employees')).json();
const { templates } = await (await get('/api/shift-templates')).json();
assert.ok(employees.length > 0);
assert.ok(templates.length > 0);
for (const employee of employees) {
  if (
    employee.avatarUrl &&
    new URL(employee.avatarUrl, base).origin === base.origin
  )
    await get(employee.avatarUrl);
}
const unknown = await fetch(new URL('/api/unknown', base), {
  signal: AbortSignal.timeout(15_000),
});
assert.equal(unknown.status, 404);
assert.equal((await unknown.json()).error.code, 'NOT_FOUND');
console.log(
  `Deployment verified: ${base.origin} — HTML, JavaScript, PostgreSQL health, employees, templates, avatars and API 404.`,
);
