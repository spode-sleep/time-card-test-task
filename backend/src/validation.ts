import * as z from 'zod';
import type { SaveScheduleRequest, ScheduleRange } from '@time-card/shared';
import { LOCAL_TIME_PATTERN, isValidShiftTime } from '@time-card/shared';
import { ApiError } from './errors.js';
import { cellKey } from './schedule-mapping.js';

const uuid = z.uuid().transform(value => value.toLowerCase());
const date = z.string().refine((value) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || value.startsWith('0000')) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}, 'Укажите существующую дату в формате YYYY-MM-DD.');

const cell = z.strictObject({ employeeId: uuid, date });
const localTime = z.string().regex(LOCAL_TIME_PATTERN, 'Укажите время в формате HH:mm.');
const time = z.strictObject({
  startTime: localTime,
  endTime: localTime,
  endDayOffset: z.union([z.literal(0), z.literal(1)]),
}).refine(isValidShiftTime, 'Время окончания и переход через полночь должны задавать смену длительностью менее суток.');

export const scheduleRangeSchema: z.ZodType<ScheduleRange> = z.strictObject({ from: date, to: date })
  .refine(value => value.from <= value.to, { message: 'Конец периода раньше начала.', path: ['to'] });

export const saveScheduleSchema: z.ZodType<SaveScheduleRequest> = z.strictObject({
  requestId: uuid,
  baseRevision: z.number().int().min(0).max(2_147_483_647),
  changes: z.array(z.discriminatedUnion('type', [
    z.strictObject({ type: z.literal('assign-template'), cell, templateId: uuid }),
    z.strictObject({ type: z.literal('assign-custom'), cell, time }),
    z.strictObject({ type: z.literal('delete'), cell }),
    z.strictObject({
      type: z.literal('move'), from: cell, to: cell, replaceExisting: z.boolean(),
    }).refine(value => cellKey(value.from) !== cellKey(value.to), 'Выберите другую ячейку для переноса.'),
  ])).max(1000, 'В одном запросе допускается до 1000 изменений.'),
});

export function parseRequest<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;

  const details: Record<string, string[]> = {};
  for (const issue of result.error.issues) {
    const path = issue.path.map(String).join('.') || 'body';
    (details[path] ??= []).push(issue.message);
  }

  throw new ApiError(400, { code: 'VALIDATION_ERROR', message: 'Проверьте параметры запроса.', details });
}
