// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, nextTick, type App as VueApp } from 'vue';
import { createPinia } from 'pinia';
import type {
  Employee,
  ScheduleResponse,
  ShiftTemplate,
} from '@time-card/shared';
import App from '../src/App.vue';
import { scheduleApi } from '../src/api/schedule';
import { useScheduleStore } from '../src/stores/schedule';
import { cellKey } from '../src/calendar';

vi.mock('../src/api/schedule', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../src/api/schedule')>();
  return {
    ...actual,
    scheduleApi: {
      employees: vi.fn(),
      templates: vi.fn(),
      schedule: vi.fn(),
      save: vi.fn(),
      publish: vi.fn(),
    },
  };
});
const employees: Employee[] = [
  {
    id: 'p1',
    fullName: 'Кузнецова Алина',
    position: 'агент',
    avatarUrl: null,
    sortOrder: 0,
  },
  {
    id: 'p2',
    fullName: 'Волков Тимур',
    position: 'агент',
    avatarUrl: null,
    sortOrder: 1,
  },
  {
    id: 'p3',
    fullName: 'Кузнецова Ирина',
    position: 'агент',
    avatarUrl: null,
    sortOrder: 2,
  },
];
const templates: ShiftTemplate[] = [
  {
    id: 'morning',
    code: 'morning',
    name: 'Утро',
    startTime: '07:00',
    endTime: '15:00',
    endDayOffset: 0,
    color: '#E8ECFF',
    sortOrder: 0,
  },
  {
    id: 'day',
    code: 'day',
    name: 'День',
    startTime: '10:00',
    endTime: '18:00',
    endDayOffset: 0,
    color: '#E9DFFF',
    sortOrder: 1,
  },
];
let app: VueApp;
let host: HTMLDivElement;
let store: ReturnType<typeof useScheduleStore>;
let pointTarget: Element | null;

function cell(employeeId: string, date: string): HTMLButtonElement {
  const button = host.querySelector<HTMLButtonElement>(
    `button.shift-cell[data-employee-id="${employeeId}"][data-date="${date}"]`,
  );
  if (!button) throw new Error(`Missing cell ${employeeId}/${date}`);
  return button;
}
function dateButton(date: string): HTMLButtonElement {
  const index = store.days.findIndex((day) => day.date === date);
  return host.querySelectorAll<HTMLButtonElement>('.day-button')[index]!;
}
function timeInput(label: string): HTMLInputElement {
  return [...host.querySelectorAll<HTMLLabelElement>('.time-fields label')]
    .find((item) => item.textContent?.trim() === label)!
    .querySelector('input')!;
}
async function fillTime(label: string, value: string) {
  const input = timeInput(label);
  input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await nextTick();
}
async function click(target: HTMLElement, options: MouseEventInit = {}) {
  vi.setSystemTime(new Date(Date.now() + 10));
  target.dispatchEvent(
    new MouseEvent('click', { bubbles: true, detail: 1, ...options }),
  );
  await nextTick();
  await nextTick();
}
function pointer(
  type: string,
  target: EventTarget,
  x = 10,
  y = 10,
  extra: PointerEventInit = {},
) {
  target.dispatchEvent(
    new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 1,
      pointerType: 'mouse',
      isPrimary: true,
      button: 0,
      buttons: 1,
      clientX: x,
      clientY: y,
      ...extra,
    }),
  );
}
async function startRectangle(
  from: HTMLButtonElement,
  to: HTMLButtonElement,
  extra: PointerEventInit = {},
) {
  pointer('pointerdown', from, 10, 10, extra);
  pointTarget = to;
  pointer('pointermove', window, 100, 100, extra);
  await nextTick();
}

beforeEach(async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-20T12:00:00Z'));
  vi.resetAllMocks();
  const capture = new WeakMap<HTMLElement, Set<number>>();
  vi.stubGlobal(
    'requestAnimationFrame',
    vi.fn(() => 1),
  );
  vi.stubGlobal('cancelAnimationFrame', vi.fn());
  Object.defineProperties(HTMLElement.prototype, {
    clientHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('calendar-scroll') ? 330 : 0;
      },
    },
    clientWidth: {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('calendar-scroll') ? 1000 : 0;
      },
    },
    offsetHeight: {
      configurable: true,
      get(this: HTMLElement) {
        return this.classList.contains('employee-row')
          ? 64
          : this.classList.contains('calendar-header')
            ? 42
            : 0;
      },
    },
    scrollTo: {
      configurable: true,
      value(this: HTMLElement, options: ScrollToOptions) {
        if (options.top !== undefined) this.scrollTop = options.top;
        if (options.left !== undefined) this.scrollLeft = options.left;
        this.dispatchEvent(new Event('scroll'));
      },
    },
    scrollIntoView: { configurable: true, value: vi.fn() },
    setPointerCapture: {
      configurable: true,
      value(this: HTMLElement, id: number) {
        capture.set(this, new Set([id]));
      },
    },
    hasPointerCapture: {
      configurable: true,
      value(this: HTMLElement, id: number) {
        return capture.get(this)?.has(id) ?? false;
      },
    },
    releasePointerCapture: {
      configurable: true,
      value(this: HTMLElement, id: number) {
        capture.get(this)?.delete(id);
      },
    },
  });
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.setAttribute('open', '');
      },
    },
    close: {
      configurable: true,
      value(this: HTMLDialogElement) {
        this.removeAttribute('open');
      },
    },
  });
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: () => pointTarget,
  });
  vi.mocked(scheduleApi.employees).mockResolvedValue({
    employees: structuredClone(employees),
  });
  vi.mocked(scheduleApi.templates).mockResolvedValue({
    templates: structuredClone(templates),
  });
  vi.mocked(scheduleApi.schedule).mockImplementation(
    async (range) =>
      ({
        ...range,
        revision: 7,
        timeZone: 'Europe/Moscow',
        latestPublication: null,
        assignments: [
          {
            id: 'original',
            employeeId: 'p1',
            date: '2026-11-19',
            templateId: 'morning',
            startTime: '07:00',
            endTime: '15:00',
            endDayOffset: 0,
            color: '#E8ECFF',
          },
        ],
      }) satisfies ScheduleResponse,
  );
  host = document.createElement('div');
  document.body.append(host);
  const pinia = createPinia();
  app = createApp(App).use(pinia);
  app.mount(host);
  store = useScheduleStore(pinia);
  await store.load();
  await nextTick();
  // Let native event timestamps occur after Vue attached its capture/bubble handlers.
  vi.setSystemTime(new Date(Date.now() + 1000));
});
afterEach(() => {
  app?.unmount();
  document.body.innerHTML = '';
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('selection and assignment through the rendered editor', () => {
  it('applies custom overnight hours to all selected cells and previews the exact duration', async () => {
    await click(cell('p2', '2026-11-16'));
    await click(cell('p3', '2026-11-16'), { ctrlKey: true });
    await fillTime('Начало', '22:45');
    await fillTime('Конец', '06:15');
    expect(host.querySelector('.time-summary')?.textContent).toContain(
      '7 ч 30 мин',
    );
    expect(host.querySelector('.overnight-note')?.textContent).toContain(
      'следующий день',
    );
    await click(host.querySelector<HTMLButtonElement>('.apply-custom')!);
    expect(store.coverage.get('2026-11-16')).toBe(2);
    expect(store.draftByCell.get('p2/2026-11-16')).toMatchObject({
      startTime: '22:45',
      endTime: '06:15',
      endDayOffset: 1,
      templateId: null,
    });
    expect(
      cell('p3', '2026-11-16').querySelector('.overnight')?.textContent,
    ).toBe('+1');
    expect(
      store.visibleEmployees
        .filter((employee) => ['p2', 'p3'].includes(employee.id))
        .map((employee) => employee.hours),
    ).toEqual(['7,5', '7,5']);
  });

  it('loads a selected shift into the form, focuses its start and applies edits without changing coverage', async () => {
    await fillTime('Начало', '09:15');
    await fillTime('Конец', '17:45');
    await click(cell('p1', '2026-11-19'));
    await click(
      host.querySelector<HTMLButtonElement>(
        '[aria-label="Изменить время смены"]',
      )!,
    );
    expect(document.activeElement).toBe(timeInput('Начало'));
    expect(timeInput('Начало').value).toBe('07:00');
    expect(timeInput('Конец').value).toBe('15:00');
    expect(host.querySelector('.editing-context')?.textContent).toContain(
      'Кузнецова Алина',
    );
    expect(host.querySelector('.editing-context')?.textContent).toContain(
      '19 ноября 2026',
    );
    await fillTime('Начало', '09:30');
    await fillTime('Конец', '17:15');
    expect(host.querySelector('.time-summary')?.textContent).toContain(
      '7 ч 45 мин',
    );
    await click(host.querySelector<HTMLButtonElement>('.apply-custom')!);
    expect(store.draftByCell.get('p1/2026-11-19')).toMatchObject({
      id: 'original',
      startTime: '09:30',
      endTime: '17:15',
      templateId: null,
    });
    expect(store.savedByCell.get('p1/2026-11-19')?.startTime).toBe('07:00');
    expect(store.coverage.get('2026-11-19')).toBe(1);
    expect(store.visibleEmployees[0]?.hours).toBe('7,75');
    expect(store.selected.size).toBe(0);
    expect(document.activeElement).toBe(cell('p1', '2026-11-19'));
    expect(
      host.querySelector<HTMLButtonElement>('.apply-custom')?.disabled,
    ).toBe(true);
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(store.draftByCell.get('p1/2026-11-19')?.startTime).toBe('09:30');
    expect(store.editingCell).toBeNull();
    expect(timeInput('Начало').value).toBe('09:15');
    expect(timeInput('Конец').value).toBe('17:45');
  });

  it('supports double-click and F2 editing and preserves a template when untouched hours are applied', async () => {
    vi.setSystemTime(new Date(Date.now() + 10));
    cell('p1', '2026-11-19').dispatchEvent(
      new MouseEvent('dblclick', { bubbles: true }),
    );
    await nextTick();
    await nextTick();
    expect(store.editingCell).toEqual({ employeeId: 'p1', date: '2026-11-19' });
    await click(host.querySelector<HTMLButtonElement>('.apply-custom')!);
    expect(store.draftByCell.get('p1/2026-11-19')?.templateId).toBe('morning');
    expect(store.hasUnsavedChanges).toBe(false);
    cell('p1', '2026-11-19').dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'F2',
        bubbles: true,
        cancelable: true,
      }),
    );
    await nextTick();
    await nextTick();
    expect(document.activeElement).toBe(timeInput('Начало'));
    await click(host.querySelector<HTMLButtonElement>('.cancel-edit')!);
    expect(store.editingCell).toBeNull();
    expect(store.hasUnsavedChanges).toBe(false);
  });

  it('blocks missing or equal hours, including a direct form submission, and cancels without writing', async () => {
    await click(cell('p1', '2026-11-19'));
    await click(
      host.querySelector<HTMLButtonElement>(
        '[aria-label="Изменить время смены"]',
      )!,
    );
    await fillTime('Начало', '12:00');
    await fillTime('Конец', '12:00');
    expect(host.querySelector('.time-error')?.textContent).toContain(
      'должны различаться',
    );
    expect(
      host.querySelector<HTMLButtonElement>('.apply-custom')?.disabled,
    ).toBe(true);
    host
      .querySelector('form')!
      .dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    expect(store.hasUnsavedChanges).toBe(false);
    expect(store.draftByCell.get('p1/2026-11-19')?.templateId).toBe('morning');
    await click(host.querySelector<HTMLButtonElement>('.cancel-edit')!);
    expect(timeInput('Начало').value).toBe('09:00');
    expect(timeInput('Конец').value).toBe('17:00');
    await fillTime('Начало', '');
    expect(host.querySelector('.time-error')?.textContent).toContain(
      'Укажите начало и конец',
    );
    expect(host.querySelector('.time-summary')).toBeNull();
    expect(
      host.querySelector<HTMLButtonElement>('.apply-custom')?.disabled,
    ).toBe(true);
    expect(store.hasUnsavedChanges).toBe(false);
  });

  it('exits editing when selection changes or a template is applied', async () => {
    await click(cell('p1', '2026-11-19'));
    await click(
      host.querySelector<HTMLButtonElement>(
        '[aria-label="Изменить время смены"]',
      )!,
    );
    await fillTime('Начало', '22:00');
    await fillTime('Конец', '06:00');
    await click(cell('p2', '2026-11-16'), { ctrlKey: true });
    expect(store.editingCell).toBeNull();
    expect(timeInput('Начало').value).toBe('09:00');
    expect(store.hasUnsavedChanges).toBe(false);
    await click(cell('p1', '2026-11-19'));
    await click(
      host.querySelector<HTMLButtonElement>(
        '[aria-label="Изменить время смены"]',
      )!,
    );
    const day = [
      ...host.querySelectorAll<HTMLButtonElement>('.template-card'),
    ].find((button) => button.textContent?.includes('День'))!;
    await click(day);
    expect(store.editingCell).toBeNull();
    expect(store.draftByCell.get('p1/2026-11-19')?.templateId).toBe('day');
    expect(store.coverage.get('2026-11-19')).toBe(1);
  });

  it('clears assignments separately from selection and disables clearing an empty selection', async () => {
    await click(cell('p2', '2026-11-19'));
    await fillTime('Начало', '10:00');
    await fillTime('Конец', '12:00');
    await click(host.querySelector<HTMLButtonElement>('.apply-custom')!);
    await click(cell('p1', '2026-11-19'), { ctrlKey: true });
    await click(cell('p3', '2026-11-19'), { ctrlKey: true });
    expect(store.coverage.get('2026-11-19')).toBe(2);
    await click(
      host.querySelector<HTMLButtonElement>('[aria-label="Очистить"]')!,
    );
    expect(store.coverage.get('2026-11-19') ?? 0).toBe(0);
    expect(store.selected.size).toBe(3);
    expect(store.canDeleteShifts).toBe(false);
    expect(
      host.querySelector<HTMLButtonElement>('[aria-label="Очистить"]')
        ?.disabled,
    ).toBe(true);
    expect(
      store.visibleEmployees.every((employee) => employee.hours === '0'),
    ).toBe(true);
    await click(
      host.querySelector<HTMLButtonElement>('[aria-label="Снять выделение"]')!,
    );
    expect(store.selected.size).toBe(0);
    expect(store.draftByCell.size).toBe(0);
    expect(store.savedByCell.size).toBe(1);
  });
  it('keeps the picker inside the available width when a page scrollbar is present', async () => {
    vi.spyOn(document.documentElement, 'clientWidth', 'get').mockReturnValue(
      305,
    );
    vi.spyOn(
      HTMLDialogElement.prototype,
      'getBoundingClientRect',
    ).mockReturnValue(new DOMRect(0, 0, 267, 200));
    const trigger = dateButton('2026-11-19');
    vi.spyOn(trigger, 'getBoundingClientRect').mockReturnValue(
      new DOMRect(230, 100, 52, 34),
    );
    await click(trigger);
    const dialog = document.querySelector('dialog')!;
    expect(Number.parseFloat(dialog.style.left)).toBeGreaterThanOrEqual(12);
    expect(Number.parseFloat(dialog.style.left) + 267).toBeLessThanOrEqual(293);
  });
  it('keeps Tab and Shift+Tab within the date picker', async () => {
    await click(dateButton('2026-11-19'));
    const controls = [
      ...document.querySelectorAll<HTMLButtonElement>('dialog button'),
    ];
    const first = controls[0]!;
    const last = controls.at(-1)!;
    first.focus();
    const backwards = new KeyboardEvent('keydown', {
      key: 'Tab',
      shiftKey: true,
      bubbles: true,
      cancelable: true,
    });
    first.dispatchEvent(backwards);
    expect(backwards.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(last);
    const forwards = new KeyboardEvent('keydown', {
      key: 'Tab',
      bubbles: true,
      cancelable: true,
    });
    last.dispatchEvent(forwards);
    expect(forwards.defaultPrevented).toBe(true);
    expect(document.activeElement).toBe(first);
  });
  it('replaces a plain selection and toggles separate cells with Ctrl or Cmd', async () => {
    await click(cell('p1', '2026-11-16'));
    await click(cell('p2', '2026-11-17'), { ctrlKey: true });
    expect(store.selected.size).toBe(2);
    await click(cell('p1', '2026-11-16'), { metaKey: true });
    expect(store.selected.size).toBe(1);
    expect(store.selected.has('p2/2026-11-17')).toBe(true);
    await click(cell('p3', '2026-11-20'));
    expect([...store.selected]).toEqual(['p3/2026-11-20']);
  });

  it('keeps the rectangle after mouse release and suppresses the trailing click', async () => {
    const start = cell('p1', '2026-11-16');
    const end = cell('p2', '2026-11-18');
    await startRectangle(start, end);
    expect(store.selected.size).toBe(6);
    pointer('pointerup', window, 100, 100, { buttons: 0 });
    await click(end);
    expect(store.selected.size).toBe(6);
    expect(host.querySelector('.selection-summary')?.textContent).toContain(
      '6 ячеек',
    );
    const dayTemplate = [
      ...host.querySelectorAll<HTMLButtonElement>('.template-card'),
    ].find((button) => button.textContent?.includes('День'))!;
    await click(dayTemplate);
    expect(store.coverage.get('2026-11-16')).toBe(2);
    expect(store.coverage.get('2026-11-17')).toBe(2);
    expect(store.coverage.get('2026-11-18')).toBe(2);
    expect(store.draftByCell.get('p2/2026-11-18')?.startTime).toBe('10:00');
    expect(store.savedByCell.size).toBe(1);
  });

  it('restores the prior selection on Escape and prevents a release from selecting again', async () => {
    await click(cell('p3', '2026-11-22'));
    const start = cell('p1', '2026-11-16');
    await startRectangle(start, cell('p2', '2026-11-18'));
    start.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );
    pointer('pointerup', window, 100, 100, { buttons: 0 });
    await click(start);
    expect([...store.selected]).toEqual(['p3/2026-11-22']);
    expect(store.hasUnsavedChanges).toBe(false);
  });

  it('cancels on pointer cancellation and drops the gesture safely when filtering hides its rows', async () => {
    await click(cell('p3', '2026-11-22'));
    await startRectangle(cell('p1', '2026-11-16'), cell('p2', '2026-11-18'));
    pointer('pointercancel', window);
    expect([...store.selected]).toEqual(['p3/2026-11-22']);
    await startRectangle(cell('p1', '2026-11-16'), cell('p2', '2026-11-18'));
    store.query = 'Ирина';
    await nextTick();
    pointer('pointerup', window, 100, 100, { buttons: 0 });
    expect(store.selected.size).toBe(0);
    expect(store.visibleEmployees.map((employee) => employee.id)).toEqual([
      'p3',
    ]);
  });

  it('extends a rectangular range with Shift+arrows and restarts it after clearing', async () => {
    const start = cell('p1', '2026-11-16');
    start.focus();
    start.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
      }),
    );
    await nextTick();
    expect(document.activeElement).toBe(cell('p1', '2026-11-17'));
    cell('p1', '2026-11-17').dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowDown',
        shiftKey: true,
        bubbles: true,
      }),
    );
    await nextTick();
    expect(store.selected.size).toBe(4);
    expect(document.activeElement).toBe(cell('p2', '2026-11-17'));
    expect(host.querySelectorAll('.shift-cell[tabindex="0"]')).toHaveLength(1);
    store.clearSelection();
    await nextTick();
    cell('p2', '2026-11-17').dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'ArrowRight',
        shiftKey: true,
        bubbles: true,
      }),
    );
    await nextTick();
    expect([...store.selected]).toEqual(['p2/2026-11-17', 'p2/2026-11-18']);
  });

  it('allows additive touch taps without intercepting a touch scroll gesture', async () => {
    const start = cell('p1', '2026-11-16');
    const down = new PointerEvent('pointerdown', {
      bubbles: true,
      cancelable: true,
      pointerId: 2,
      pointerType: 'touch',
      isPrimary: true,
      buttons: 1,
    });
    start.dispatchEvent(down);
    expect(down.defaultPrevented).toBe(false);
    expect(store.selected.size).toBe(0);
    start.dispatchEvent(
      new PointerEvent('click', {
        bubbles: true,
        detail: 1,
        pointerType: 'touch',
      }),
    );
    cell('p2', '2026-11-17').dispatchEvent(
      new PointerEvent('click', {
        bubbles: true,
        detail: 1,
        pointerType: 'touch',
      }),
    );
    await nextTick();
    expect(store.selected.size).toBe(2);
  });

  it('assigns a date only to filtered employees and returns focus to its header', async () => {
    store.query = 'Волков';
    await nextTick();
    const trigger = dateButton('2026-11-19');
    await click(trigger);
    const dialog = document.querySelector('dialog')!;
    expect(dialog.textContent).toContain('Видимые сотрудники: 1');
    expect(document.activeElement?.textContent).toContain('Утро');
    dialog.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }),
    );
    expect(document.activeElement?.textContent).toContain('День');
    await click(document.activeElement as HTMLElement);
    expect(document.querySelector('dialog')).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(
      store.draftByCell.get(cellKey({ employeeId: 'p2', date: '2026-11-19' }))
        ?.templateId,
    ).toBe('day');
    expect(store.draftByCell.get('p1/2026-11-19')?.templateId).toBe('morning');
    expect(store.coverage.get('2026-11-19')).toBe(2);
    expect(store.selected.size).toBe(1);
  });

  it('closes the date picker with Escape or an outside click without altering shifts or selection', async () => {
    await click(cell('p3', '2026-11-22'));
    const trigger = dateButton('2026-11-19');
    await click(trigger);
    expect(document.querySelector('dialog')?.textContent).toContain(
      'Существующие смены будут заменены: 1',
    );
    document.querySelector('dialog')!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Escape',
        bubbles: true,
        cancelable: true,
      }),
    );
    await nextTick();
    expect(document.querySelector('dialog')).toBeNull();
    expect([...store.selected]).toEqual(['p3/2026-11-22']);
    expect(document.activeElement).toBe(trigger);
    await click(trigger);
    await click(document.querySelector('dialog')!, {
      clientX: -10,
      clientY: -10,
    });
    expect(document.querySelector('dialog')).toBeNull();
    expect(store.hasUnsavedChanges).toBe(false);
  });
});

describe('moving shifts through pointer and keyboard input', () => {
  it('cancels a replacement on the backdrop and keeps overnight custom metadata intact when moving', async () => {
    store.applyCustomShift([{ employeeId: 'p1', date: '2026-11-19' }], {
      startTime: '22:45',
      endTime: '06:15',
      endDayOffset: 1,
    });
    store.applyTemplate([{ employeeId: 'p2', date: '2026-11-20' }], 'day');
    const original = { ...store.draftByCell.get('p1/2026-11-19')! };
    await nextTick();
    await drag(cell('p2', '2026-11-20'));
    await release();
    await click(document.querySelector<HTMLDialogElement>('.move-dialog')!, {
      clientX: -5,
      clientY: -5,
    });
    expect(store.draftByCell.get('p1/2026-11-19')).toEqual(original);
    expect(store.draftByCell.get('p2/2026-11-20')?.templateId).toBe('day');
    await drag(cell('p3', '2026-11-20'));
    await release();
    expect(store.draftByCell.get('p3/2026-11-20')).toMatchObject({
      ...original,
      employeeId: 'p3',
      date: '2026-11-20',
    });
    expect(
      cell('p3', '2026-11-20').querySelector('.overnight')?.textContent,
    ).toBe('+1');
    expect(store.visibleEmployees[2]?.hours).toBe('7,5');
  });
  async function drag(to: HTMLButtonElement) {
    pointer('pointerdown', cell('p1', '2026-11-19'));
    pointTarget = to;
    pointer('pointermove', window, 100, 100);
    await nextTick();
  }
  async function release() {
    pointer('pointerup', window, 100, 100, { buttons: 0 });
    await nextTick();
    await nextTick();
  }
  async function startKeyboard() {
    await click(cell('p1', '2026-11-19'));
    await click(
      host.querySelector<HTMLButtonElement>('[aria-label="Перенести смену"]')!,
    );
  }
  async function key(key: string, extra: KeyboardEventInit = {}) {
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key,
        bubbles: true,
        cancelable: true,
        ...extra,
      }),
    );
    await nextTick();
    await nextTick();
  }
  it('keeps a short filled-card gesture as an ordinary click and preserves double-click editing', async () => {
    const source = cell('p1', '2026-11-19');
    pointer('pointerdown', source);
    pointTarget = cell('p2', '2026-11-20');
    pointer('pointermove', window, 13, 13);
    pointer('pointerup', window, 13, 13, { buttons: 0 });
    await click(source);
    expect([...store.selected]).toEqual(['p1/2026-11-19']);
    expect(store.hasUnsavedChanges).toBe(false);
    expect(document.querySelector('.shift-ghost')).toBeNull();
    source.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    await nextTick();
    expect(store.editingCell).toEqual({ employeeId: 'p1', date: '2026-11-19' });
  });
  it('moves to an empty cell atomically, retains identity and color and suppresses its trailing click', async () => {
    await click(cell('p3', '2026-11-22'));
    const destination = cell('p2', '2026-11-20');
    await drag(destination);
    expect(store.hasUnsavedChanges).toBe(false);
    expect(document.querySelector('.shift-ghost')?.textContent).toContain(
      '07:00–15:00',
    );
    expect(destination.classList.contains('is-drop-target')).toBe(true);
    expect(cell('p1', '2026-11-19').classList.contains('is-move-source')).toBe(
      true,
    );
    expect([...store.selected]).toEqual(['p3/2026-11-22']);
    await release();
    await click(destination, { ctrlKey: true });
    expect([...store.selected]).toEqual(['p2/2026-11-20']);
    expect(store.draftByCell.has('p1/2026-11-19')).toBe(false);
    expect(store.draftByCell.get('p2/2026-11-20')).toMatchObject({
      id: 'original',
      templateId: 'morning',
      color: '#E8ECFF',
      startTime: '07:00',
      endTime: '15:00',
    });
    expect(store.coverage.get('2026-11-19') ?? 0).toBe(0);
    expect(store.coverage.get('2026-11-20')).toBe(1);
    expect(store.visibleEmployees.map((employee) => employee.hours)).toEqual([
      '0',
      '8',
      '0',
    ]);
    expect(store.savedByCell.has('p1/2026-11-19')).toBe(true);
    expect(store.dirtyCells.size).toBe(2);
    expect(document.activeElement).toBe(destination);
  });
  it('asks before replacing, focuses Cancel, traps Tab and leaves both assignments unchanged on cancellation', async () => {
    store.applyCustomShift([{ employeeId: 'p2', date: '2026-11-20' }], {
      startTime: '22:45',
      endTime: '06:15',
      endDayOffset: 1,
    });
    const before = [...store.draftByCell.values()].map((item) => ({ ...item }));
    await drag(cell('p2', '2026-11-20'));
    expect(cell('p2', '2026-11-20').classList.contains('will-replace')).toBe(
      true,
    );
    await release();
    const dialog = document.querySelector<HTMLDialogElement>('.move-dialog')!;
    expect(dialog.textContent).toContain('Волков Тимур');
    expect(dialog.textContent).toContain('22:45–06:15 (+1 день)');
    expect(dialog.textContent).toContain('Кузнецова Алина');
    expect(document.activeElement?.textContent?.trim()).toBe('Отмена');
    await key('Tab', { shiftKey: true });
    expect(document.activeElement?.textContent?.trim()).toBe(
      'Заменить и перенести',
    );
    await key('Tab');
    expect(document.activeElement?.textContent?.trim()).toBe('Отмена');
    await click(document.activeElement as HTMLElement);
    expect([...store.draftByCell.values()]).toEqual(before);
    expect(document.querySelector('.move-dialog')).toBeNull();
    expect(document.activeElement).toBe(cell('p1', '2026-11-19'));
  });
  it('confirms replacement exactly once, removing only the source and old target', async () => {
    store.applyCustomShift([{ employeeId: 'p2', date: '2026-11-20' }], {
      startTime: '22:45',
      endTime: '06:15',
      endDayOffset: 1,
    });
    store.applyTemplate([{ employeeId: 'p3', date: '2026-11-20' }], 'morning');
    await drag(cell('p2', '2026-11-20'));
    await release();
    await click(
      document.querySelector<HTMLButtonElement>(
        '.move-dialog .button--primary',
      )!,
    );
    expect(store.draftByCell.size).toBe(2);
    expect(store.draftByCell.get('p2/2026-11-20')?.id).toBe('original');
    expect(store.draftByCell.has('p1/2026-11-19')).toBe(false);
    expect(store.coverage.get('2026-11-19') ?? 0).toBe(0);
    expect(store.coverage.get('2026-11-20')).toBe(2);
    expect(document.activeElement).toBe(cell('p2', '2026-11-20'));
    await key('Enter');
    expect(store.draftByCell.size).toBe(2);
  });
  it.each([
    'Escape',
    'pointercancel',
    'lostpointercapture',
    'outside',
    'same',
    'blur',
  ])(
    'cancels %s without changing assignments or the previous selection',
    async (reason) => {
      await click(cell('p3', '2026-11-22'));
      await drag(cell('p2', '2026-11-20'));
      if (reason === 'Escape') {
        await key('Escape');
        pointer('pointermove', window, 150, 100);
      } else if (reason === 'pointercancel') pointer('pointercancel', window);
      else if (reason === 'lostpointercapture')
        pointer('lostpointercapture', host.querySelector('.calendar-scroll')!);
      else if (reason === 'outside') pointTarget = null;
      else if (reason === 'same') pointTarget = cell('p1', '2026-11-19');
      else window.dispatchEvent(new Event('blur'));
      await release();
      expect(store.draftByCell.size).toBe(1);
      expect(store.hasUnsavedChanges).toBe(false);
      expect([...store.selected]).toEqual(['p3/2026-11-22']);
      expect(document.querySelector('.shift-ghost')).toBeNull();
      expect(document.querySelector('.move-dialog')).toBeNull();
      expect(host.querySelector('.is-drop-target')).toBeNull();
    },
  );
  it('ignores another pointer and cancels when filtering or navigation changes the grid', async () => {
    await drag(cell('p2', '2026-11-20'));
    pointer('pointerup', window, 100, 100, { pointerId: 2, buttons: 0 });
    expect(document.querySelector('.shift-ghost')).not.toBeNull();
    store.query = 'Тимур';
    await nextTick();
    await release();
    expect(store.hasUnsavedChanges).toBe(false);
    expect(document.querySelector('.shift-ghost')).toBeNull();
    store.query = '';
    await nextTick();
    await drag(cell('p2', '2026-11-20'));
    await store.navigate(1);
    await release();
    expect(store.hasUnsavedChanges).toBe(false);
    expect(document.querySelector('.shift-ghost')).toBeNull();
  });
  it('cancels a stale replacement if its source or target changes before confirmation', async () => {
    store.applyTemplate([{ employeeId: 'p2', date: '2026-11-20' }], 'day');
    await drag(cell('p2', '2026-11-20'));
    await release();
    const confirm = document.querySelector<HTMLButtonElement>(
      '.move-dialog .button--primary',
    )!;
    store.applyTemplate([{ employeeId: 'p2', date: '2026-11-20' }], 'morning');
    await nextTick();
    expect(document.querySelector('.move-dialog')).toBeNull();
    await click(confirm);
    expect(store.draftByCell.has('p1/2026-11-19')).toBe(true);
    expect(store.draftByCell.get('p2/2026-11-20')?.id).not.toBe('original');
  });
  it('moves via the toolbar, arrows and Enter without changing selection while choosing', async () => {
    await startKeyboard();
    expect(document.activeElement).toBe(cell('p1', '2026-11-19'));
    await key('Enter');
    expect(store.hasUnsavedChanges).toBe(false);
    await key('ArrowRight', { shiftKey: true });
    await key('ArrowDown');
    expect([...store.selected]).toEqual(['p1/2026-11-19']);
    expect(document.activeElement).toBe(cell('p2', '2026-11-20'));
    await key('Enter');
    expect(store.draftByCell.has('p1/2026-11-19')).toBe(false);
    expect(store.draftByCell.get('p2/2026-11-20')?.id).toBe('original');
    expect(host.querySelector('.move-instructions')).toBeNull();
  });
  it('supports touch destination selection, keyboard cancellation and Escape in the replacement dialog', async () => {
    await startKeyboard();
    await key('ArrowDown');
    await key('Escape');
    expect(store.hasUnsavedChanges).toBe(false);
    expect([...store.selected]).toEqual(['p1/2026-11-19']);
    await startKeyboard();
    pointer('pointerdown', cell('p2', '2026-11-20'), 10, 10, {
      pointerType: 'touch',
    });
    await click(cell('p2', '2026-11-20'));
    expect(store.draftByCell.get('p2/2026-11-20')?.id).toBe('original');
    // A second move to an occupied cell follows the same confirmation flow.
    store.moveShift(
      { employeeId: 'p2', date: '2026-11-20' },
      { employeeId: 'p1', date: '2026-11-19' },
    );
    store.applyTemplate([{ employeeId: 'p2', date: '2026-11-20' }], 'day');
    await startKeyboard();
    await key('ArrowRight');
    await key('ArrowDown');
    await key('Enter');
    expect(document.querySelector('.move-dialog')).not.toBeNull();
    await key('Escape');
    expect(store.draftByCell.get('p1/2026-11-19')?.id).toBe('original');
    expect(store.draftByCell.get('p2/2026-11-20')?.templateId).toBe('day');
    expect(document.activeElement).toBe(cell('p1', '2026-11-19'));
    expect([...store.selected]).toEqual(['p1/2026-11-19']);
  });
  it('scrolls at both grid edges while held and stops animation after release or unmount', async () => {
    const viewport = host.querySelector<HTMLElement>('.calendar-scroll')!;
    vi.spyOn(viewport, 'getBoundingClientRect').mockReturnValue({
      left: 0,
      top: 0,
      right: 400,
      bottom: 300,
    } as DOMRect);
    vi.spyOn(
      host.querySelector('.employee-info')!,
      'getBoundingClientRect',
    ).mockReturnValue({ right: 100 } as DOMRect);
    vi.spyOn(
      host.querySelector('.calendar-header')!,
      'getBoundingClientRect',
    ).mockReturnValue({ bottom: 40 } as DOMRect);
    vi.spyOn(
      host.querySelector('.coverage-row')!,
      'getBoundingClientRect',
    ).mockReturnValue({ top: 260 } as DOMRect);
    const frame = () => vi.mocked(requestAnimationFrame).mock.calls.at(-1)![0];
    await drag(cell('p2', '2026-11-20'));
    pointer('pointermove', window, 395, 255);
    frame()(16);
    expect(viewport.scrollLeft).toBeGreaterThan(0);
    expect(viewport.scrollTop).toBeGreaterThan(0);
    const firstScroll = viewport.scrollLeft;
    pointer('pointermove', window, 105, 45);
    frame()(32);
    expect(viewport.scrollLeft).toBeLessThan(firstScroll);
    await release();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    // Start another gesture and unmount with the pointer still held.
    store.moveShift(
      { employeeId: 'p2', date: '2026-11-20' },
      { employeeId: 'p1', date: '2026-11-19' },
    );
    await nextTick();
    await drag(cell('p2', '2026-11-20'));
    app.unmount();
    pointer('pointerup', window, 100, 100, { buttons: 0 });
    expect(store.draftByCell.has('p1/2026-11-19')).toBe(true);
    expect(document.querySelector('.shift-ghost')).toBeNull();
  });
});

describe('virtual employee rows with a large schedule', () => {
  async function largeRoster() {
    store.employees = [
      employees[0]!,
      ...Array.from({ length: 999 }, (_, index) => ({
        id: `v${index + 1}`,
        fullName: `Сотрудник ${String(index + 1).padStart(4, '0')}`,
        position: 'агент',
        avatarUrl: null,
        sortOrder: index + 1,
      })),
    ];
    await nextTick();
    await nextTick();
  }
  async function scrollToRow(index: number) {
    const viewport = host.querySelector<HTMLElement>('.calendar-scroll')!;
    viewport.scrollTop = 42 + index * 64;
    viewport.dispatchEvent(new Event('scroll'));
    await nextTick();
    await nextTick();
  }
  it('bounds mounted rows, preserves their full height and exposes the real row indexes after scrolling', async () => {
    await largeRoster();
    expect(
      host.querySelector('.schedule-table')?.getAttribute('aria-rowcount'),
    ).toBe('1002');
    expect(host.querySelectorAll('.employee-row').length).toBeLessThan(20);
    expect(host.querySelector<HTMLElement>('.virtual-rows')?.style.height).toBe(
      '64000px',
    );
    expect(host.querySelector('[data-employee-id="v999"]')).toBeNull();
    await scrollToRow(990);
    expect(
      cell('v990', '2026-11-16')
        .closest('.employee-row')
        ?.getAttribute('aria-rowindex'),
    ).toBe('992');
    expect(host.querySelectorAll('.employee-row').length).toBeLessThan(20);
    expect(host.querySelector('[data-employee-id="v10"]')).toBeNull();
    // The currently focused first employee stays mounted outside the window.
    expect(host.querySelector('[data-employee-id="p1"]')).not.toBeNull();
    store.query = 'Сотрудник 0999';
    await nextTick();
    expect(host.querySelectorAll('.employee-row')).toHaveLength(1);
    expect(host.querySelector('.calendar-scroll')?.scrollTop).toBe(0);
    expect(cell('v999', '2026-11-16')).toBeDefined();
  });
  it('assigns a whole date to all 1000 employees while rendering only a small window in either view', async () => {
    await largeRoster();
    await click(dateButton('2026-11-16'));
    await click(document.querySelector<HTMLButtonElement>('.template-choice')!);
    expect(store.coverage.get('2026-11-16')).toBe(1000);
    expect(store.draftByCell.get('v999/2026-11-16')?.templateId).toBe(
      'morning',
    );
    expect(store.selected.size).toBe(1000);
    expect(host.querySelectorAll('.employee-row').length).toBeLessThan(20);
    store.clearSelection();
    store.view = 'month';
    await store.load();
    await nextTick();
    expect(store.coverage.get('2026-11-16')).toBe(1000);
    expect(host.querySelectorAll('.shift-cell').length).toBeLessThan(600);
    await scrollToRow(990);
    expect(cell('v990', '2026-11-16').classList.contains('is-filled')).toBe(
      true,
    );
  });
  it('extends a rectangle across unmounted employees without losing hidden selections', async () => {
    await largeRoster();
    pointer('pointerdown', cell('p1', '2026-11-16'));
    await scrollToRow(600);
    pointTarget = cell('v600', '2026-11-17');
    pointer('pointermove', window, 100, 100);
    pointer('pointerup', window, 100, 100, { buttons: 0 });
    await nextTick();
    expect(store.selected.size).toBe(1202);
    expect(store.selected.has('v300/2026-11-16')).toBe(true);
    await click(
      host.querySelector<HTMLButtonElement>('[aria-label="Применить шаблон"]')!,
    );
    expect(store.coverage.get('2026-11-16')).toBe(601);
    expect(store.coverage.get('2026-11-17')).toBe(601);
    expect(host.querySelectorAll('.employee-row').length).toBeLessThan(20);
  });
  it('keeps keyboard move navigation working when its target was not mounted', async () => {
    await largeRoster();
    await click(cell('p1', '2026-11-19'));
    await click(
      host.querySelector<HTMLButtonElement>('[aria-label="Перенести смену"]')!,
    );
    expect(host.querySelector('[data-employee-id="v16"]')).toBeNull();
    for (let index = 0; index < 16; index++) {
      document.activeElement!.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 'ArrowDown',
          bubbles: true,
          cancelable: true,
        }),
      );
      await nextTick();
      await nextTick();
    }
    expect(document.activeElement).toBe(cell('v16', '2026-11-19'));
    document.activeElement!.dispatchEvent(
      new KeyboardEvent('keydown', {
        key: 'Enter',
        bubbles: true,
        cancelable: true,
      }),
    );
    await nextTick();
    expect(store.draftByCell.get('v16/2026-11-19')?.id).toBe('original');
    expect(store.draftByCell.has('p1/2026-11-19')).toBe(false);
    expect(store.coverage.get('2026-11-19')).toBe(1);
  });
  it('retains a dragged source across virtual windows and moves to the rendered target', async () => {
    await largeRoster();
    pointer('pointerdown', cell('p1', '2026-11-19'));
    pointTarget = cell('v1', '2026-11-20');
    pointer('pointermove', window, 100, 100);
    await nextTick();
    await scrollToRow(600);
    expect(cell('p1', '2026-11-19').classList.contains('is-move-source')).toBe(
      true,
    );
    pointTarget = cell('v600', '2026-11-20');
    pointer('pointermove', window, 100, 100);
    pointer('pointerup', window, 100, 100, { buttons: 0 });
    await nextTick();
    expect(store.draftByCell.get('v600/2026-11-20')?.id).toBe('original');
    expect(store.draftByCell.has('p1/2026-11-19')).toBe(false);
    expect(store.coverage.get('2026-11-20')).toBe(1);
    expect(host.querySelectorAll('.employee-row').length).toBeLessThan(20);
  });
});

describe('save controls and unload protection', () => {
  it('enables Save for a draft, freezes controls until its reply and removes the dirty warning after success', async () => {
    await click(cell('p2', '2026-11-20'));
    await click(host.querySelector<HTMLButtonElement>('.apply-custom')!);
    const saveButton = [
      ...host.querySelectorAll<HTMLButtonElement>('.page-actions button'),
    ].find((button) => button.textContent?.trim() === 'Сохранить')!;
    expect(saveButton.disabled).toBe(false);
    let reply!: () => void;
    vi.mocked(scheduleApi.save).mockImplementationOnce(
      (body) =>
        new Promise((resolve) => {
          reply = () =>
            resolve({
              requestId: body.requestId,
              revision: 8,
              assignments: [
                { ...store.draftByCell.get('p2/2026-11-20')!, id: 'canonical' },
              ],
              deletedCells: [],
            });
        }),
    );
    await click(saveButton);
    expect(saveButton.textContent).toContain('Сохраняем');
    expect(
      host.querySelector<HTMLFieldSetElement>('.editor-controls')?.disabled,
    ).toBe(true);
    expect(store.deleteShifts([{ employeeId: 'p2', date: '2026-11-20' }])).toBe(
      false,
    );
    reply();
    await Promise.resolve();
    await nextTick();
    await nextTick();
    expect(store.hasUnsavedChanges).toBe(false);
    expect(host.querySelector('.draft-state')).toBeNull();
    expect(host.querySelector('.persistence-state')?.textContent).toContain(
      'Изменения сохранены',
    );
    expect(saveButton.disabled).toBe(true);
  });
  it('warns on unload only when there is a draft or an unresolved request', async () => {
    const clean = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(clean);
    expect(clean.defaultPrevented).toBe(false);
    store.applyCustomShift([{ employeeId: 'p2', date: '2026-11-20' }], {
      startTime: '22:00',
      endTime: '06:00',
      endDayOffset: 1,
    });
    const dirty = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(dirty);
    expect(dirty.defaultPrevented).toBe(true);
    store.deleteShifts([{ employeeId: 'p2', date: '2026-11-20' }]);
    const reverted = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(reverted);
    expect(reverted.defaultPrevented).toBe(false);
  });
  it('shows a three-way review and requires a radio choice before applying conflicting versions', async () => {
    store.deleteShifts([{ employeeId: 'p1', date: '2026-11-19' }]);
    vi.mocked(scheduleApi.save).mockRejectedValueOnce({
      isAxiosError: true,
      response: { status: 409, data: { error: { code: 'REVISION_CONFLICT' } } },
    });
    await store.save();
    await nextTick();
    const compare = [
      ...host.querySelectorAll<HTMLButtonElement>('button'),
    ].find((button) => button.textContent?.trim() === 'Сравнить с сервером')!;
    vi.mocked(scheduleApi.schedule).mockImplementation(async (range) => ({
      ...range,
      revision: 8,
      timeZone: 'Europe/Moscow',
      latestPublication: null,
      assignments: [
        {
          id: 'original',
          employeeId: 'p1',
          date: '2026-11-19',
          templateId: 'morning',
          startTime: '07:00',
          endTime: '16:00',
          endDayOffset: 0,
          color: '#E8ECFF',
        },
      ],
    }));
    await click(compare);
    await Promise.resolve();
    await nextTick();
    await nextTick();
    const review = host.querySelector('.comparison')!;
    expect(review.textContent).toContain('Было: 07:00–15:00');
    expect(review.textContent).toContain('Моя версия: Нет смены');
    const apply = review.querySelector<HTMLButtonElement>('.button--primary')!;
    expect(apply.disabled).toBe(true);
    const remoteRadio = review.querySelectorAll<HTMLInputElement>(
      'input[type="radio"]',
    )[1]!;
    remoteRadio.checked = true;
    remoteRadio.dispatchEvent(new Event('change', { bubbles: true }));
    await nextTick();
    expect(apply.disabled).toBe(false);
    await click(apply);
    expect(store.draftByCell.get('p1/2026-11-19')?.endTime).toBe('16:00');
    expect(store.hasUnsavedChanges).toBe(false);
  });
});
