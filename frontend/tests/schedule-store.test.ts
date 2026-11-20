import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type {
  Employee,
  ScheduleCell,
  ScheduleResponse,
  ShiftAssignment,
  ShiftTemplate,
  ShiftTime,
} from '@time-card/shared';
import { AxiosError } from 'axios';
import { loadErrorMessage, scheduleApi } from '../src/api/schedule';
import { cellKey, periodRange } from '../src/calendar';
import { useScheduleStore } from '../src/stores/schedule';

vi.mock('../src/api/schedule', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/schedule')>();
  return {
    ...actual,
    scheduleApi: { employees: vi.fn(), templates: vi.fn(), schedule: vi.fn() },
  };
});

const people: Employee[] = [
  {
    id: 'employee-1',
    fullName: 'Кузнецова Алина',
    position: 'агент',
    avatarUrl: null,
    sortOrder: 0,
  },
  {
    id: 'employee-2',
    fullName: 'Волков Тимур',
    position: 'агент',
    avatarUrl: null,
    sortOrder: 1,
  },
];
const template: ShiftTemplate = {
  id: 'morning',
  code: 'morning',
  name: 'Утро',
  startTime: '07:00',
  endTime: '15:00',
  endDayOffset: 0,
  color: '#E8ECFF',
  sortOrder: 0,
};
const first: ScheduleCell = { employeeId: 'employee-1', date: '2026-11-19' };
const second: ScheduleCell = { employeeId: 'employee-2', date: '2026-11-19' };
const nextDay: ScheduleCell = { employeeId: 'employee-1', date: '2026-11-20' };
const originalShift: ShiftAssignment = {
  ...first,
  id: 'assignment-1',
  templateId: template.id,
  startTime: template.startTime,
  endTime: template.endTime,
  endDayOffset: 0,
  color: template.color,
};
const initialRange = periodRange('2026-11-19', 'week');
const response: ScheduleResponse = {
  ...initialRange,
  revision: 7,
  timeZone: 'Europe/Moscow',
  assignments: [originalShift],
  latestPublication: {
    id: 'publication-1',
    revision: 5,
    publishedAt: '2026-11-18T09:00:00.000Z',
  },
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((finish) => {
    resolve = finish;
  });
  return { promise, resolve };
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
  setActivePinia(createPinia());
  vi.resetAllMocks();
  vi.mocked(scheduleApi.employees).mockResolvedValue({
    employees: structuredClone(people),
  });
  vi.mocked(scheduleApi.templates).mockResolvedValue({
    templates: [structuredClone(template)],
  });
  vi.mocked(scheduleApi.schedule).mockImplementation(async (range) => ({
    ...structuredClone(response),
    ...range,
    assignments: response.assignments
      .filter((shift) => shift.date >= range.from && shift.date <= range.to)
      .map((shift) => ({ ...shift })),
  }));
});
afterEach(() => vi.useRealTimers());

describe('loading the editor', () => {
  it('waits for all data, coalesces concurrent loads and keeps the revision with its snapshot', async () => {
    const pending = deferred<ScheduleResponse>();
    vi.mocked(scheduleApi.schedule).mockReturnValueOnce(pending.promise);
    const store = useScheduleStore();
    const firstLoad = store.load();
    const secondLoad = store.load();
    await Promise.resolve();
    expect(store.loading).toBe(true);
    expect(store.loaded).toBe(false);
    expect(store.employees).toEqual([]);
    expect(store.revision).toBeNull();
    expect(scheduleApi.schedule).toHaveBeenCalledTimes(1);
    expect(scheduleApi.schedule).toHaveBeenCalledWith(initialRange);
    pending.resolve(structuredClone(response));
    expect(await firstLoad).toBe(true);
    expect(await secondLoad).toBe(true);
    expect(store.loading).toBe(false);
    expect(store.revision).toBe(7);
    expect(store.timeZone).toBe('Europe/Moscow');
    expect(store.latestPublication).toEqual(response.latestPublication);
    expect(store.draftByCell.get(cellKey(first))).toEqual(originalShift);
    expect(store.hasUnsavedChanges).toBe(false);
  });

  it('keeps partial responses out of the editor and allows retry after a failure', async () => {
    vi.mocked(scheduleApi.templates).mockRejectedValueOnce(
      new Error('database details must stay private'),
    );
    const store = useScheduleStore();
    expect(await store.load()).toBe(false);
    expect(store.loadError).toContain('Не удалось загрузить');
    expect(store.loadError).not.toContain('database');
    expect(store.loading).toBe(false);
    expect(store.loaded).toBe(false);
    expect(store.employees).toEqual([]);
    expect(store.draftByCell.size).toBe(0);
    expect(await store.load()).toBe(true);
    expect(store.loaded).toBe(true);
    expect(store.loadError).toBeNull();
  });

  it('rejects an unexpected period without committing its data', async () => {
    vi.mocked(scheduleApi.schedule).mockResolvedValueOnce({
      ...response,
      from: '2026-10-01',
    });
    const store = useScheduleStore();
    expect(await store.load()).toBe(false);
    expect(store.loadedRange).toBeNull();
    expect(store.revision).toBeNull();
    expect(store.employees).toEqual([]);
  });

  it('does not reload or overwrite an edited draft on a repeated mount', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyTemplate([second], template.id);
    await store.load();
    expect(scheduleApi.schedule).toHaveBeenCalledTimes(1);
    expect(store.draftByCell.has(cellKey(second))).toBe(true);
    expect(store.hasUnsavedChanges).toBe(true);
    expect(store.savedByCell.size).toBe(1);
    expect(store.revision).toBe(7);
  });

  it.each(['ECONNABORTED', 'ETIMEDOUT'])(
    'reports timeout %s without exposing internals',
    (code) => {
      expect(loadErrorMessage(new AxiosError('private', code))).toContain(
        'не ответил вовремя',
      );
    },
  );
});

describe('a single draft for all editing actions', () => {
  it('edits actual assigned hours, preserves identity and keeps the saved snapshot independent', async () => {
    const store = useScheduleStore();
    await store.load();
    store.startTime = '08:15';
    store.endTime = '16:45';
    store.selectCell(first);
    expect(store.canEditTime).toBe(true);
    expect(store.editSelectedShift()).toBe(true);
    expect(store.startTime).toBe('07:00');
    expect(store.endTime).toBe('15:00');
    expect(store.hasUnsavedChanges).toBe(false);
    expect(
      store.submitCustomTime({
        startTime: '22:45',
        endTime: '06:15',
        endDayOffset: 1,
      }),
    ).toBe(true);
    expect(store.draftByCell.get(cellKey(first))).toMatchObject({
      id: originalShift.id,
      templateId: null,
      startTime: '22:45',
      endTime: '06:15',
      endDayOffset: 1,
    });
    expect(store.savedByCell.get(cellKey(first))).toEqual(originalShift);
    expect(store.coverage.get(first.date)).toBe(1);
    expect(store.visibleEmployees[0]?.hours).toBe('7,5');
    expect(store.editingCell).toBeNull();
    expect([store.startTime, store.endTime]).toEqual(['08:15', '16:45']);
    expect(store.selected.size).toBe(0);
    expect(
      store.submitCustomTime({
        startTime: '08:15',
        endTime: '16:45',
        endDayOffset: 0,
      }),
    ).toBe(false);
    expect(store.draftByCell.get(cellKey(first))?.startTime).toBe('22:45');
    expect(store.hasUnsavedChanges).toBe(true);
  });

  it('preserves the original template on an unchanged edit and discards unapplied input on cancel', async () => {
    const store = useScheduleStore();
    await store.load();
    store.startEditing(first);
    expect(
      store.submitCustomTime({
        startTime: '07:00',
        endTime: '15:00',
        endDayOffset: 0,
      }),
    ).toBe(true);
    expect(store.draftByCell.get(cellKey(first))).toEqual(originalShift);
    expect(store.hasUnsavedChanges).toBe(false);
    store.startEditing(first);
    store.startTime = '23:59';
    store.endTime = '00:00';
    store.cancelEditing();
    expect([store.startTime, store.endTime]).toEqual(['09:00', '17:00']);
    expect(store.draftByCell.get(cellKey(first))).toEqual(originalShift);
    expect(store.hasUnsavedChanges).toBe(false);
  });

  it('rejects invalid edits atomically and cannot edit an empty or multiple selection', async () => {
    const store = useScheduleStore();
    await store.load();
    expect(store.startEditing(second)).toBe(false);
    store.setSelection([first, second]);
    expect(store.editSelectedShift()).toBe(false);
    store.startEditing(first);
    expect(
      store.submitCustomTime({
        startTime: '09:00',
        endTime: '09:00',
        endDayOffset: 0,
      }),
    ).toBe(false);
    expect(
      store.submitCustomTime({
        startTime: '22:00',
        endTime: '06:00',
        endDayOffset: 0,
      }),
    ).toBe(false);
    expect(store.editingCell).toEqual(first);
    expect(store.draftByCell.get(cellKey(first))).toEqual(originalShift);
    expect(store.hasUnsavedChanges).toBe(false);
    store.cancelEditing();
    expect(store.editError).toBeNull();
  });

  it('cancels editing when the active cell is replaced, deleted, hidden or left behind', async () => {
    const store = useScheduleStore();
    await store.load();
    store.startEditing(first);
    store.selectCell(second, true);
    expect(store.editingCell).toBeNull();
    store.startEditing(first);
    store.query = 'Волков';
    expect(store.editingCell).toBeNull();
    store.query = '';
    store.startEditing(first);
    store.chooseTemplate(template.id);
    expect(store.editingCell).toBeNull();
    store.startEditing(first);
    store.deleteShifts([first]);
    expect(store.editingCell).toBeNull();
    expect(store.selected.size).toBe(1);
    expect(store.canDeleteShifts).toBe(false);
    store.applyTemplate([first], template.id);
    store.startEditing(first);
    await store.navigate(1);
    expect(store.editingCell).toBeNull();
    expect(store.startTime).toBe('09:00');
  });
  it('updates coverage once per employee/date and keeps the loaded snapshot independent', async () => {
    const store = useScheduleStore();
    await store.load();
    expect(store.applyTemplate([first, second, second], template.id)).toBe(
      true,
    );
    expect(store.draftByCell.size).toBe(2);
    expect(store.coverage.get(first.date)).toBe(2);
    expect(store.visibleEmployees.map((employee) => employee.hours)).toEqual([
      '8',
      '8',
    ]);
    expect(store.savedByCell.get(cellKey(first))).toEqual(originalShift);
    expect(store.savedByCell.has(cellKey(second))).toBe(false);
    expect(store.dirtyCells.size).toBe(1);
    expect(store.revision).toBe(7);
    store.applyCustomShift([first], {
      startTime: '10:15',
      endTime: '12:45',
      endDayOffset: 0,
    });
    expect(store.coverage.get(first.date)).toBe(2);
    expect(store.visibleEmployees[0]?.hours).toBe('2,5');
    expect(store.savedByCell.get(cellKey(first))?.startTime).toBe('07:00');
    expect(store.dirtyCells.size).toBe(2);
  });

  it('treats change-and-revert and add-then-delete as pristine', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyCustomShift([first], {
      startTime: '10:00',
      endTime: '12:00',
      endDayOffset: 0,
    });
    expect(store.hasUnsavedChanges).toBe(true);
    store.applyTemplate([first], template.id);
    expect(store.hasUnsavedChanges).toBe(false);
    store.applyTemplate([second], template.id);
    store.deleteShifts([second]);
    expect(store.hasUnsavedChanges).toBe(false);
    store.deleteShifts([first]);
    expect(store.hasUnsavedChanges).toBe(true);
    store.applyTemplate([first], template.id);
    expect(store.hasUnsavedChanges).toBe(false);
    expect(store.draftByCell.get(cellKey(first))?.id).not.toBe(
      originalShift.id,
    );
  });

  it('keeps coverage global while filtering rows and keeps the draft across both views', async () => {
    const store = useScheduleStore();
    await store.load();
    store.view = 'month';
    await store.load();
    store.applyTemplate(
      [second, { ...second, date: '2026-11-01' }],
      template.id,
    );
    store.view = 'week';
    await store.load();
    store.toggleCell(first);
    store.query = '  вОЛКОВ  ';
    expect(store.selected.size).toBe(0);
    expect(store.visibleEmployees.map((employee) => employee.id)).toEqual([
      'employee-2',
    ]);
    expect(store.coverage.get(first.date)).toBe(2);
    expect(store.visibleEmployees[0]?.hours).toBe('8');
    store.toggleCell(second);
    store.view = 'month';
    expect(store.selected.size).toBe(0);
    expect(store.days).toHaveLength(30);
    expect(store.visibleEmployees[0]?.hours).toBe('16');
    expect(store.draftByCell.size).toBe(3);
    expect(store.hasUnsavedChanges).toBe(true);
    store.view = 'week';
    expect(store.visibleAssignments).toHaveLength(2);
    expect(store.days).toHaveLength(7);
    expect(store.draftByCell.size).toBe(3);
    store.query = 'несуществующий';
    expect(store.visibleEmployees).toEqual([]);
    expect(store.coverage.get(first.date)).toBe(2);
  });

  it('supports overnight times and minute precision', async () => {
    const store = useScheduleStore();
    await store.load();
    expect(
      store.applyCustomShift([second], {
        startTime: '22:45',
        endTime: '06:15',
        endDayOffset: 1,
      }),
    ).toBe(true);
    expect(store.draftByCell.get(cellKey(second))?.templateId).toBeNull();
    expect(store.visibleEmployees[1]?.hours).toBe('7,5');
    expect(store.coverage.get(first.date)).toBe(2);
  });

  it.each<ShiftTime>([
    { startTime: '12:00', endTime: '12:00', endDayOffset: 0 },
    { startTime: '24:00', endTime: '01:00', endDayOffset: 1 },
    { startTime: '22:00', endTime: '06:00', endDayOffset: 0 },
    { startTime: '07:00', endTime: '15:00', endDayOffset: 1 },
  ])(
    'rejects invalid time without a partial edit: $startTime–$endTime / $endDayOffset',
    async (time) => {
      const store = useScheduleStore();
      await store.load();
      expect(store.applyCustomShift([first, second], time)).toBe(false);
      expect(store.draftByCell.size).toBe(1);
      expect(store.hasUnsavedChanges).toBe(false);
      expect(store.editError).not.toBeNull();
    },
  );

  it('rejects the whole batch if it contains an unknown employee or unloaded date', async () => {
    const store = useScheduleStore();
    await store.load();
    expect(
      store.applyTemplate(
        [second, { ...second, employeeId: 'missing' }],
        template.id,
      ),
    ).toBe(false);
    expect(
      store.applyTemplate(
        [second, { ...second, date: '2026-11-31' }],
        template.id,
      ),
    ).toBe(false);
    expect(
      store.applyTemplate(
        [second, { ...second, date: '2026-12-01' }],
        template.id,
      ),
    ).toBe(false);
    expect(store.draftByCell.size).toBe(1);
    expect(store.hasUnsavedChanges).toBe(false);
    expect(store.applyTemplate([second], 'missing')).toBe(false);
    expect(store.deleteShifts([])).toBe(false);
  });

  it('moves the actual snapshot, preserves its ID and requires explicit replacement', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyCustomShift([second], {
      startTime: '20:00',
      endTime: '23:00',
      endDayOffset: 0,
    });
    const before = structuredClone(
      [...store.draftByCell.values()].map((shift) => ({ ...shift })),
    );
    expect(store.moveShift(first, second)).toBe(false);
    expect([...store.draftByCell.values()]).toEqual(before);
    expect(store.moveShift(first, nextDay)).toBe(true);
    expect(store.draftByCell.has(cellKey(first))).toBe(false);
    expect(store.draftByCell.get(cellKey(nextDay))).toMatchObject({
      ...originalShift,
      ...nextDay,
    });
    expect(store.coverage.get(first.date)).toBe(1);
    expect(store.coverage.get(nextDay.date)).toBe(1);
    expect(store.moveShift(nextDay, second, true)).toBe(true);
    expect(store.draftByCell.size).toBe(1);
    expect(store.draftByCell.get(cellKey(second))?.id).toBe(originalShift.id);
    expect(store.coverage.get(nextDay.date) ?? 0).toBe(0);
    expect(store.savedByCell.get(cellKey(first))).toEqual(originalShift);
  });

  it('rejects a move from an empty cell and a move onto itself', async () => {
    const store = useScheduleStore();
    await store.load();
    expect(store.moveShift(second, nextDay)).toBe(false);
    expect(store.moveShift(first, first)).toBe(false);
    expect(store.hasUnsavedChanges).toBe(false);
  });

  it('returns to a pristine snapshot after moving away and back, including across cached periods', async () => {
    const store = useScheduleStore();
    await store.load();
    expect(store.moveShift(first, nextDay)).toBe(true);
    expect(store.dirtyCells.size).toBe(2);
    await store.navigate(1);
    await store.navigate(-1);
    expect(store.draftByCell.has(cellKey(first))).toBe(false);
    expect(store.draftByCell.get(cellKey(nextDay))?.id).toBe(originalShift.id);
    expect(store.moveShift(nextDay, first)).toBe(true);
    expect(store.hasUnsavedChanges).toBe(false);
    expect(store.draftByCell.get(cellKey(first))).toEqual(originalShift);
    expect(store.coverage.get(nextDay.date) ?? 0).toBe(0);
  });

  it('moves overnight custom hours and rejects an unloaded or unknown destination atomically', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyCustomShift([second], {
      startTime: '22:45',
      endTime: '06:15',
      endDayOffset: 1,
    });
    const overnight = { ...store.draftByCell.get(cellKey(second))! };
    const before = [...store.draftByCell.values()].map((shift) => ({
      ...shift,
    }));
    expect(
      store.moveShift(second, { ...first, employeeId: 'missing' }, true),
    ).toBe(false);
    expect(
      store.moveShift(second, { ...first, date: '2026-12-01' }, true),
    ).toBe(false);
    expect([...store.draftByCell.values()]).toEqual(before);
    expect(store.moveShift(second, first, true)).toBe(true);
    expect(store.draftByCell.get(cellKey(first))).toEqual({
      ...overnight,
      ...first,
    });
    expect(store.draftByCell.size).toBe(1);
    expect(store.coverage.get(first.date)).toBe(1);
    expect(store.visibleEmployees.map((employee) => employee.hours)).toEqual([
      '7,5',
      '0',
    ]);
    expect(store.savedByCell.get(cellKey(first))).toEqual(originalShift);
  });

  it('cannot edit before loading and permits custom shifts when no templates exist', async () => {
    const store = useScheduleStore();
    expect(
      store.applyCustomShift([first], {
        startTime: '09:00',
        endTime: '17:00',
        endDayOffset: 0,
      }),
    ).toBe(false);
    vi.mocked(scheduleApi.templates).mockResolvedValue({ templates: [] });
    await store.load();
    expect(store.activeTemplateId).toBe('');
    expect(
      store.applyCustomShift([second], {
        startTime: '09:00',
        endTime: '17:00',
        endDayOffset: 0,
      }),
    ).toBe(true);
    expect(store.coverage.get(first.date)).toBe(2);
  });
});

describe('period navigation and cached drafts', () => {
  it('selects a single cell and toggles additive cells without editing the draft', async () => {
    const store = useScheduleStore();
    await store.load();
    expect(store.selectCell(first)).toBe(true);
    store.selectCell(second, true);
    expect(store.selected.size).toBe(2);
    store.selectCell(first, true);
    expect([...store.selected]).toEqual([cellKey(second)]);
    store.selectCell(nextDay);
    expect([...store.selected]).toEqual([cellKey(nextDay)]);
    expect(store.hasUnsavedChanges).toBe(false);
  });

  it('selects rectangles in both directions using visible rows, preserving an additive base', async () => {
    const store = useScheduleStore();
    await store.load();
    expect(
      store.selectRectangle(
        { ...first, date: '2026-11-20' },
        { ...second, date: '2026-11-17' },
      ),
    ).toBe(true);
    expect(store.selected.size).toBe(8);
    const base = [{ ...first, date: '2026-11-22' }];
    store.selectRectangle(first, second, base);
    expect(store.selected.size).toBe(3);
    store.selectRectangle(first, first, base);
    expect(store.selected.size).toBe(2);
    expect(store.selected.has(cellKey(base[0]!))).toBe(true);
    store.query = 'Алина';
    store.selectRectangle({ ...first, date: '2026-11-17' }, nextDay);
    expect(store.selected.size).toBe(4);
    expect(
      store.selectedCells.every((cell) => cell.employeeId === first.employeeId),
    ).toBe(true);
  });

  it('rejects hidden or unloaded selections without partially changing the selected cells', async () => {
    const store = useScheduleStore();
    await store.load();
    store.query = 'Алина';
    store.selectCell(first);
    expect(store.setSelection([first, second])).toBe(false);
    expect(store.selectRectangle(first, second)).toBe(false);
    expect(store.setSelection([{ ...first, date: '2026-12-01' }])).toBe(false);
    expect([...store.selected]).toEqual([cellKey(first)]);
    expect(store.setSelection([])).toBe(true);
    expect(store.selected.size).toBe(0);
  });

  it('chooses a template without editing when nothing is selected and applies it repeatedly to a selection', async () => {
    const dayTemplate = {
      ...template,
      id: 'day',
      code: 'day',
      startTime: '10:00',
      endTime: '18:00',
      color: '#E9DFFF',
    };
    vi.mocked(scheduleApi.templates).mockResolvedValueOnce({
      templates: [template, dayTemplate],
    });
    const store = useScheduleStore();
    await store.load();
    store.chooseTemplate(dayTemplate.id);
    expect(store.activeTemplateId).toBe('day');
    expect(store.hasUnsavedChanges).toBe(false);
    store.setSelection([first, second]);
    expect(store.chooseTemplate(dayTemplate.id)).toBe(true);
    expect(store.coverage.get(first.date)).toBe(2);
    expect(store.draftByCell.get(cellKey(first))?.id).toBe(originalShift.id);
    expect(store.draftByCell.get(cellKey(first))?.startTime).toBe('10:00');
    expect(store.chooseTemplate(dayTemplate.id)).toBe(true);
    expect(store.coverage.get(first.date)).toBe(2);
    expect(store.savedByCell.get(cellKey(first))).toEqual(originalShift);
    expect(store.chooseTemplate('missing')).toBe(false);
  });

  it('assigns a date to the current filtered employees while preserving hidden rows and other dates', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyCustomShift([nextDay], {
      startTime: '11:00',
      endTime: '13:00',
      endDayOffset: 0,
    });
    store.query = 'Волков';
    expect(store.applyDateTemplate(first.date, template.id)).toBe(true);
    expect(store.selectedCells).toEqual([second]);
    expect(store.draftByCell.get(cellKey(first))).toEqual(originalShift);
    expect(store.draftByCell.get(cellKey(nextDay))?.startTime).toBe('11:00');
    expect(store.coverage.get(first.date)).toBe(2);
    store.query = 'Никого';
    expect(store.applyDateTemplate(first.date, template.id)).toBe(false);
    expect(store.coverage.get(first.date)).toBe(2);
    expect(store.applyDateTemplate('2026-12-01', template.id)).toBe(false);
  });
  it('preserves the anchor between views and reuses fully cached periods', async () => {
    const store = useScheduleStore();
    await store.load();
    expect(store.anchorDate).toBe('2026-11-19');
    store.view = 'month';
    await store.load();
    expect(store.range).toEqual({ from: '2026-11-01', to: '2026-11-30' });
    expect(store.anchorDate).toBe('2026-11-19');
    expect(store.days).toHaveLength(30);
    store.view = 'week';
    await store.load();
    expect(scheduleApi.schedule).toHaveBeenCalledTimes(2);
    expect(store.days).toHaveLength(7);
    expect(store.anchorDate).toBe('2026-11-19');
    expect(scheduleApi.employees).toHaveBeenCalledTimes(1);
    expect(scheduleApi.templates).toHaveBeenCalledTimes(1);
  });

  it('merges overlapping reads while preserving edits, additions and local deletions', async () => {
    const store = useScheduleStore();
    await store.load();
    store.deleteShifts([first]);
    store.applyCustomShift([second], {
      startTime: '22:45',
      endTime: '06:15',
      endDayOffset: 1,
    });
    store.view = 'month';
    await store.load();
    expect(store.savedByCell.get(cellKey(first))).toEqual(originalShift);
    expect(store.draftByCell.has(cellKey(first))).toBe(false);
    expect(store.draftByCell.get(cellKey(second))?.endTime).toBe('06:15');
    expect(store.dirtyCells.size).toBe(2);
    store.applyTemplate([{ ...nextDay, date: '2026-11-02' }], template.id);
    const before = [...store.draftByCell].map(([key, shift]) => [
      key,
      { ...shift },
    ]);
    await store.navigate(1);
    expect(store.range.from).toBe('2026-12-01');
    expect(store.visibleAssignments).toEqual([]);
    await store.navigate(-1);
    expect([...store.draftByCell]).toEqual(before);
    expect(store.dirtyCells.size).toBe(3);
    expect(store.coverage.get(first.date)).toBe(1);
    expect(scheduleApi.schedule).toHaveBeenCalledTimes(3);
  });

  it('preserves changed saved content when a wider period includes the original assignment again', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyCustomShift([first], {
      startTime: '09:30',
      endTime: '17:15',
      endDayOffset: 0,
    });
    store.view = 'month';
    await store.load();
    expect(store.draftByCell.get(cellKey(first))?.startTime).toBe('09:30');
    expect(store.savedByCell.get(cellKey(first))?.startTime).toBe('07:00');
    expect(store.hasUnsavedChanges).toBe(true);
    store.applyTemplate([first], template.id);
    expect(store.hasUnsavedChanges).toBe(false);
  });

  it('ignores an out-of-order response after navigation and can return to an in-flight period', async () => {
    const store = useScheduleStore();
    await store.load();
    const late = deferred<ScheduleResponse>();
    vi.mocked(scheduleApi.schedule).mockReturnValueOnce(late.promise);
    const firstNavigation = store.navigate(1);
    await Promise.resolve();
    const following = periodRange('2026-12-03', 'week');
    expect(await store.navigate(1)).toBe(true);
    expect(store.range).toEqual(following);
    late.resolve({ ...response, ...periodRange('2026-11-26', 'week') });
    expect(await firstNavigation).toBe(false);
    expect(store.range).toEqual(following);
    expect(store.loadedRange).toEqual(following);
    expect(store.loadError).toBeNull();
    expect(store.loading).toBe(false);
  });

  it('deduplicates a pending range after leaving it and returning before its response', async () => {
    const store = useScheduleStore();
    await store.load();
    const pending = deferred<ScheduleResponse>();
    const requested = periodRange('2026-11-26', 'week');
    vi.mocked(scheduleApi.schedule).mockReturnValueOnce(pending.promise);
    const away = store.navigate(1);
    await Promise.resolve();
    expect(await store.navigate(-1)).toBe(true);
    expect(store.loading).toBe(false);
    const back = store.navigate(1);
    await Promise.resolve();
    expect(scheduleApi.schedule).toHaveBeenCalledTimes(2);
    pending.resolve({ ...response, ...requested, assignments: [] });
    expect(await away).toBe(false);
    expect(await back).toBe(true);
    expect(store.loadedRange).toEqual(requested);
    expect(store.periodReady).toBe(true);
  });

  it('keeps earlier changes and permits cached navigation after a new period fails', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyTemplate([second], template.id);
    vi.mocked(scheduleApi.schedule).mockRejectedValueOnce(new Error('offline'));
    expect(await store.navigate(1)).toBe(false);
    expect(store.periodReady).toBe(false);
    expect(store.loadError).not.toBeNull();
    expect(
      store.applyTemplate([{ ...second, date: '2026-11-26' }], template.id),
    ).toBe(false);
    expect(await store.navigate(-1)).toBe(true);
    expect(store.loadError).toBeNull();
    expect(store.coverage.get(first.date)).toBe(2);
    expect(store.hasUnsavedChanges).toBe(true);
    await store.navigate(1);
    expect(store.periodReady).toBe(true);
  });

  it('does not advance the save revision or replace a draft when the server has changed', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyTemplate([second], template.id);
    vi.mocked(scheduleApi.schedule).mockImplementationOnce(async (range) => ({
      ...response,
      ...range,
      revision: 8,
      assignments: [],
    }));
    expect(await store.navigate(1)).toBe(false);
    expect(store.loadError).toContain('на сервере изменилось');
    expect(store.revision).toBe(7);
    expect(store.draftByCell.has(cellKey(second))).toBe(true);
    expect(store.savedByCell.size).toBe(1);
    expect(await store.navigate(-1)).toBe(true);
    expect(store.hasUnsavedChanges).toBe(true);
  });

  it('invalidates a pristine older cache when a newer revision is read', async () => {
    const store = useScheduleStore();
    await store.load();
    vi.mocked(scheduleApi.schedule).mockImplementationOnce(async (range) => ({
      ...response,
      ...range,
      revision: 8,
      assignments: [],
    }));
    expect(await store.navigate(1)).toBe(true);
    expect(store.revision).toBe(8);
    expect(store.savedByCell.size).toBe(0);
    expect(store.loadedDates.has(first.date)).toBe(false);
    expect(await store.navigate(-1)).toBe(false);
    expect(store.loadError).toContain('устаревший');
    expect(store.revision).toBe(8);
    vi.mocked(scheduleApi.schedule).mockImplementationOnce(async (range) => ({
      ...response,
      ...range,
      revision: 8,
    }));
    expect(await store.load()).toBe(true);
    expect(store.loadError).toBeNull();
  });

  it('keeps a selection while its employees remain visible and clears it when hidden or navigating', async () => {
    const store = useScheduleStore();
    await store.load();
    store.toggleCell(first);
    store.query = '   КУЗНЕЦОВА    Алина  ';
    expect(store.visibleEmployees.map((employee) => employee.id)).toEqual([
      'employee-1',
    ]);
    expect(store.selected.size).toBe(1);
    store.query = 'Волков';
    expect(store.selected.size).toBe(0);
    store.toggleCell(second);
    await store.navigate(1);
    expect(store.selected.size).toBe(0);
    expect(store.query).toBe('Волков');
  });

  it('returns to the organization today and recomputes it after midnight', async () => {
    const store = useScheduleStore();
    await store.load();
    await store.navigate(1);
    expect(await store.goToday()).toBe(true);
    expect(store.anchorDate).toBe('2026-11-19');
    vi.setSystemTime(new Date('2026-11-19T22:30:00Z'));
    await store.goToday();
    expect(store.anchorDate).toBe('2026-11-20');
    expect(store.range).toEqual(initialRange);
  });

  it.each(['2026-11-19T00:30:00Z', '2026-11-15T23:30:00Z'])(
    'uses the server time zone during initialization at %s',
    async (now) => {
      vi.setSystemTime(new Date(now));
      vi.mocked(scheduleApi.schedule).mockImplementation(async (range) => ({
        ...response,
        ...range,
        timeZone: 'America/New_York',
        assignments: [],
      }));
      const store = useScheduleStore();
      expect(await store.load()).toBe(true);
      expect(store.anchorDate).toBe(
        now.startsWith('2026-11-19') ? '2026-11-18' : '2026-11-15',
      );
      expect(store.timeZone).toBe('America/New_York');
      expect(store.periodReady).toBe(true);
      expect(store.loading).toBe(false);
    },
  );
});
