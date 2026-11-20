import { createHash, randomUUID } from 'node:crypto';
import type {
  PublishedScheduleSnapshot,
  PublishScheduleResponse,
  SaveScheduleRequest,
  SaveScheduleResponse,
  ScheduleCell,
  ScheduleRange,
  ScheduleResponse,
} from '@time-card/shared';
import type { Prisma, Schedule, ScheduleRequest, ShiftAssignment } from './generated/prisma/client.js';
import { prisma } from './prisma.js';
import { ApiError } from './errors.js';
import { assignmentCell, assignmentResponse, cellKey, publicationResponse, templateResponse, timeToMinutes } from './schedule-mapping.js';

type MutationResponse = SaveScheduleResponse | PublishScheduleResponse;
type MutationKind = 'save' | 'publish';

const employeeOrder = [{ sortOrder: 'asc' }, { id: 'asc' }] as const;
const assignmentOrder = [{ date: 'asc' }, { employeeId: 'asc' }] as const;

export async function getEmployees() {
  return { employees: await prisma.employee.findMany({ orderBy: [...employeeOrder] }) };
}

export async function getTemplates() {
  const templates = await prisma.shiftTemplate.findMany({ orderBy: [...employeeOrder] });
  return { templates: templates.map(templateResponse) };
}

export async function getSchedule(range: ScheduleRange): Promise<ScheduleResponse> {
  return prisma.$transaction(async (transaction) => {
    const schedule = await transaction.schedule.findUniqueOrThrow({ where: { id: 1 } });
    const assignments = await transaction.shiftAssignment.findMany({
      where: {
        scheduleId: 1,
        date: { gte: new Date(`${range.from}T00:00:00.000Z`), lte: new Date(`${range.to}T00:00:00.000Z`) },
      },
      orderBy: [...assignmentOrder],
    });
    const publication = await transaction.schedulePublication.findFirst({
      where: { scheduleId: 1 }, orderBy: { revision: 'desc' },
    });

    return {
      ...range,
      revision: schedule.revision,
      timeZone: schedule.timeZone,
      assignments: assignments.map(assignmentResponse),
      latestPublication: publication ? publicationResponse(publication) : null,
    };
  }, { isolationLevel: 'RepeatableRead' });
}

function canonicalValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalValue);
  if (value !== null && typeof value === 'object') {
    const entries = value as Record<string, unknown>;
    return Object.fromEntries(Object.keys(entries).sort().map(key => [key, canonicalValue(entries[key])]));
  }
  return value;
}

function replayRequest(stored: ScheduleRequest, kind: MutationKind, hash: string): MutationResponse {
  if (stored.kind !== kind || stored.payloadHash !== hash) {
    throw new ApiError(409, { code: 'REQUEST_ID_REUSED', message: 'Этот идентификатор запроса уже использован для другого сохранения.' });
  }
  return stored.response as unknown as MutationResponse;
}

async function applyChanges(transaction: Prisma.TransactionClient, request: SaveScheduleRequest): Promise<SaveScheduleResponse> {
  const touched = new Map<string, ScheduleCell>();
  const templateIds = new Set<string>();
  for (const change of request.changes) {
    const cells = change.type === 'move' ? [change.from, change.to] : [change.cell];
    for (const cell of cells) touched.set(cellKey(cell), cell);
    if (change.type === 'assign-template') templateIds.add(change.templateId);
  }

  const cells = [...touched.values()];
  const employees = await transaction.employee.findMany({
    where: { id: { in: [...new Set(cells.map(cell => cell.employeeId))] } }, select: { id: true },
  });
  const employeeIds = new Set(employees.map(employee => employee.id));
  for (const cell of cells) {
    if (!employeeIds.has(cell.employeeId)) {
      throw new ApiError(404, { code: 'NOT_FOUND', message: 'Указанный сотрудник не найден.' });
    }
  }

  const templates = new Map((await transaction.shiftTemplate.findMany({
    where: { id: { in: [...templateIds] } },
  })).map(template => [template.id, template]));
  const existing = await transaction.shiftAssignment.findMany({
    where: {
      scheduleId: 1,
      OR: cells.map(cell => ({ employeeId: cell.employeeId, date: new Date(`${cell.date}T00:00:00.000Z`) })),
    },
  });
  const assignments = new Map(existing.map(assignment => [cellKey(assignmentCell(assignment)), assignment]));

  for (const change of request.changes) {
    if (change.type === 'delete') {
      assignments.delete(cellKey(change.cell));
      continue;
    }

    if (change.type === 'move') {
      const source = assignments.get(cellKey(change.from));
      if (!source) throw new ApiError(404, { code: 'NOT_FOUND', message: 'Смена для переноса не найдена.' });
      if (assignments.has(cellKey(change.to)) && !change.replaceExisting) {
        throw new ApiError(409, { code: 'CELL_OCCUPIED', message: 'Целевая ячейка занята. Подтвердите замену смены.' });
      }
      assignments.delete(cellKey(change.from));
      assignments.set(cellKey(change.to), {
        ...source, employeeId: change.to.employeeId, date: new Date(`${change.to.date}T00:00:00.000Z`),
      });
      continue;
    }

    let timing: Pick<ShiftAssignment, 'startMinute' | 'endMinute' | 'endDayOffset' | 'templateId' | 'color'>;
    if (change.type === 'assign-template') {
      const template = templates.get(change.templateId);
      if (!template) throw new ApiError(404, { code: 'NOT_FOUND', message: 'Указанный шаблон смены не найден.' });
      timing = {
        startMinute: template.startMinute, endMinute: template.endMinute,
        endDayOffset: template.endDayOffset, templateId: template.id, color: template.color,
      };
    } else {
      timing = {
        startMinute: timeToMinutes(change.time.startTime), endMinute: timeToMinutes(change.time.endTime),
        endDayOffset: change.time.endDayOffset, templateId: null, color: '#6172F3',
      };
    }

    const key = cellKey(change.cell);
    assignments.set(key, {
      id: assignments.get(key)?.id ?? randomUUID(), scheduleId: 1,
      employeeId: change.cell.employeeId, date: new Date(`${change.cell.date}T00:00:00.000Z`), ...timing,
    });
  }

  // Reinsert the final touched rows together so moves never collide with old cell keys.
  await transaction.shiftAssignment.deleteMany({ where: { id: { in: existing.map(assignment => assignment.id) } } });
  const finalAssignments = [...assignments.values()].sort((left, right) =>
    left.date.getTime() - right.date.getTime() || left.employeeId.localeCompare(right.employeeId));
  await transaction.shiftAssignment.createMany({ data: finalAssignments });

  const deletedCells = cells.filter(cell => !assignments.has(cellKey(cell))).sort((left, right) =>
    left.date.localeCompare(right.date) || left.employeeId.localeCompare(right.employeeId));

  return {
    requestId: request.requestId, revision: request.baseRevision,
    assignments: finalAssignments.map(assignmentResponse), deletedCells,
  };
}

export async function mutateSchedule(request: SaveScheduleRequest, kind: MutationKind): Promise<MutationResponse> {
  const hash = createHash('sha256').update(JSON.stringify(canonicalValue(request))).digest('hex');
  const cached = await prisma.scheduleRequest.findUnique({ where: { requestId: request.requestId } });
  if (cached) return replayRequest(cached, kind, hash);

  return prisma.$transaction(async (transaction) => {
    const [schedule] = await transaction.$queryRaw<Schedule[]>`
      SELECT id, revision, time_zone AS "timeZone" FROM schedules WHERE id = 1 FOR UPDATE
    `;
    if (!schedule) throw new Error('Schedule singleton is missing. Apply database migrations.');

    const completed = await transaction.scheduleRequest.findUnique({ where: { requestId: request.requestId } });
    if (completed) return replayRequest(completed, kind, hash);
    if (schedule.revision !== request.baseRevision) {
      throw new ApiError(409, {
        code: 'REVISION_CONFLICT', message: 'Расписание изменилось. Загрузите актуальную версию.',
        currentRevision: schedule.revision,
      });
    }

    const result = await applyChanges(transaction, request);
    const revision = request.changes.length > 0 || kind === 'publish'
      ? schedule.revision + 1
      : schedule.revision;
    await transaction.schedule.update({ where: { id: 1 }, data: { revision } });
    let response: MutationResponse = { ...result, revision };

    if (kind === 'publish') {
      const employees = await transaction.employee.findMany({ orderBy: [...employeeOrder] });
      const templates = await transaction.shiftTemplate.findMany({ orderBy: [...employeeOrder] });
      const assignments = await transaction.shiftAssignment.findMany({
        where: { scheduleId: 1 }, orderBy: [...assignmentOrder],
      });
      const snapshot: PublishedScheduleSnapshot = {
        schemaVersion: 1, revision, timeZone: schedule.timeZone, employees,
        templates: templates.map(templateResponse), assignments: assignments.map(assignmentResponse),
      };
      const publication = await transaction.schedulePublication.create({
        data: { scheduleId: 1, revision, snapshot: snapshot as unknown as Prisma.InputJsonObject },
      });
      response = { ...response, publication: publicationResponse(publication) };
    }

    await transaction.scheduleRequest.create({
      data: {
        requestId: request.requestId, scheduleId: 1, kind, payloadHash: hash,
        response: response as unknown as Prisma.InputJsonObject,
      },
    });
    return response;
  }, { isolationLevel: 'ReadCommitted', maxWait: 10_000, timeout: 15_000 });
}
