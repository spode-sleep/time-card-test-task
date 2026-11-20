import type { ShiftTime } from './schedule.js';

export const LOCAL_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export function isValidLocalTime(value: string): boolean {
  return LOCAL_TIME_PATTERN.test(value);
}

export function createShiftTime(
  startTime: string,
  endTime: string,
): ShiftTime | null {
  if (
    !isValidLocalTime(startTime) ||
    !isValidLocalTime(endTime) ||
    startTime === endTime
  )
    return null;
  return { startTime, endTime, endDayOffset: endTime < startTime ? 1 : 0 };
}

export function isValidShiftTime(time: ShiftTime): boolean {
  const normalized = createShiftTime(time.startTime, time.endTime);
  return normalized !== null && time.endDayOffset === normalized.endDayOffset;
}
