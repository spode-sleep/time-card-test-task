import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { access } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { createPinia } from 'pinia';
const admin = new pg.Client({ connectionString: process.env.DATABASE_URL });
const name = `time_card_step10_${randomUUID().replaceAll('-', '')}`;
assert.match(name, /^time_card_step10_[a-f0-9]{32}$/);
let created = false,
  server,
  prisma,
  database;
await admin.connect();
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  created = true;
  const url = new URL(process.env.DATABASE_URL);
  url.pathname = `/${name}`;
  process.env.DATABASE_URL = url.href;
  const migration = spawnSync(
    process.execPath,
    [
      fileURLToPath(
        new URL('../node_modules/prisma/build/index.js', import.meta.url),
      ),
      'migrate',
      'deploy',
    ],
    {
      cwd: fileURLToPath(new URL('../backend/', import.meta.url)),
      env: process.env,
      encoding: 'utf8',
    },
  );
  assert.equal(migration.status, 0, migration.stderr);
  function seed() {
    const result = spawnSync(
      process.execPath,
      ['--import=tsx', 'prisma/seed.ts'],
      {
        cwd: fileURLToPath(new URL('../backend/', import.meta.url)),
        env: process.env,
        encoding: 'utf8',
        timeout: 60000,
      },
    );
    assert.equal(result.status, 0, result.stderr);
  }
  seed();
  const { app } = await import('../backend/src/app.ts');
  ({ prisma } = await import('../backend/src/prisma.ts'));
  ({ database } = await import('../backend/src/database.ts'));
  const employees = await prisma.employee.findMany({
    orderBy: { sortOrder: 'asc' },
  });
  assert.equal(employees.length, 8);
  for (const [index, employee] of employees.entries()) {
    assert.equal(employee.avatarUrl, `/avatars/employee-${index + 1}.svg`);
    await access(
      new URL(`../frontend/public${employee.avatarUrl}`, import.meta.url),
    );
  }
  await prisma.employee.update({
    where: { id: employees[0].id },
    data: { avatarUrl: null },
  });
  await prisma.employee.update({
    where: { id: employees[1].id },
    data: { avatarUrl: '/avatars/employee-2.png' },
  });
  const customEmployee = {
    avatarUrl: '/avatars/custom.svg',
    fullName: 'Своё имя',
    position: 'руководитель',
  };
  await prisma.employee.update({
    where: { id: employees[2].id },
    data: customEmployee,
  });
  seed();
  const migratedEmployees = await prisma.employee.findMany({
    orderBy: { sortOrder: 'asc' },
  });
  assert.equal(migratedEmployees[0].avatarUrl, '/avatars/employee-1.svg');
  assert.equal(migratedEmployees[1].avatarUrl, '/avatars/employee-2.svg');
  for (const [key, value] of Object.entries(customEmployee))
    assert.equal(migratedEmployees[2][key], value);
  seed();
  assert.deepEqual(
    await prisma.employee.findMany({ orderBy: { sortOrder: 'asc' } }),
    migratedEmployees,
  );
  assert.equal(await prisma.shiftTemplate.count(), 3);
  assert.equal(await prisma.shiftAssignment.count(), 0);
  await prisma.employee.update({
    where: { id: employees[2].id },
    data: {
      avatarUrl: employees[2].avatarUrl,
      fullName: employees[2].fullName,
      position: employees[2].position,
    },
  });
  console.log(
    'Abstract avatars: files, legacy migration, user data preservation and seed idempotence passed.',
  );
  server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });
  const base = `http://127.0.0.1:${server.address().port}/api`;
  const { scheduleApi } = await import('../frontend/src/api/schedule.ts');
  async function wire(path, body) {
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
    const data = await response.json();
    if (!response.ok)
      throw { isAxiosError: true, response: { status: response.status, data } };
    return data;
  }
  scheduleApi.employees = () => wire('/employees');
  scheduleApi.templates = () => wire('/shift-templates');
  scheduleApi.schedule = (range) =>
    wire('/schedule?' + new URLSearchParams(range));
  scheduleApi.save = (body) => wire('/schedule/changes', body);
  scheduleApi.publish = (body) => wire('/schedule/publish', body);
  const { useScheduleStore } = await import(
    '../frontend/src/stores/schedule.ts'
  );
  const first = useScheduleStore(createPinia()),
    second = useScheduleStore(createPinia());
  await first.goToDate('2026-11-19');
  await second.goToDate('2026-11-19');
  const cell = { employeeId: first.employees[0].id, date: '2026-11-19' };
  first.applyCustomShift([cell], {
    startTime: '22:45',
    endTime: '06:15',
    endDayOffset: 1,
  });
  let loseReply = true;
  const ids = [];
  scheduleApi.save = async (body) => {
    ids.push(body.requestId);
    const result = await wire('/schedule/changes', body);
    if (loseReply) {
      loseReply = false;
      throw new Error('simulated lost response');
    }
    return result;
  };
  assert.equal(await first.save(), false);
  assert.equal(first.editingLocked, true);
  assert.equal(await first.save(), true);
  assert.equal(ids[0], ids[1]);
  assert.equal(
    (await prisma.schedule.findUnique({ where: { id: 1 } })).revision,
    1,
  );
  assert.equal(await prisma.scheduleRequest.count(), 1);
  const reloaded = useScheduleStore(createPinia());
  await reloaded.goToDate('2026-11-19');
  assert.equal(
    reloaded.draftByCell.get(`${cell.employeeId}/${cell.date}`).endTime,
    '06:15',
  );
  second.applyTemplate([cell], second.templates[0].id);
  assert.equal(await second.save(), false);
  assert.equal(second.hasConflict, true);
  assert.equal(await second.compareWithServer(), true);
  assert.equal(second.comparison.conflicts.length, 1);
  second.resolveConflict(`${cell.employeeId}/${cell.date}`, 'local');
  assert.equal(second.applyComparison(), true);
  assert.equal(await second.save(), true);
  assert.equal(second.revision, 2);
  assert.equal(await second.publish(), true);
  assert.equal(second.latestPublication.revision, 3);
  assert.equal(
    (await prisma.schedulePublication.findFirst()).snapshot.assignments[0]
      .startTime,
    second.templates[0].startTime,
  );
  second.deleteShifts([cell]);
  assert.equal(await second.save(), true);
  assert.equal(second.publicationState, 'Есть неопубликованные изменения');
  assert.equal(
    (await prisma.schedulePublication.findFirst()).snapshot.assignments.length,
    1,
  );
  console.log(
    'Step 10: real HTTP/PostgreSQL save, response replay, reload, conflict review, merge, publication snapshot and deletion passed.',
  );
} finally {
  if (server) await new Promise((resolve) => server.close(resolve));
  await prisma?.$disconnect();
  await database?.end();
  if (created) await admin.query(`DROP DATABASE "${name}"`);
  await admin.end();
}
