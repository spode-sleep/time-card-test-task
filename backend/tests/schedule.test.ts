import { randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { Express } from 'express';
import pg from 'pg';
import request from 'supertest';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SaveScheduleRequest, ScheduleChange, ScheduleCell, ScheduleResponse } from '@time-card/shared';
import type { PrismaClient } from '../src/generated/prisma/client.js';

const employeeId = '10000000-0000-4000-8000-000000000001';
const secondEmployeeId = '10000000-0000-4000-8000-000000000002';
const templateId = '20000000-0000-4000-8000-000000000001';
const cell: ScheduleCell = { employeeId, date: '2026-11-19' };
const secondCell: ScheduleCell = { employeeId: secondEmployeeId, date: '2026-11-20' };
const templateChange: ScheduleChange = { type: 'assign-template', cell, templateId };

let app: Express;
let prisma: PrismaClient;
let database: pg.Pool;
let admin: pg.Client;
let originalUrl: string;
let createdDatabase = false;
const databaseName = `time_card_api_test_${randomUUID().replaceAll('-', '')}`;

function save(changes: ScheduleChange[], baseRevision = 0, requestId = randomUUID()) {
  return request(app).post('/api/schedule/changes').send({ requestId, baseRevision, changes } satisfies SaveScheduleRequest);
}

function readSchedule() {
  return request(app).get('/api/schedule').query({ from: '0001-01-01', to: '9999-12-31' });
}

beforeAll(async () => {
  const configuredUrl = process.env.DATABASE_URL;
  if (!configuredUrl) throw new Error('Set DATABASE_URL to a PostgreSQL user with CREATE DATABASE privileges.');
  originalUrl = configuredUrl;
  if (!/^time_card_api_test_[a-f0-9]{32}$/.test(databaseName)) throw new Error('Unexpected test database name');
  admin = new pg.Client({ connectionString: originalUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE "${databaseName}"`);
  createdDatabase = true;
  const testUrl = new URL(originalUrl);
  testUrl.pathname = `/${databaseName}`;
  process.env.DATABASE_URL = testUrl.href;

  const result = spawnSync(process.execPath, [
    fileURLToPath(new URL('../../node_modules/prisma/build/index.js', import.meta.url)), 'migrate', 'deploy',
  ], {
    cwd: fileURLToPath(new URL('..', import.meta.url)), env: process.env, encoding: 'utf8', timeout: 60_000,
  });
  if (result.status !== 0) throw new Error(result.stdout + result.stderr);
  ({ app } = await import('../src/app.js'));
  ({ prisma } = await import('../src/prisma.js'));
  ({ database } = await import('../src/database.js'));
});

beforeEach(async () => {
  await prisma.$transaction([
    prisma.scheduleRequest.deleteMany(),
    prisma.schedulePublication.deleteMany(),
    prisma.shiftAssignment.deleteMany(),
    prisma.schedule.update({ where: { id: 1 }, data: { revision: 0, timeZone: 'Europe/Moscow' } }),
    prisma.shiftTemplate.deleteMany(),
    prisma.employee.deleteMany(),
    prisma.employee.createMany({ data: [
      { id: employeeId, fullName: 'Кузнецова Алина', position: 'агент', sortOrder: 1 },
      { id: secondEmployeeId, fullName: 'Волков Тимур', position: 'агент', sortOrder: 0 },
    ] }),
    prisma.shiftTemplate.create({ data: {
      id: templateId, code: 'morning', name: 'Утро', startMinute: 420, endMinute: 900,
      endDayOffset: 0, color: '#E8ECFF', sortOrder: 0,
    } }),
  ]);
});

afterEach(() => vi.restoreAllMocks());

afterAll(async () => {
  await prisma?.$disconnect();
  await database?.end();
  if (createdDatabase) await admin.query(`DROP DATABASE "${databaseName}"`);
  await admin?.end();
  if (originalUrl) process.env.DATABASE_URL = originalUrl;
});

describe('schedule API with PostgreSQL', () => {
  it('reads sorted employees, templates and the initial schedule', async () => {
    const employees = await request(app).get('/api/employees').expect(200);
    expect(employees.body.employees.map((employee: { id: string }) => employee.id)).toEqual([secondEmployeeId, employeeId]);
    const templates = await request(app).get('/api/shift-templates').expect(200);
    expect(templates.body.templates[0]).toMatchObject({ id: templateId, startTime: '07:00', endTime: '15:00', endDayOffset: 0 });
    const schedule = await readSchedule().expect(200);
    expect(schedule.body).toEqual({ from: '0001-01-01', to: '9999-12-31', revision: 0, timeZone: 'Europe/Moscow', assignments: [], latestPublication: null });
    expect(schedule.headers['cache-control']).toBe('no-store');
    await request(app).get('/api/health').expect(200, { status: 'ok', database: 'connected' });
  });

  it.each([
    { from: '2026-02-29', to: '2026-03-01' },
    { from: '2026-04-31', to: '2026-05-01' },
    { from: '0000-01-01', to: '2026-01-01' },
    { from: '2026-11-20', to: '2026-11-19' },
    { from: '2026-11-19' },
    { from: ['2026-11-19', '2026-11-20'], to: '2026-11-21' },
  ])('rejects invalid date queries %#', async (range) => {
    const response = await request(app).get('/api/schedule').query(range).expect(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('saves template and overnight shifts and reads inclusive date boundaries', async () => {
    const response = await save([
      templateChange,
      { type: 'assign-custom', cell: secondCell, time: { startTime: '22:00', endTime: '06:00', endDayOffset: 1 } },
    ]).expect(200);
    expect(response.body.revision).toBe(1);
    expect(response.body.assignments).toHaveLength(2);
    expect(response.body.assignments[1]).toMatchObject({ ...secondCell, startTime: '22:00', endTime: '06:00', endDayOffset: 1, templateId: null });
    const result = await request(app).get('/api/schedule').query({ from: cell.date, to: cell.date }).expect(200);
    expect(result.body.assignments).toHaveLength(1);
    expect(result.body.assignments[0]).toMatchObject({ ...cell, startTime: '07:00', endTime: '15:00', templateId });
  });

  it.each([
    { startTime: '00:00', endTime: '00:01', endDayOffset: 0 },
    { startTime: '23:59', endTime: '00:00', endDayOffset: 1 },
    { startTime: '00:00', endTime: '23:59', endDayOffset: 0 },
    { startTime: '07:00', endTime: '06:59', endDayOffset: 1 },
  ] as const)('accepts minute precision and duration boundaries %#', async time => {
    const response = await save([{ type: 'assign-custom', cell, time }]).expect(200);
    expect(response.body.assignments[0]).toMatchObject({ ...cell, ...time, templateId: null });
    expect((await readSchedule()).body.assignments[0]).toMatchObject(time);
  });

  it('keeps assigned hours and colors after template edits and supports replacing with custom hours', async () => {
    const initial = await save([templateChange]).expect(200);
    await prisma.shiftTemplate.update({ where: { id: templateId }, data: { endMinute: 960, color: '#FFFFFF' } });
    const unchanged = await readSchedule().expect(200);
    expect(unchanged.body.assignments[0]).toMatchObject({ endTime: '15:00', color: '#E8ECFF' });
    const changed = await save([{ type: 'assign-custom', cell, time: { startTime: '09:00', endTime: '17:00', endDayOffset: 0 } }], 1).expect(200);
    expect(changed.body.assignments[0]).toMatchObject({ id: initial.body.assignments[0].id, templateId: null, startTime: '09:00', endTime: '17:00' });
  });

  it('applies sequential changes and returns each touched cell only in its final state', async () => {
    const response = await save([
      templateChange,
      { type: 'move', from: cell, to: secondCell, replaceExisting: false },
      { type: 'assign-custom', cell, time: { startTime: '08:00', endTime: '16:00', endDayOffset: 0 } },
      { type: 'delete', cell },
    ]).expect(200);
    expect(response.body.revision).toBe(1);
    expect(response.body.assignments).toHaveLength(1);
    expect(response.body.assignments[0]).toMatchObject(secondCell);
    expect(response.body.deletedCells).toEqual([cell]);
    expect(await prisma.shiftAssignment.count()).toBe(1);
  });

  it('moves an assignment with its ID and replaces an occupied cell only when requested', async () => {
    const initial = await save([templateChange, { ...templateChange, cell: secondCell }]).expect(200);
    const move: ScheduleChange = { type: 'move', from: cell, to: secondCell, replaceExisting: false };
    const rejected = await save([move], 1).expect(409);
    expect(rejected.body.error.code).toBe('CELL_OCCUPIED');
    expect(await prisma.shiftAssignment.count()).toBe(2);
    const moved = await save([{ ...move, replaceExisting: true }], 1).expect(200);
    expect(moved.body.assignments[0].id).toBe(initial.body.assignments[0].id);
    expect(moved.body.deletedCells).toEqual([cell]);
    expect(await prisma.shiftAssignment.count()).toBe(1);
  });

  it('rolls back the whole batch and allows correcting a failed request', async () => {
    const requestId = randomUUID();
    const bad = await save([templateChange, { type: 'assign-template', cell: secondCell, templateId: randomUUID() }], 0, requestId).expect(404);
    expect(bad.body.error.code).toBe('NOT_FOUND');
    expect(await prisma.shiftAssignment.count()).toBe(0);
    expect(await prisma.scheduleRequest.count()).toBe(0);
    expect((await readSchedule()).body.revision).toBe(0);
    await save([templateChange], 0, requestId).expect(200);
  });

  it('rejects missing employees and empty move sources without changing data', async () => {
    await save([{ ...templateChange, cell: { ...cell, employeeId: randomUUID() } }]).expect(404);
    await save([{ type: 'move', from: cell, to: secondCell, replaceExisting: false }]).expect(404);
    expect(await prisma.scheduleRequest.count()).toBe(0);
  });

  it('supports deleting empty cells and replaying a no-op save after a later revision', async () => {
    const requestId = randomUUID();
    const empty = await save([], 0, requestId).expect(200);
    expect(empty.body.revision).toBe(0);
    await save([templateChange]).expect(200);
    expect((await save([], 0, requestId).expect(200)).body).toEqual(empty.body);
    const removed = await save([{ type: 'delete', cell }, { type: 'delete', cell: secondCell }], 1).expect(200);
    expect(removed.body.deletedCells).toEqual([cell, secondCell]);
    expect(removed.body.assignments).toEqual([]);
  });

  it('replays requests with reordered keys and rejects reusing an ID with another payload or route', async () => {
    const requestId = randomUUID();
    const first = await save([templateChange], 0, requestId).expect(200);
    const replay = await request(app).post('/api/schedule/changes').send({
      changes: [{ templateId, cell: { date: cell.date, employeeId }, type: 'assign-template' }], baseRevision: 0, requestId,
    }).expect(200);
    expect(replay.body).toEqual(first.body);
    const reused = await save([], 0, requestId).expect(409);
    expect(reused.body.error.code).toBe('REQUEST_ID_REUSED');
    const publication = await request(app).post('/api/schedule/publish').send({ requestId, baseRevision: 0, changes: [templateChange] }).expect(409);
    expect(publication.body.error.code).toBe('REQUEST_ID_REUSED');
  });

  it('returns one result for simultaneous identical requests', async () => {
    const requestId = randomUUID();
    const responses = await Promise.all(Array.from({ length: 6 }, () => save([templateChange], 0, requestId)));
    expect(responses.map(response => response.status)).toEqual([200, 200, 200, 200, 200, 200]);
    for (const response of responses) expect(response.body).toEqual(responses[0]?.body);
    expect(await prisma.scheduleRequest.count()).toBe(1);
    expect((await readSchedule()).body.revision).toBe(1);
  });

  it('commits only one competing revision and returns the current revision to the loser', async () => {
    const responses = await Promise.all([save([templateChange]), save([{ ...templateChange, cell: secondCell }])]);
    expect(responses.map(response => response.status).sort()).toEqual([200, 409]);
    const conflict = responses.find(response => response.status === 409);
    expect(conflict?.body.error).toMatchObject({ code: 'REVISION_CONFLICT', currentRevision: 1 });
    expect(await prisma.shiftAssignment.count()).toBe(1);
    expect(await prisma.scheduleRequest.count()).toBe(1);
  });

  it('reads assignments and revision from a consistent snapshot during writes', async () => {
    const writer = async () => {
      for (let index = 0; index < 6; index++) {
        await save([{ ...templateChange, cell: { employeeId, date: `2026-11-${20 + index}` } }], index).expect(200);
      }
    };
    const writing = writer();
    const readers = Array.from({ length: 16 }, async () => {
      const result = await readSchedule().expect(200);
      const body: ScheduleResponse = result.body;
      expect(body.assignments.length).toBe(body.revision);
    });
    await Promise.all([writing, ...readers]);
  });

  it('atomically saves and publishes the full schedule, replays publication and preserves its snapshot', async () => {
    await save([templateChange]).expect(200);
    const requestId = randomUUID();
    const body: SaveScheduleRequest = { requestId, baseRevision: 1, changes: [{ ...templateChange, cell: secondCell }] };
    const response = await request(app).post('/api/schedule/publish').send(body).expect(200);
    expect(response.body.revision).toBe(2);
    expect(response.body.publication.revision).toBe(2);
    const stored = await prisma.schedulePublication.findFirstOrThrow();
    expect(stored.snapshot).toMatchObject({ schemaVersion: 1, revision: 2, assignments: expect.any(Array) });
    expect((stored.snapshot as { assignments: unknown[] }).assignments).toHaveLength(2);
    await save([{ type: 'delete', cell }], 2).expect(200);
    await prisma.employee.update({ where: { id: employeeId }, data: { fullName: 'Новое имя' } });
    expect((await prisma.schedulePublication.findFirstOrThrow()).snapshot).toEqual(stored.snapshot);
    expect((await request(app).post('/api/schedule/publish').send(body).expect(200)).body).toEqual(response.body);
    const read = await readSchedule().expect(200);
    expect(read.body.latestPublication).toEqual(response.body.publication);
    const empty = await request(app).post('/api/schedule/publish').send({ requestId: randomUUID(), baseRevision: 3, changes: [] }).expect(200);
    expect(empty.body.revision).toBe(4);
    expect(await prisma.schedulePublication.count()).toBe(2);
  });

  it('does not publish or persist request results when a publication batch fails', async () => {
    const response = await request(app).post('/api/schedule/publish').send({
      requestId: randomUUID(), baseRevision: 0,
      changes: [templateChange, { type: 'move', from: secondCell, to: cell, replaceExisting: true }],
    }).expect(404);
    expect(response.body.error.code).toBe('NOT_FOUND');
    expect(await prisma.shiftAssignment.count()).toBe(0);
    expect(await prisma.schedulePublication.count()).toBe(0);
    expect(await prisma.scheduleRequest.count()).toBe(0);
  });

  it('rolls back assignments, revision and publication if storing the request result fails', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    await database.query(`
      CREATE FUNCTION fail_request_write() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'test request persistence failure'; END;
      $$;
      CREATE TRIGGER reject_request BEFORE INSERT ON schedule_requests
      FOR EACH ROW EXECUTE FUNCTION fail_request_write();
    `);
    try {
      const response = await request(app).post('/api/schedule/publish').send({
        requestId: randomUUID(), baseRevision: 0, changes: [templateChange],
      }).expect(500);
      expect(response.body.error.code).toBe('INTERNAL_ERROR');
      expect(await prisma.shiftAssignment.count()).toBe(0);
      expect(await prisma.schedulePublication.count()).toBe(0);
      expect(await prisma.scheduleRequest.count()).toBe(0);
      expect((await readSchedule()).body.revision).toBe(0);
    } finally {
      await database.query('DROP TRIGGER reject_request ON schedule_requests; DROP FUNCTION fail_request_write();');
    }
  });

  it.each([
    { startTime: '24:00', endTime: '06:00', endDayOffset: 1 },
    { startTime: '09:00', endTime: '09:00', endDayOffset: 0 },
    { startTime: '09:00', endTime: '09:00', endDayOffset: 1 },
    { startTime: '09:00:30', endTime: '17:00', endDayOffset: 0 },
    { startTime: '7:00', endTime: '15:00', endDayOffset: 0 },
    { startTime: '09:00', endTime: '17:00', endDayOffset: 1 },
    { startTime: '22:00', endTime: '06:00', endDayOffset: 0 },
    { startTime: '09:00', endTime: '17:00', endDayOffset: 2 },
  ])('validates local times and overnight consistency %#', async (time) => {
    await request(app).post('/api/schedule/changes').send({ requestId: randomUUID(), baseRevision: 0, changes: [{ type: 'assign-custom', cell, time }] }).expect(400);
    expect(await prisma.scheduleRequest.count()).toBe(0);
  });

  it('rejects malformed JSON, unknown fields, invalid IDs, oversized batches and bodies', async () => {
    const malformed = await request(app).post('/api/schedule/changes').set('Content-Type', 'application/json').send('{bad json').expect(400);
    expect(malformed.body.error.code).toBe('VALIDATION_ERROR');
    await request(app).post('/api/schedule/changes').send({ requestId: 'bad', baseRevision: 0, changes: [] }).expect(400);
    await request(app).post('/api/schedule/changes').send({ requestId: randomUUID(), baseRevision: 0, changes: [], extra: true }).expect(400);
    await save(Array.from({ length: 1001 }, () => templateChange)).expect(400);
    const tooLarge = await request(app).post('/api/schedule/changes').send({ padding: 'x'.repeat(1024 * 1024) }).expect(413);
    expect(tooLarge.body.error.code).toBe('VALIDATION_ERROR');
    await save([{ type: 'move', from: cell, to: cell, replaceExisting: true }]).expect(400);
  });

  it('accepts a full batch of 1000 distinct cells', async () => {
    const changes = Array.from({ length: 1000 }, (_, index) => ({
      ...templateChange,
      cell: { employeeId, date: new Date(Date.UTC(2026, 0, index + 1)).toISOString().slice(0, 10) },
    }));
    const response = await save(changes).expect(200);
    expect(response.body.assignments).toHaveLength(1000);
    expect(response.body.revision).toBe(1);
    expect(await prisma.shiftAssignment.count()).toBe(1000);
  });

  it('returns a safe JSON error and logs unexpected failures', async () => {
    const log = vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.spyOn(prisma.employee, 'findMany').mockRejectedValueOnce(new Error('private database diagnostics'));
    const response = await request(app).get('/api/employees').expect(500);
    expect(response.body.error.code).toBe('INTERNAL_ERROR');
    expect(JSON.stringify(response.body)).not.toContain('private database diagnostics');
    expect(log).toHaveBeenCalled();
    const missing = await request(app).get('/api/missing').expect(404);
    expect(missing.body.error.code).toBe('NOT_FOUND');
  });
});
