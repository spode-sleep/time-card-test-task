import { computed, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import type { ScheduleCell, ShiftAssignment } from '@time-card/shared';
import { cellKey } from '../calendar';

interface Context {
  employeeIds: string[];
  dates: string[];
  assignments: Map<string, ShiftAssignment>;
  selected: Set<string>;
}
interface Callbacks {
  focus: (cell: ScheduleCell, reveal?: boolean) => void;
  move: (from: ScheduleCell, to: ScheduleCell, replace: boolean) => boolean;
}
interface Gesture {
  id: number;
  from: ScheduleCell;
  shift: ShiftAssignment;
  x: number;
  y: number;
  started: boolean;
  cancelled: boolean;
}
interface Replacement {
  from: ScheduleCell;
  to: ScheduleCell;
  source: ShiftAssignment;
  destination: ShiftAssignment;
}
function signature(shift: ShiftAssignment | undefined): string {
  return shift ? JSON.stringify(shift) : '';
}

export function useShiftMove(
  root: Ref<HTMLElement | null>,
  context: () => Context,
  callbacks: Callbacks,
) {
  const source = ref<ScheduleCell | null>(null);
  const target = ref<ScheduleCell | null>(null);
  const shift = ref<ShiftAssignment | null>(null);
  const keyboard = ref(false);
  const dragging = ref(false);
  const pending = ref<Replacement | null>(null);
  const position = ref({ x: 0, y: 0 });
  const announcement = ref('');
  const sourceKey = computed(() => (source.value ? cellKey(source.value) : ''));
  const targetKey = computed(() => (target.value ? cellKey(target.value) : ''));
  const occupied = computed(
    () => !!targetKey.value && context().assignments.has(targetKey.value),
  );
  const validTarget = computed(
    () => !!targetKey.value && targetKey.value !== sourceKey.value,
  );
  let gesture: Gesture | null = null;
  let animation: number | undefined;
  let lastFrame = 0;
  let blockClick = false;
  let unblockTimer: number | undefined;

  function cellFromElement(element: EventTarget | null): ScheduleCell | null {
    const button =
      element instanceof Element
        ? element.closest<HTMLElement>('.shift-cell')
        : null;
    if (!button || !root.value?.contains(button)) return null;
    const { employeeId, date } = button.dataset;
    if (
      !employeeId ||
      !date ||
      !context().employeeIds.includes(employeeId) ||
      !context().dates.includes(date)
    )
      return null;
    return { employeeId, date };
  }
  function atPoint(x: number, y: number) {
    return cellFromElement(document.elementFromPoint(x, y));
  }
  function suppressClick() {
    window.clearTimeout(unblockTimer);
    blockClick = true;
    unblockTimer = window.setTimeout(() => {
      blockClick = false;
    }, 0);
  }
  function stopScrolling() {
    if (animation !== undefined) window.cancelAnimationFrame(animation);
    animation = undefined;
    lastFrame = 0;
  }
  function detachGesture() {
    const previous = gesture;
    gesture = null;
    stopScrolling();
    window.removeEventListener('pointermove', pointerMove);
    window.removeEventListener('pointerup', pointerUp);
    window.removeEventListener('pointercancel', pointerCancel);
    if (previous && root.value?.hasPointerCapture(previous.id))
      root.value.releasePointerCapture(previous.id);
  }
  function reset() {
    detachGesture();
    source.value = null;
    target.value = null;
    shift.value = null;
    pending.value = null;
    keyboard.value = false;
    dragging.value = false;
  }
  function cancel(reveal = true) {
    const previous = source.value;
    const wasStarted = gesture?.started;
    reset();
    if (wasStarted) suppressClick();
    if (previous) {
      announcement.value = 'Перенос отменён. Смены сохранены без изменений.';
      if (reveal) callbacks.focus(previous);
    }
  }
  function scrollFrame(time: number) {
    animation = undefined;
    if (!dragging.value || !root.value || !gesture || gesture.cancelled) return;
    const viewport = root.value;
    const bounds = viewport.getBoundingClientRect();
    const left = Math.max(
      bounds.left,
      viewport.querySelector('.employee-info')?.getBoundingClientRect().right ??
        bounds.left,
      0,
    );
    const right = Math.min(
      bounds.right,
      document.documentElement.clientWidth || window.innerWidth,
    );
    const top = Math.max(
      bounds.top,
      viewport.querySelector('.calendar-header')?.getBoundingClientRect()
        .bottom ?? bounds.top,
      0,
    );
    const bottom = Math.min(
      bounds.bottom,
      viewport.querySelector('.coverage-row')?.getBoundingClientRect().top ??
        bounds.bottom,
      document.documentElement.clientHeight || window.innerHeight,
    );
    const { x, y } = position.value;
    const factor = lastFrame ? Math.min(32, time - lastFrame) / 16 : 1;
    lastFrame = time;
    const speed = (point: number, start: number, end: number) => {
      const edge = Math.min(40, (end - start) / 3);
      if (point < start + edge)
        return -18 * (1 - Math.max(0, point - start) / edge);
      if (point > end - edge) return 18 * (1 - Math.max(0, end - point) / edge);
      return 0;
    };
    if (
      right > left &&
      bottom > top &&
      x >= left &&
      x <= right &&
      y >= top &&
      y <= bottom
    ) {
      viewport.scrollLeft += speed(x, left, right) * factor;
      viewport.scrollTop += speed(y, top, bottom) * factor;
      target.value = atPoint(x, y);
    }
    animation = window.requestAnimationFrame(scrollFrame);
  }
  function pointerDown(event: PointerEvent): boolean {
    // Touch keeps native scrolling. The explicit move command works with taps too.
    if (pending.value || keyboard.value) return true;
    if (event.button !== 0 || !event.isPrimary || event.pointerType === 'touch')
      return false;
    const from = cellFromElement(event.target);
    const assignment = from ? context().assignments.get(cellKey(from)) : null;
    if (!from || !assignment) return false;
    reset();
    window.clearTimeout(unblockTimer);
    blockClick = false;
    gesture = {
      id: event.pointerId,
      from,
      shift: { ...assignment },
      x: event.clientX,
      y: event.clientY,
      started: false,
      cancelled: false,
    };
    window.addEventListener('pointermove', pointerMove, { passive: false });
    window.addEventListener('pointerup', pointerUp);
    window.addEventListener('pointercancel', pointerCancel);
    return true;
  }
  function pointerMove(event: PointerEvent) {
    const current = gesture;
    if (!current || current.id !== event.pointerId || current.cancelled) return;
    if (!(event.buttons & 1)) {
      cancel();
      return;
    }
    if (
      !current.started &&
      Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6
    )
      return;
    if (!current.started) {
      if (
        signature(context().assignments.get(cellKey(current.from))) !==
        signature(current.shift)
      ) {
        cancel();
        return;
      }
      current.started = true;
      source.value = current.from;
      shift.value = current.shift;
      dragging.value = true;
      root.value?.setPointerCapture(event.pointerId);
      callbacks.focus(current.from, false);
      announcement.value =
        'Перенос смены. Отпустите над другой ячейкой; Escape отменяет перенос.';
      animation = window.requestAnimationFrame(scrollFrame);
    }
    event.preventDefault();
    position.value = { x: event.clientX, y: event.clientY };
    target.value = atPoint(event.clientX, event.clientY);
  }
  function commit(from: ScheduleCell, to: ScheduleCell, replace: boolean) {
    reset();
    if (callbacks.move(from, to, replace)) {
      callbacks.focus(to);
      announcement.value = 'Смена перенесена. Часы и покрытие обновлены.';
    } else {
      callbacks.focus(from);
      announcement.value =
        'Не удалось перенести смену. Проверьте сообщение об ошибке.';
    }
  }
  function choose(to: ScheduleCell | null) {
    const from = source.value;
    if (!from || pending.value) return;
    if (!to || cellKey(from) === cellKey(to)) {
      if (!keyboard.value) cancel();
      else announcement.value = 'Выберите другую ячейку для переноса.';
      return;
    }
    const current = context().assignments.get(cellKey(from));
    if (
      !current ||
      signature(current) !== signature(shift.value ?? undefined)
    ) {
      cancel();
      return;
    }
    const destination = context().assignments.get(cellKey(to));
    target.value = to;
    dragging.value = false;
    if (destination) {
      pending.value = {
        from: { ...from },
        to: { ...to },
        source: { ...current },
        destination: { ...destination },
      };
      announcement.value = 'Целевая ячейка занята. Подтвердите замену смены.';
    } else commit(from, to, false);
  }
  function pointerUp(event: PointerEvent) {
    const current = gesture;
    if (!current || current.id !== event.pointerId) return;
    const started = current.started;
    const cancelled = current.cancelled;
    const to = atPoint(event.clientX, event.clientY);
    detachGesture();
    if (!started) return;
    suppressClick();
    if (cancelled) reset();
    else choose(to);
  }
  function pointerCancel(event: PointerEvent) {
    if (gesture?.id === event.pointerId) cancel();
  }
  function lostCapture(event: PointerEvent) {
    if (gesture?.id === event.pointerId) cancel();
  }
  function clickCapture(event: MouseEvent) {
    if (blockClick && event.detail !== 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }
  function startKeyboard(from: ScheduleCell) {
    const assignment = context().assignments.get(cellKey(from));
    if (
      !assignment ||
      !context().employeeIds.includes(from.employeeId) ||
      !context().dates.includes(from.date)
    )
      return;
    reset();
    source.value = { ...from };
    target.value = { ...from };
    shift.value = { ...assignment };
    keyboard.value = true;
    announcement.value =
      'Выберите цель стрелками и нажмите Enter или коснитесь другой ячейки. Escape отменяет перенос.';
    callbacks.focus(from);
  }
  function keyDown(event: KeyboardEvent): boolean {
    if (!keyboard.value || pending.value) return false;
    const current = cellFromElement(event.target);
    if (!current) return false;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      event.stopPropagation();
      if (!event.repeat) choose(current);
      return true;
    }
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    };
    const delta = directions[event.key];
    if (!delta) return false;
    event.preventDefault();
    const { employeeIds, dates } = context();
    const employeeId =
      employeeIds[employeeIds.indexOf(current.employeeId) + delta[0]];
    const date = dates[dates.indexOf(current.date) + delta[1]];
    if (employeeId && date) {
      target.value = { employeeId, date };
      callbacks.focus(target.value);
    }
    return true;
  }
  function escape(event: KeyboardEvent) {
    if (event.key !== 'Escape' || pending.value || (!source.value && !gesture))
      return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (gesture?.started) {
      // Keep capture until release, so its synthetic click cannot change selection.
      gesture.cancelled = true;
      stopScrolling();
      dragging.value = false;
      target.value = null;
      announcement.value = 'Перенос отменён. Смены сохранены без изменений.';
      if (source.value) callbacks.focus(source.value, false);
    } else cancel();
  }
  function outside(event: PointerEvent) {
    if (
      event.target instanceof Element &&
      event.target.closest('.move-instructions')
    )
      return;
    if (keyboard.value && !pending.value && !cellFromElement(event.target))
      cancel(false);
  }
  function blur() {
    if (!pending.value) cancel(false);
  }
  function confirm() {
    const replacement = pending.value;
    if (!replacement) return;
    if (
      signature(context().assignments.get(cellKey(replacement.from))) !==
        signature(replacement.source) ||
      signature(context().assignments.get(cellKey(replacement.to))) !==
        signature(replacement.destination)
    ) {
      cancel();
      return;
    }
    commit(replacement.from, replacement.to, true);
  }
  watch(
    () => `${context().employeeIds.join(',')}/${context().dates.join(',')}`,
    () => cancel(false),
  );
  watch(
    () => [
      sourceKey.value
        ? signature(context().assignments.get(sourceKey.value))
        : '',
      pending.value
        ? signature(context().assignments.get(cellKey(pending.value.to)))
        : '',
      [...context().selected].join(','),
    ],
    ([currentSource, currentTarget, selection], previous) => {
      if (!source.value) return;
      if (
        currentSource !== signature(shift.value ?? undefined) ||
        (pending.value &&
          currentTarget !== signature(pending.value.destination)) ||
        (previous && selection !== previous[2])
      )
        cancel(false);
    },
  );
  window.addEventListener('keydown', escape, true);
  window.addEventListener('pointerdown', outside, true);
  window.addEventListener('blur', blur);
  onBeforeUnmount(() => {
    reset();
    window.clearTimeout(unblockTimer);
    window.removeEventListener('keydown', escape, true);
    window.removeEventListener('pointerdown', outside, true);
    window.removeEventListener('blur', blur);
  });
  return {
    source,
    target,
    shift,
    keyboard,
    dragging,
    pending,
    position,
    announcement,
    sourceKey,
    targetKey,
    occupied,
    validTarget,
    pointerDown,
    lostCapture,
    clickCapture,
    keyDown,
    choose,
    startKeyboard,
    cancel,
    confirm,
  };
}
