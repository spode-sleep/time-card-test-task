import { nextTick, onBeforeUnmount, ref, watch, type Ref } from 'vue';
import type { ScheduleCell, ShiftAssignment } from '@time-card/shared';
import { cellKey } from '../calendar';
import type { CellRectangle } from '../selection';

interface Context {
  employeeIds: string[];
  dates: string[];
  selected: Set<string>;
  assignments: Map<string, ShiftAssignment>;
}
interface Callbacks {
  select: (cell: ScheduleCell, additive: boolean) => void;
  rectangle: (range: CellRectangle) => void;
  restore: (cells: ScheduleCell[]) => void;
}
interface Gesture {
  pointerId: number;
  from: ScheduleCell;
  last: ScheduleCell;
  x: number;
  y: number;
  before: ScheduleCell[];
  additive: boolean;
  started: boolean;
  cancelled: boolean;
}

export function useCellSelection(
  root: Ref<HTMLElement | null>,
  context: () => Context,
  callbacks: Callbacks,
) {
  const focusedKey = ref('');
  const dragging = ref(false);
  let gesture: Gesture | null = null;
  let keyboardAnchor: ScheduleCell | null = null;
  let keyboardBase: ScheduleCell[] = [];
  let blockClick = false;
  let unblockTimer: number | undefined;

  function selectedCells(): ScheduleCell[] {
    return [...context().selected].map((key) => {
      const [employeeId = '', date = ''] = key.split('/');
      return { employeeId, date };
    });
  }
  function cellFromElement(target: EventTarget | null): ScheduleCell | null {
    const button =
      target instanceof Element
        ? target.closest<HTMLElement>('.shift-cell')
        : null;
    if (!button || !root.value?.contains(button)) return null;
    const { employeeId, date } = button.dataset;
    return employeeId && date ? { employeeId, date } : null;
  }
  function cellAt(event: PointerEvent): ScheduleCell | null {
    return cellFromElement(
      document.elementFromPoint(event.clientX, event.clientY),
    );
  }
  function focusCell(cell: ScheduleCell, reveal = true) {
    focusedKey.value = cellKey(cell);
    // The virtualizer pins the focused employee. Wait for an off-screen row
    // to mount before focusing a cell reached with the keyboard.
    if (!findButton(cell)) {
      void nextTick(() => revealCell(cell, reveal));
      return;
    }
    revealCell(cell, reveal);
  }
  function findButton(cell: ScheduleCell) {
    return [
      ...(root.value?.querySelectorAll<HTMLButtonElement>('.shift-cell') ?? []),
    ].find(
      (item) =>
        item.dataset.employeeId === cell.employeeId &&
        item.dataset.date === cell.date,
    );
  }
  function revealCell(cell: ScheduleCell, reveal: boolean) {
    if (focusedKey.value !== cellKey(cell)) return;
    const button = findButton(cell);
    button?.focus({ preventScroll: true });
    if (!button || !root.value || !reveal) return;
    const box = button.getBoundingClientRect();
    const viewport = root.value.getBoundingClientRect();
    const left =
      root.value.querySelector('.employee-info')?.getBoundingClientRect()
        .right ?? viewport.left;
    const top =
      root.value.querySelector('.calendar-header')?.getBoundingClientRect()
        .bottom ?? viewport.top;
    const bottom =
      root.value.querySelector('.coverage-row')?.getBoundingClientRect().top ??
      viewport.bottom;
    if (box.left < left) root.value.scrollLeft -= left - box.left + 3;
    else if (box.right > viewport.right)
      root.value.scrollLeft += box.right - viewport.right + 3;
    if (box.top < top) root.value.scrollTop -= top - box.top + 3;
    else if (box.bottom > bottom)
      root.value.scrollTop += box.bottom - bottom + 3;
  }
  function removeListeners() {
    window.removeEventListener('pointermove', move);
    window.removeEventListener('pointerup', finish);
    window.removeEventListener('pointercancel', cancel);
    window.removeEventListener('keydown', cancelKey, true);
    window.removeEventListener('blur', cancel);
  }
  function end(restore: boolean, suppressClick: boolean) {
    const previous = gesture;
    gesture = null;
    dragging.value = false;
    removeListeners();
    if (previous && root.value?.hasPointerCapture(previous.pointerId))
      root.value.releasePointerCapture(previous.pointerId);
    if (restore && previous?.started && !previous.cancelled)
      callbacks.restore(previous.before);
    if (suppressClick) {
      blockClick = true;
      unblockTimer = window.setTimeout(() => {
        blockClick = false;
      }, 0);
    }
  }
  function pointerDown(event: PointerEvent) {
    if (event.button !== 0 || !event.isPrimary || event.pointerType === 'touch')
      return;
    const cell = cellFromElement(event.target);
    // Filled cards use a separate gesture for moving shifts.
    if (!cell || context().assignments.has(cellKey(cell))) return;
    end(false, false);
    window.clearTimeout(unblockTimer);
    blockClick = false;
    gesture = {
      pointerId: event.pointerId,
      from: cell,
      last: cell,
      x: event.clientX,
      y: event.clientY,
      before: selectedCells(),
      additive: event.ctrlKey || event.metaKey,
      started: false,
      cancelled: false,
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', finish);
    window.addEventListener('pointercancel', cancel);
    window.addEventListener('keydown', cancelKey, true);
    window.addEventListener('blur', cancel);
  }
  function move(event: PointerEvent) {
    const current = gesture;
    if (!current || event.pointerId !== current.pointerId || current.cancelled)
      return;
    if (!(event.buttons & 1)) {
      cancel();
      return;
    }
    if (
      !current.started &&
      Math.hypot(event.clientX - current.x, event.clientY - current.y) < 6
    )
      return;
    const cell = cellAt(event);
    if (!cell) return;
    if (!current.started) {
      current.started = true;
      dragging.value = true;
      root.value?.setPointerCapture(event.pointerId);
      focusCell(current.from, false);
      keyboardAnchor = null;
    }
    event.preventDefault();
    current.last = cell;
    callbacks.rectangle({
      from: current.from,
      to: cell,
      base: current.additive ? current.before : [],
    });
  }
  function finish(event: PointerEvent) {
    const current = gesture;
    if (!current || event.pointerId !== current.pointerId) return;
    if (current.started && !current.cancelled) focusCell(current.last, false);
    end(false, current.started || current.cancelled);
  }
  function cancel() {
    end(true, false);
  }
  function cancelKey(event: KeyboardEvent) {
    if (event.key !== 'Escape' || !gesture) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    const current = gesture;
    if (current.started && !current.cancelled)
      callbacks.restore(current.before);
    current.cancelled = true;
    root.value?.setPointerCapture(current.pointerId);
    focusCell(current.from, false);
  }
  function lostCapture(event: PointerEvent) {
    if (gesture?.pointerId === event.pointerId) cancel();
  }
  function clickCapture(event: MouseEvent) {
    if (blockClick && event.detail !== 0) {
      event.preventDefault();
      event.stopPropagation();
    }
  }
  function clickCell(cell: ScheduleCell, event: MouseEvent) {
    focusedKey.value = cellKey(cell);
    keyboardAnchor = null;
    const touch = 'pointerType' in event && event.pointerType === 'touch';
    callbacks.select(cell, event.ctrlKey || event.metaKey || touch);
  }
  function keyDown(event: KeyboardEvent) {
    const current = cellFromElement(event.target);
    if (!current) return;
    const { employeeIds, dates } = context();
    const row = employeeIds.indexOf(current.employeeId);
    const column = dates.indexOf(current.date);
    if (row < 0 || column < 0) return;
    const directions: Record<string, [number, number]> = {
      ArrowLeft: [0, -1],
      ArrowRight: [0, 1],
      ArrowUp: [-1, 0],
      ArrowDown: [1, 0],
    };
    const delta = directions[event.key];
    if (!delta) return;
    event.preventDefault();
    const employeeId = employeeIds[row + delta[0]];
    const date = dates[column + delta[1]];
    if (!employeeId || !date) return;
    const next = { employeeId, date };
    if (event.shiftKey) {
      if (!keyboardAnchor) {
        keyboardAnchor = current;
        keyboardBase = event.ctrlKey || event.metaKey ? selectedCells() : [];
      }
      callbacks.rectangle({
        from: keyboardAnchor,
        to: next,
        base: keyboardBase,
      });
    } else keyboardAnchor = null;
    focusCell(next);
  }
  watch(
    () => `${context().employeeIds.join(',')}/${context().dates.join(',')}`,
    () => {
      // Filtering/navigation already reconciles selection in the store; do not restore hidden cells.
      end(false, false);
      keyboardAnchor = null;
      const { employeeIds, dates } = context();
      focusedKey.value =
        employeeIds[0] && dates[0]
          ? cellKey({ employeeId: employeeIds[0], date: dates[0] })
          : '';
    },
    { immediate: true },
  );
  onBeforeUnmount(() => {
    end(false, false);
    window.clearTimeout(unblockTimer);
  });
  watch(
    () => context().selected.size,
    (size) => {
      if (!size) keyboardAnchor = null;
    },
  );
  return {
    focusCell,
    focusedKey,
    dragging,
    pointerDown,
    lostCapture,
    clickCapture,
    clickCell,
    keyDown,
  };
}
