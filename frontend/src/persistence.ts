import type {
  Employee,
  ScheduleCell,
  ScheduleChange,
  ScheduleRange,
  ShiftAssignment,
  ShiftTemplate,
} from '@time-card/shared';
import { calendarDays } from './calendar';

export function sameShift(
  a: ShiftAssignment | undefined,
  b: ShiftAssignment | undefined,
) {
  return !a || !b
    ? a === b
    : a.templateId === b.templateId &&
        a.startTime === b.startTime &&
        a.endTime === b.endTime &&
        a.endDayOffset === b.endDayOffset &&
        a.color === b.color;
}
export function cellFromKey(key: string): ScheduleCell {
  const [employeeId = '', date = ''] = key.split('/');
  return { employeeId, date };
}
export function matchesTemplate(
  shift: ShiftAssignment,
  templates: ShiftTemplate[],
) {
  const template = templates.find((item) => item.id === shift.templateId);
  return (
    !!template &&
    template.startTime === shift.startTime &&
    template.endTime === shift.endTime &&
    template.endDayOffset === shift.endDayOffset &&
    template.color === shift.color
  );
}
export function buildChanges(
  saved: Map<string, ShiftAssignment>,
  draft: Map<string, ShiftAssignment>,
  templates: ShiftTemplate[],
): ScheduleChange[] {
  const dirty = new Set(
    [...new Set([...saved.keys(), ...draft.keys()])].filter(
      (key) => !sameShift(saved.get(key), draft.get(key)),
    ),
  );
  const changes: ScheduleChange[] = [];
  const draftById = new Map([...draft].map((entry) => [entry[1].id, entry]));
  // Isolated moves retain their server identity and historical template snapshot.
  for (const [fromKey, original] of saved) {
    if (!dirty.has(fromKey) || draft.has(fromKey)) continue;
    const destination = draftById.get(original.id);
    if (
      !destination ||
      destination[0] === fromKey ||
      !dirty.has(destination[0]) ||
      !sameShift(original, destination[1])
    )
      continue;
    const [toKey] = destination;
    changes.push({
      type: 'move',
      from: cellFromKey(fromKey),
      to: cellFromKey(toKey),
      replaceExisting: saved.has(toKey),
    });
    dirty.delete(fromKey);
    dirty.delete(toKey);
  }
  for (const key of [...dirty].sort()) {
    const shift = draft.get(key);
    const cell = cellFromKey(key);
    if (!shift) changes.push({ type: 'delete', cell });
    else if (shift.templateId) {
      if (!matchesTemplate(shift, templates))
        throw new Error(
          'Шаблон изменился. Сравните черновик с сервером перед сохранением.',
        );
      changes.push({
        type: 'assign-template',
        cell,
        templateId: shift.templateId,
      });
    } else
      changes.push({
        type: 'assign-custom',
        cell,
        time: {
          startTime: shift.startTime,
          endTime: shift.endTime,
          endDayOffset: shift.endDayOffset,
        },
      });
  }
  return changes;
}
export function dateRanges(dates: Set<string>): ScheduleRange[] {
  // Read loaded dates in month-sized chunks; holes and distant cached periods do not inflate a request.
  const sorted = [...dates].sort();
  const result: ScheduleRange[] = [];
  for (const date of sorted) {
    const last = result.at(-1);
    const next = last ? new Date(`${last.to}T00:00:00.000Z`) : null;
    next?.setUTCDate(next.getUTCDate() + 1);
    if (
      last &&
      next?.toISOString().slice(0, 10) === date &&
      calendarDays({ from: last.from, to: date }).length <= 31
    )
      last.to = date;
    else result.push({ from: date, to: date });
  }
  return result;
}
export interface CellConflict {
  key: string;
  cell: ScheduleCell;
  employeeName: string;
  before: ShiftAssignment | undefined;
  local: ShiftAssignment | undefined;
  remote: ShiftAssignment | undefined;
  localAllowed: boolean;
  note: string;
}
export function mergeDraft(
  base: Map<string, ShiftAssignment>,
  local: Map<string, ShiftAssignment>,
  remote: Map<string, ShiftAssignment>,
  employees: Employee[],
  templates: ShiftTemplate[],
) {
  const merged = new Map(
    [...remote].map(([key, shift]) => [key, { ...shift }]),
  );
  const conflicts: CellConflict[] = [];
  for (const key of new Set([...base.keys(), ...local.keys()])) {
    const before = base.get(key),
      mine = local.get(key),
      theirs = remote.get(key);
    if (sameShift(before, mine) || sameShift(mine, theirs)) continue;
    const cell = cellFromKey(key);
    const employee = employees.find((item) => item.id === cell.employeeId);
    const staleTemplate =
      !!mine?.templateId && !matchesTemplate(mine, templates);
    const candidate = staleTemplate
      ? { ...mine!, templateId: null, color: '#6172F3' }
      : mine;
    if (!employee || staleTemplate || !sameShift(before, theirs)) {
      conflicts.push({
        key,
        cell,
        employeeName: employee?.fullName ?? cell.employeeId,
        before,
        local: candidate,
        remote: theirs,
        localAllowed: !!employee,
        note: !employee
          ? 'Сотрудник удалён с сервера. Его смену восстановить нельзя.'
          : staleTemplate
            ? 'Шаблон изменён или удалён. Ваши часы можно оставить как собственную смену.'
            : '',
      });
    } else if (candidate) merged.set(key, { ...candidate });
    else merged.delete(key);
  }
  return { merged, conflicts };
}
