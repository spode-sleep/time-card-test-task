import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  calendarDays,
  isCalendarDate,
  normalizeName,
  periodLabel,
  periodRange,
  shiftAnchor,
  todayInTimeZone,
} from '../src/calendar';

afterEach(() => vi.unstubAllEnvs());

describe('calendar dates independent of the browser time zone', () => {
  it.each([
    ['2026-11-19', '2026-11-16', '2026-11-22'],
    ['2026-11-01', '2026-10-26', '2026-11-01'],
    ['2026-11-30', '2026-11-30', '2026-12-06'],
    ['2027-01-01', '2026-12-28', '2027-01-03'],
  ])('builds a Monday–Sunday week around %s', (anchor, from, to) => {
    const range = periodRange(anchor, 'week');
    expect(range).toEqual({ from, to });
    const days = calendarDays(range);
    expect(days).toHaveLength(7);
    expect(days[0]?.weekday).toBe('пн');
    expect(days[6]?.weekday).toBe('вс');
    expect(days.map((day) => day.weekend)).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
    ]);
  });

  it.each([
    ['2024-02-10', 29, '2024-02-29'],
    ['2026-02-10', 28, '2026-02-28'],
    ['2026-04-30', 30, '2026-04-30'],
    ['2026-12-31', 31, '2026-12-31'],
  ])(
    'includes every day of the month containing %s',
    (anchor, length, last) => {
      const range = periodRange(anchor, 'month');
      expect(range.to).toBe(last);
      expect(calendarDays(range)).toHaveLength(length);
      expect(calendarDays(range)[0]?.number).toBe('1');
    },
  );

  it.each(['America/Los_Angeles', 'Pacific/Kiritimati', 'Europe/Moscow'])(
    'keeps dates and labels stable in %s, including DST boundaries',
    (zone) => {
      vi.stubEnv('TZ', zone);
      const spring = calendarDays(periodRange('2026-03-08', 'week'));
      expect(spring.map((day) => day.date)).toEqual([
        '2026-03-02',
        '2026-03-03',
        '2026-03-04',
        '2026-03-05',
        '2026-03-06',
        '2026-03-07',
        '2026-03-08',
      ]);
      expect(spring[6]?.number).toBe('8');
      expect(spring[6]?.label).toBe('воскресенье, 8 марта 2026');
      expect(periodRange('2026-11-01', 'week')).toEqual({
        from: '2026-10-26',
        to: '2026-11-01',
      });
    },
  );

  it('navigates months without overflowing short months', () => {
    expect(shiftAnchor('2024-01-31', 'month', 1)).toBe('2024-02-29');
    expect(shiftAnchor('2026-01-31', 'month', 1)).toBe('2026-02-28');
    expect(shiftAnchor('2026-03-31', 'month', -1)).toBe('2026-02-28');
    expect(shiftAnchor('2026-12-31', 'month', 1)).toBe('2027-01-31');
    expect(shiftAnchor('2026-12-31', 'week', 1)).toBe('2027-01-07');
  });

  it('uses the organization date near midnight rather than the browser date', () => {
    const now = new Date('2026-11-18T22:30:00Z');
    expect(todayInTimeZone('Europe/Moscow', now)).toBe('2026-11-19');
    expect(todayInTimeZone('America/New_York', now)).toBe('2026-11-18');
    expect(todayInTimeZone('Pacific/Kiritimati', now)).toBe('2026-11-19');
  });

  it('labels periods across months and years explicitly', () => {
    expect(periodLabel(periodRange('2026-11-19', 'week'), 'week')).toBe(
      '16–22 ноября 2026',
    );
    expect(periodLabel(periodRange('2026-11-30', 'week'), 'week')).toBe(
      '30 ноября — 6 декабря 2026',
    );
    expect(periodLabel(periodRange('2027-01-01', 'week'), 'week')).toBe(
      '28 декабря 2026 — 3 января 2027',
    );
    expect(periodLabel(periodRange('2024-02-29', 'month'), 'month')).toBe(
      'Февраль 2024',
    );
  });

  it('rejects nonexistent dates and limits navigation to the API year range', () => {
    for (const date of [
      '2026-02-29',
      '2026-11-31',
      '0000-01-01',
      '10000-01-01',
      '19.11.2026',
      '2026-1-01',
    ]) {
      expect(isCalendarDate(date)).toBe(false);
    }
    expect(isCalendarDate('2024-02-29')).toBe(true);
    expect(isCalendarDate('0001-01-01')).toBe(true);
    expect(shiftAnchor('0001-01-01', 'month', -1)).toBeNull();
    expect(shiftAnchor('9999-12-31', 'week', 1)).toBeNull();
    expect(periodRange('9999-12-31', 'week').to).toBe('9999-12-31');
    expect(() => periodRange('2026-02-29', 'month')).toThrow(RangeError);
  });

  it('normalizes whitespace, case and Russian ё in a name query', () => {
    expect(normalizeName('  СОКОЛОВ\t  Артём  ')).toBe('соколов артем');
  });
});
