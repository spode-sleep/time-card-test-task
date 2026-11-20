import type { ScheduleCell } from '@time-card/shared';

export interface CellRectangle {
  from: ScheduleCell;
  to: ScheduleCell;
  base: ScheduleCell[];
}

export function rectangleCells(
  from: ScheduleCell,
  to: ScheduleCell,
  employeeIds: string[],
  dates: string[],
): ScheduleCell[] {
  const rows = [
    employeeIds.indexOf(from.employeeId),
    employeeIds.indexOf(to.employeeId),
  ];
  const columns = [dates.indexOf(from.date), dates.indexOf(to.date)];
  if ([...rows, ...columns].some((index) => index < 0)) return [];
  const cells: ScheduleCell[] = [];
  for (const employeeId of employeeIds.slice(
    Math.min(...rows),
    Math.max(...rows) + 1,
  )) {
    for (const date of dates.slice(
      Math.min(...columns),
      Math.max(...columns) + 1,
    ))
      cells.push({ employeeId, date });
  }
  return cells;
}
