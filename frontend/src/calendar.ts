import type { ScheduleCell, ScheduleRange, ShiftTime } from '@time-card/shared';
import { UTCDateMini } from '@date-fns/utc';
import {
  addDays,
  addMonths,
  eachDayOfInterval,
  endOfISOWeek,
  endOfMonth,
  format,
  isWeekend,
  startOfISOWeek,
  startOfMonth,
} from 'date-fns';
import { ru } from 'date-fns/locale';

export type CalendarView = 'week' | 'month';
export interface ScheduleDay {
  date: string;
  weekday: string;
  number: string;
  label: string;
  weekend: boolean;
}

// Dates remain calendar strings. The explicit UTC carrier makes date-fns
// arithmetic independent of the browser's time zone and DST; it is not a shift timestamp.
function dateCarrier(date: string): InstanceType<typeof UTCDateMini> {
  return new UTCDateMini(`${date}T00:00:00.000Z`);
}
function calendarString(date: Date): string {
  return `${String(date.getUTCFullYear()).padStart(4, '0')}-${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}
export function isCalendarDate(date: string): boolean {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(date) &&
    Number(date.slice(0, 4)) > 0 &&
    calendarString(dateCarrier(date)) === date
  );
}
export function todayInTimeZone(timeZone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat('en', {
    timeZone,
    calendar: 'iso8601',
    numberingSystem: 'latn',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((item) => item.type === type)?.value ?? '';
  return `${part('year').padStart(4, '0')}-${part('month')}-${part('day')}`;
}
export function periodRange(anchor: string, view: CalendarView): ScheduleRange {
  if (!isCalendarDate(anchor)) throw new RangeError('Invalid calendar date');
  const date = dateCarrier(anchor);
  const start = view === 'week' ? startOfISOWeek(date) : startOfMonth(date);
  const end = view === 'week' ? endOfISOWeek(date) : endOfMonth(date);
  // API dates use four-digit years, including at the edges of the last week.
  return {
    from: calendarString(
      new UTCDateMini(
        Math.max(start.getTime(), dateCarrier('0001-01-01').getTime()),
      ),
    ),
    to: calendarString(
      new UTCDateMini(
        Math.min(end.getTime(), dateCarrier('9999-12-31').getTime()),
      ),
    ),
  };
}
export function calendarDays(range: ScheduleRange): ScheduleDay[] {
  return eachDayOfInterval({
    start: dateCarrier(range.from),
    end: dateCarrier(range.to),
  }).map((date) => ({
    date: calendarString(date),
    weekday: format(date, 'EEEEEE', { locale: ru }),
    number: String(date.getDate()),
    label: format(date, 'EEEE, d MMMM yyyy', { locale: ru }),
    weekend: isWeekend(date),
  }));
}
export function shiftAnchor(
  anchor: string,
  view: CalendarView,
  direction: -1 | 1,
): string | null {
  const date = dateCarrier(anchor);
  const next = calendarString(
    view === 'week' ? addDays(date, direction * 7) : addMonths(date, direction),
  );
  return isCalendarDate(next) ? next : null;
}
export function periodLabel(range: ScheduleRange, view: CalendarView): string {
  const start = dateCarrier(range.from);
  const end = dateCarrier(range.to);
  const label = (date: Date, pattern: string) =>
    format(date, pattern, { locale: ru });
  if (view === 'month') {
    const month = label(start, 'LLLL yyyy');
    return month.charAt(0).toLocaleUpperCase('ru-RU') + month.slice(1);
  }
  if (start.getFullYear() !== end.getFullYear())
    return `${label(start, 'd MMMM yyyy')} — ${label(end, 'd MMMM yyyy')}`;
  if (start.getMonth() !== end.getMonth())
    return `${label(start, 'd MMMM')} — ${label(end, 'd MMMM yyyy')}`;
  return `${label(start, 'd')}–${label(end, 'd MMMM yyyy')}`;
}
export function normalizeName(value: string): string {
  return value
    .normalize('NFKC')
    .trim()
    .replace(/\s+/gu, ' ')
    .toLocaleLowerCase('ru-RU')
    .replaceAll('ё', 'е');
}

export function cellKey(cell: ScheduleCell): string {
  return `${cell.employeeId}/${cell.date}`;
}

function timeMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3));
}

export function shiftMinutes(time: ShiftTime): number {
  return (
    timeMinutes(time.endTime) +
    time.endDayOffset * 1440 -
    timeMinutes(time.startTime)
  );
}

export { isValidShiftTime } from '@time-card/shared';

export function formatDuration(time: ShiftTime): string {
  const minutes = shiftMinutes(time);
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return [hours ? `${hours} ч` : '', remainder ? `${remainder} мин` : '']
    .filter(Boolean)
    .join(' ');
}

export function formatHours(minutes: number): string {
  return new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 2 }).format(
    minutes / 60,
  );
}

export function shiftHours(
  startTime: string,
  endTime: string,
  endDayOffset: number,
): string {
  return formatHours(
    timeMinutes(endTime) + endDayOffset * 1440 - timeMinutes(startTime),
  );
}

export function formatShiftTime(time: string): string {
  return time.endsWith(':00') ? time.slice(0, 2) : time;
}
