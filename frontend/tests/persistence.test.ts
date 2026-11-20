import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { createPinia, setActivePinia } from 'pinia';
import type {
  Employee,
  ShiftAssignment,
  ShiftTemplate,
  SaveScheduleRequest,
  SaveScheduleResponse,
  PublishScheduleResponse,
} from '@time-card/shared';
import { scheduleApi } from '../src/api/schedule';
import { useScheduleStore } from '../src/stores/schedule';
import { buildChanges, dateRanges } from '../src/persistence';
import { cellKey } from '../src/calendar';
vi.mock('../src/api/schedule', async (original) => ({
  ...(await original<typeof import('../src/api/schedule')>()),
  scheduleApi: {
    employees: vi.fn(),
    templates: vi.fn(),
    schedule: vi.fn(),
    save: vi.fn(),
    publish: vi.fn(),
  },
}));
const people: Employee[] = ['a', 'b'].map((id, sortOrder) => ({
  id,
  fullName: id,
  sortOrder,
  avatarUrl: null,
  position: 'агент',
}));
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
const a = { employeeId: 'a', date: '2026-11-19' },
  b = { employeeId: 'b', date: '2026-11-20' };
const original: ShiftAssignment = {
  ...a,
  ...template,
  id: 'original',
  templateId: template.id,
};
const night = {
  startTime: '22:45',
  endTime: '06:15',
  endDayOffset: 1 as const,
};
let remote: Map<string, ShiftAssignment>;
let revision: number;
let publication: PublishScheduleResponse['publication'] | null;
let receipts: Map<string, SaveScheduleResponse | PublishScheduleResponse>;
function httpError(status: number, code = 'VALIDATION_ERROR') {
  return {
    isAxiosError: true,
    response: { status, data: { error: { code, message: 'private' } } },
  };
}
function commit(body: SaveScheduleRequest, publish = false) {
  if (receipts.has(body.requestId)) return receipts.get(body.requestId)!;
  if (body.baseRevision !== revision) throw httpError(409, 'REVISION_CONFLICT');
  const touched = new Map<string, { employeeId: string; date: string }>();
  for (const change of body.changes) {
    if (change.type === 'move') {
      const shift = remote.get(cellKey(change.from))!;
      remote.delete(cellKey(change.from));
      remote.set(cellKey(change.to), { ...shift, ...change.to });
      touched.set(cellKey(change.from), change.from);
      touched.set(cellKey(change.to), change.to);
    } else {
      touched.set(cellKey(change.cell), change.cell);
      if (change.type === 'delete') remote.delete(cellKey(change.cell));
      else
        remote.set(
          cellKey(change.cell),
          change.type === 'assign-template'
            ? {
                ...template,
                ...change.cell,
                id: 'server-' + cellKey(change.cell),
                templateId: template.id,
              }
            : {
                ...change.time,
                ...change.cell,
                id: 'server-' + cellKey(change.cell),
                templateId: null,
                color: '#6172F3',
              },
        );
    }
  }
  if (body.changes.length || publish) revision++;
  if (publish)
    publication = {
      id: 'pub-' + revision,
      revision,
      publishedAt: '2026-11-20T10:00:00Z',
    };
  const result = {
    requestId: body.requestId,
    revision,
    assignments: [...touched.keys()].flatMap((key) =>
      remote.has(key) ? [{ ...remote.get(key)! }] : [],
    ),
    deletedCells: [...touched]
      .filter(([key]) => !remote.has(key))
      .map(([, cell]) => ({ ...cell })),
    ...(publish ? { publication: publication! } : {}),
  };
  receipts.set(body.requestId, result);
  return result;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-19T12:00:00Z'));
  setActivePinia(createPinia());
  vi.resetAllMocks();
  remote = new Map([[cellKey(a), { ...original }]]);
  revision = 7;
  publication = null;
  receipts = new Map();
  vi.mocked(scheduleApi.employees).mockResolvedValue({
    employees: people.map((item) => ({ ...item })),
  });
  vi.mocked(scheduleApi.templates).mockResolvedValue({
    templates: [{ ...template }],
  });
  vi.mocked(scheduleApi.schedule).mockImplementation(async (range) => ({
    ...range,
    revision,
    latestPublication: publication,
    timeZone: 'Europe/Moscow',
    assignments: [...remote.values()]
      .filter((shift) => shift.date >= range.from && shift.date <= range.to)
      .map((item) => ({ ...item })),
  }));
  vi.mocked(scheduleApi.save).mockImplementation(async (body) => commit(body));
  vi.mocked(scheduleApi.publish).mockImplementation(
    async (body) => commit(body, true) as PublishScheduleResponse,
  );
});
afterEach(() => vi.useRealTimers());
describe('saving and publication', () => {
  it('saves the final diff, adopts canonical IDs and reloads persisted data', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyCustomShift([b], night);
    store.deleteShifts([a]);
    expect(await store.save()).toBe(true);
    expect(scheduleApi.save).toHaveBeenCalledOnce();
    expect(vi.mocked(scheduleApi.save).mock.calls[0]![0]).toMatchObject({
      baseRevision: 7,
      changes: [
        { type: 'delete', cell: a },
        { type: 'assign-custom', cell: b, time: night },
      ],
    });
    expect(store.revision).toBe(8);
    expect(store.hasUnsavedChanges).toBe(false);
    expect(store.draftByCell.get(cellKey(b))?.id).toBe('server-' + cellKey(b));
    expect(store.draftByCell.get(cellKey(b))).not.toBe(
      store.savedByCell.get(cellKey(b)),
    );
    const reloaded = useScheduleStore(createPinia());
    await reloaded.load();
    expect(reloaded.draftByCell.get(cellKey(b))).toMatchObject(night);
    expect(reloaded.draftByCell.has(cellKey(a))).toBe(false);
  });
  it('ignores clean saves and reverted changes, and preserves identity on an isolated move', async () => {
    const store = useScheduleStore();
    await store.load();
    expect(await store.save()).toBe(false);
    store.applyCustomShift([b], night);
    store.deleteShifts([b]);
    expect(await store.save()).toBe(false);
    store.moveShift(a, b);
    expect(await store.save()).toBe(true);
    expect(vi.mocked(scheduleApi.save).mock.calls[0]![0].changes).toEqual([
      { type: 'move', from: a, to: b, replaceExisting: false },
    ]);
    expect(store.draftByCell.get(cellKey(b))?.id).toBe('original');
  });
  it('includes edits across cached periods, not only the visible month', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyCustomShift([b], night);
    await store.navigate(1);
    const elsewhere = { ...a, date: store.days[0]!.date };
    store.applyTemplate([elsewhere], template.id);
    await store.save();
    expect(vi.mocked(scheduleApi.save).mock.calls[0]![0].changes).toHaveLength(
      2,
    );
    expect(store.hasUnsavedChanges).toBe(false);
    await store.navigate(-1);
    expect(store.draftByCell.has(cellKey(b))).toBe(true);
  });
  it('freezes edits and navigation and coalesces repeated clicks during a request', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyCustomShift([b], night);
    let finish!: (result: SaveScheduleResponse) => void;
    vi.mocked(scheduleApi.save).mockImplementationOnce(
      (body) =>
        new Promise((resolve) => {
          finish = () => resolve(commit(body));
        }),
    );
    const saving = store.save();
    expect(store.busy).toBe('save');
    expect(store.editingLocked).toBe(true);
    expect(store.deleteShifts([a])).toBe(false);
    expect(store.applyTemplate([a], template.id)).toBe(false);
    expect(store.moveShift(a, b, true)).toBe(false);
    expect(await store.navigate(1)).toBe(false);
    expect(await store.save()).toBe(false);
    expect(await store.publish()).toBe(false);
    finish({} as SaveScheduleResponse);
    expect(await saving).toBe(true);
    expect(scheduleApi.save).toHaveBeenCalledOnce();
  });
  it('retries the exact request after a lost success response without a second revision', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyCustomShift([b], night);
    vi.mocked(scheduleApi.save).mockImplementationOnce(async (body) => {
      commit(body);
      throw new Error('connection lost');
    });
    expect(await store.save()).toBe(false);
    const firstRequest = JSON.stringify(store.pendingMutation);
    expect(store.hasUnsavedChanges).toBe(true);
    expect(store.editingLocked).toBe(true);
    expect(await store.compareWithServer()).toBe(false);
    expect(await store.publish()).toBe(false);
    expect(await store.save()).toBe(true);
    expect(
      JSON.stringify({
        kind: 'save',
        body: vi.mocked(scheduleApi.save).mock.calls[1]![0],
      }),
    ).toBe(firstRequest);
    expect(revision).toBe(8);
    expect(receipts.size).toBe(1);
    expect(store.pendingMutation).toBeNull();
  });
  it('keeps draft on definitive validation errors and unknown server errors', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyCustomShift([b], night);
    vi.mocked(scheduleApi.save).mockRejectedValueOnce(httpError(400));
    await store.save();
    expect(store.editingLocked).toBe(false);
    expect(store.hasUnsavedChanges).toBe(true);
    expect(store.persistenceError).not.toContain('private');
    vi.mocked(scheduleApi.save).mockRejectedValueOnce(httpError(500));
    await store.save();
    expect(store.pendingMutation).not.toBeNull();
    expect(store.editingLocked).toBe(true);
  });
  it('rejects malformed success bodies without falsely declaring a saved draft', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyCustomShift([b], night);
    vi.mocked(scheduleApi.save).mockResolvedValueOnce({
      requestId: 'wrong',
      revision: 8,
      assignments: [],
      deletedCells: [],
    });
    expect(await store.save()).toBe(false);
    expect(store.revision).toBe(7);
    expect(store.hasUnsavedChanges).toBe(true);
    expect(store.pendingMutation).not.toBeNull();
  });
  it('publishes dirty data in one atomic operation and tracks later unpublished edits', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyCustomShift([b], night);
    expect(await store.publish()).toBe(true);
    expect(scheduleApi.save).not.toHaveBeenCalled();
    expect(store.latestPublication?.revision).toBe(8);
    expect(store.publicationState).toBe('Текущая версия опубликована');
    expect(await store.publish()).toBe(false);
    store.deleteShifts([b]);
    await store.save();
    expect(store.publicationState).toBe('Есть неопубликованные изменения');
    await store.publish();
    expect(
      vi.mocked(scheduleApi.publish).mock.calls.at(-1)![0].changes,
    ).toEqual([]);
    expect(store.latestPublication?.revision).toBe(10);
  });
  it('retries lost publication with the same request ID', async () => {
    const store = useScheduleStore();
    await store.load();
    vi.mocked(scheduleApi.publish).mockImplementationOnce(async (body) => {
      commit(body, true);
      throw new Error('lost');
    });
    await store.publish();
    expect(store.canSave).toBe(false);
    expect(store.canPublish).toBe(true);
    await store.publish();
    expect(receipts.size).toBe(1);
    expect(store.latestPublication?.revision).toBe(8);
  });
});
describe('reviewing concurrent edits', () => {
  it('merges different cells only after explicit acceptance and then saves against the new revision', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyCustomShift([b], night);
    remote.set(cellKey(a), {
      ...original,
      startTime: '08:00',
      endTime: '16:00',
      templateId: null,
      color: '#6172F3',
    });
    revision++;
    expect(await store.save()).toBe(false);
    expect(store.hasConflict).toBe(true);
    expect(await store.compareWithServer()).toBe(true);
    expect(store.comparison?.conflicts).toHaveLength(0);
    expect(store.revision).toBe(7);
    expect(store.savedByCell.get(cellKey(a))?.startTime).toBe('07:00');
    expect(store.applyComparison()).toBe(true);
    expect(store.revision).toBe(8);
    expect(store.draftByCell.get(cellKey(a))?.startTime).toBe('08:00');
    expect(store.draftByCell.get(cellKey(b))).toMatchObject(night);
    await store.save();
    expect(store.revision).toBe(9);
    expect(store.hasUnsavedChanges).toBe(false);
  });
  it('requires a choice for edit-versus-delete and allows keeping the server version', async () => {
    const store = useScheduleStore();
    await store.load();
    store.deleteShifts([a]);
    remote.set(cellKey(a), { ...original, endTime: '16:00' });
    revision++;
    await store.save();
    await store.compareWithServer();
    expect(store.comparison?.conflicts).toHaveLength(1);
    expect(store.applyComparison()).toBe(false);
    expect(store.draftByCell.has(cellKey(a))).toBe(false);
    store.resolveConflict(cellKey(a), 'remote');
    expect(store.applyComparison()).toBe(true);
    expect(store.draftByCell.get(cellKey(a))?.endTime).toBe('16:00');
    expect(store.hasUnsavedChanges).toBe(false);
  });
  it('keeps a local deletion when chosen, and cancellation never discards a draft', async () => {
    const store = useScheduleStore();
    await store.load();
    store.deleteShifts([a]);
    remote.set(cellKey(a), { ...original, endTime: '16:00' });
    revision++;
    await store.save();
    await store.compareWithServer();
    store.closeComparison();
    expect(store.draftByCell.has(cellKey(a))).toBe(false);
    expect(store.revision).toBe(7);
    await store.compareWithServer();
    store.resolveConflict(cellKey(a), 'local');
    store.applyComparison();
    await store.save();
    expect(remote.has(cellKey(a))).toBe(false);
  });
  it('recognizes the same concurrent result as already saved', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyCustomShift([b], night);
    remote.set(cellKey(b), {
      ...b,
      ...night,
      id: 'other-id',
      templateId: null,
      color: '#6172F3',
    });
    revision++;
    await store.save();
    await store.compareWithServer();
    expect(store.comparison?.conflicts).toHaveLength(0);
    store.applyComparison();
    expect(store.hasUnsavedChanges).toBe(false);
  });
  it('does not apply a mixed-revision comparison across cached periods', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyCustomShift([b], night);
    await store.goToDate('2026-12-10');
    revision++;
    let reads = 0;
    vi.mocked(scheduleApi.schedule).mockImplementation(async (range) => ({
      ...range,
      revision: revision + reads++,
      timeZone: 'Europe/Moscow',
      latestPublication: null,
      assignments: [],
    }));
    expect(await store.compareWithServer()).toBe(false);
    expect(store.revision).toBe(7);
    expect(store.draftByCell.get(cellKey(b))).toMatchObject(night);
    expect(store.comparison).toBeNull();
  });
  it('offers historical template hours as custom only after review of changed references', async () => {
    const store = useScheduleStore();
    await store.load();
    store.applyTemplate([b], template.id);
    vi.mocked(scheduleApi.templates).mockResolvedValue({
      templates: [{ ...template, endTime: '16:00' }],
    });
    await store.compareWithServer();
    expect(store.comparison?.conflicts[0]?.note).toContain('Шаблон');
    store.resolveConflict(cellKey(b), 'local');
    store.applyComparison();
    expect(store.draftByCell.get(cellKey(b))).toMatchObject({
      endTime: '15:00',
      templateId: null,
      color: '#6172F3',
    });
    expect(await store.save()).toBe(true);
  });
});
it('groups distant dates without expanding gaps and keeps chunks within 31 days', () => {
  expect(
    dateRanges(new Set(['2026-11-19', '2026-11-20', '9999-12-31'])),
  ).toEqual([
    { from: '2026-11-19', to: '2026-11-20' },
    { from: '9999-12-31', to: '9999-12-31' },
  ]);
  expect(
    buildChanges(
      new Map([[cellKey(a), original]]),
      new Map([[cellKey(a), { ...original, id: 'different' }]]),
      [template],
    ),
  ).toEqual([]);
});

it('rejects an oversized diff before HTTP and retains every local assignment', async () => {
  const store = useScheduleStore();
  await store.load();
  const more = Array.from({ length: 1001 }, (_, index) => ({
    ...people[0]!,
    id: 'bulk-' + index,
  }));
  store.employees = [...store.employees, ...more];
  store.applyCustomShift(
    more.map((employee) => ({ employeeId: employee.id, date: '2026-11-19' })),
    night,
  );
  expect(await store.save()).toBe(false);
  expect(scheduleApi.save).not.toHaveBeenCalled();
  expect(store.persistenceError).toContain('1000');
  expect(store.draftByCell.size).toBe(1002);
  expect(store.editingLocked).toBe(false);
});
it('requires a server-only choice if an employee was deleted remotely', async () => {
  const store = useScheduleStore();
  await store.load();
  store.applyCustomShift([b], night);
  vi.mocked(scheduleApi.employees).mockResolvedValue({
    employees: [people[0]!],
  });
  await store.compareWithServer();
  expect(store.comparison?.conflicts[0]?.localAllowed).toBe(false);
  store.resolveConflict(cellKey(b), 'local');
  expect(store.canApplyComparison).toBe(false);
  store.resolveConflict(cellKey(b), 'remote');
  store.applyComparison();
  expect(store.draftByCell.has(cellKey(b))).toBe(false);
});
it('keeps read-only demos editable locally without enabling writes', async () => {
  vi.mocked(scheduleApi.schedule).mockImplementation(async (range) => ({
    ...range,
    revision: 0,
    readOnly: true,
    timeZone: 'Europe/Moscow',
    latestPublication: null,
    assignments: [],
  }));
  const store = useScheduleStore();
  await store.load();
  store.applyCustomShift([b], night);
  expect(store.hasUnsavedChanges).toBe(true);
  expect(store.canSave).toBe(false);
  expect(store.canPublish).toBe(false);
  expect(await store.save()).toBe(false);
  expect(await store.publish()).toBe(false);
  expect(scheduleApi.save).not.toHaveBeenCalled();
});
it('does not trust a publication without a valid snapshot revision', async () => {
  const store = useScheduleStore();
  await store.load();
  vi.mocked(scheduleApi.publish).mockImplementationOnce(async (body) => ({
    requestId: body.requestId,
    revision: 8,
    assignments: [],
    deletedCells: [],
    publication: {
      id: 'bad',
      revision: 7,
      publishedAt: '2026-11-20T10:00:00Z',
    },
  }));
  expect(await store.publish()).toBe(false);
  expect(store.latestPublication).toBeNull();
  expect(store.pendingMutation?.kind).toBe('publish');
});
