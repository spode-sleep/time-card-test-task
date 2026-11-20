<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  onMounted,
  ref,
  shallowRef,
  useId,
  watch,
  type ComponentPublicInstance,
} from 'vue';
import { defaultRangeExtractor, useVirtualizer } from '@tanstack/vue-virtual';
import type {
  Employee,
  ScheduleCell,
  ShiftAssignment,
  ShiftTemplate,
} from '@time-card/shared';
import {
  formatDuration,
  type CalendarView,
  type ScheduleDay,
} from '../calendar';
import EmployeeRow from './EmployeeRow.vue';
import CoverageRow from './CoverageRow.vue';
import QuickAssignMenu from './QuickAssignMenu.vue';
import { useCellSelection } from '../composables/useCellSelection';
import { useShiftMove } from '../composables/useShiftMove';
import MoveShiftDialog from './MoveShiftDialog.vue';
import type { CellRectangle } from '../selection';
const props = defineProps<{
  employees: (Employee & { hours: string })[];
  days: ScheduleDay[];
  assignments: Map<string, ShiftAssignment>;
  coverage: Map<string, number>;
  selected: Set<string>;
  view: CalendarView;
  templates: ShiftTemplate[];
  moveShift: (
    from: ScheduleCell,
    to: ScheduleCell,
    replace: boolean,
  ) => boolean;
}>();
const emit = defineEmits<{
  select: [cell: ScheduleCell, additive: boolean];
  setSelection: [cells: ScheduleCell[]];
  selectRange: [range: CellRectangle];
  quickAssign: [assignment: { date: string; templateId: string }];
  edit: [cell: ScheduleCell];
}>();
const calendar = ref<HTMLElement | null>(null);
const calendarHeader = ref<HTMLElement | null>(null);
const headerHeight = ref(42);
let headerObserver: ResizeObserver | undefined;
const helpId = useId();
const quickDay = ref<ScheduleDay | null>(null);
const quickAnchor = shallowRef<HTMLElement | null>(null);
const occupiedCount = computed(() =>
  quickDay.value
    ? props.employees.filter((employee) =>
        props.assignments.has(`${employee.id}/${quickDay.value?.date}`),
      ).length
    : 0,
);
const selection = useCellSelection(
  calendar,
  () => ({
    employeeIds: props.employees.map((employee) => employee.id),
    dates: props.days.map((day) => day.date),
    selected: props.selected,
    assignments: props.assignments,
  }),
  {
    select: (cell, additive) => emit('select', cell, additive),
    rectangle: (range) => emit('selectRange', range),
    restore: (cells) => emit('setSelection', cells),
  },
);
const employeeKeys = computed(() =>
  props.employees.map((employee) => employee.id),
);
const rowVirtualizer = useVirtualizer<HTMLElement, HTMLElement>(
  computed(() => {
    const keys = employeeKeys.value;
    const focusedEmployee = selection.focusedKey.value.split('/')[0];
    const focusedIndex = keys.indexOf(focusedEmployee ?? '');
    return {
      count: keys.length,
      getScrollElement: () => calendar.value,
      getItemKey: (index: number) => keys[index] ?? index,
      estimateSize: () => 64,
      overscan: 3,
      scrollMargin: headerHeight.value,
      rangeExtractor: (range: Parameters<typeof defaultRangeExtractor>[0]) => {
        const indexes = defaultRangeExtractor(range);
        // Retain actual focus and a dragged source even when scrolling far away.
        if (focusedIndex >= 0 && !indexes.includes(focusedIndex))
          indexes.push(focusedIndex);
        return indexes.sort((left, right) => left - right);
      },
    };
  }),
);
const virtualRows = computed(() => rowVirtualizer.value.getVirtualItems());
const rowsHeight = computed(() => rowVirtualizer.value.getTotalSize());
function measureRow(component: Element | ComponentPublicInstance | null) {
  const element = component instanceof Element ? component : component?.$el;
  if (element instanceof HTMLElement)
    rowVirtualizer.value.measureElement(element);
}
onMounted(() => {
  const measureHeader = () => {
    headerHeight.value = calendarHeader.value?.offsetHeight || 42;
  };
  measureHeader();
  if (window.ResizeObserver && calendarHeader.value) {
    headerObserver = new ResizeObserver(measureHeader);
    headerObserver.observe(calendarHeader.value);
  }
});
onBeforeUnmount(() => headerObserver?.disconnect());
const moving = useShiftMove(
  calendar,
  () => ({
    employeeIds: props.employees.map((employee) => employee.id),
    dates: props.days.map((day) => day.date),
    assignments: props.assignments,
    selected: props.selected,
  }),
  {
    focus: (cell, reveal = true) => {
      if (reveal) void nextTick(() => focusCell(cell));
      else selection.focusCell(cell, false);
    },
    move: (from, to, replace) => {
      const result = props.moveShift(from, to, replace);
      if (result) emit('setSelection', [to]);
      return result;
    },
  },
);
const ghostPosition = computed(() => ({
  left: `${Math.max(8, Math.min(moving.position.value.x + 14, (document.documentElement.clientWidth || window.innerWidth) - 188))}px`,
  top: `${Math.max(8, Math.min(moving.position.value.y + 14, (document.documentElement.clientHeight || window.innerHeight) - 100))}px`,
}));
function cellLabel(cell: ScheduleCell) {
  return `${props.employees.find((employee) => employee.id === cell.employeeId)?.fullName ?? ''} · ${props.days.find((day) => day.date === cell.date)?.label ?? cell.date}`;
}
function pointerDown(event: PointerEvent) {
  if (!moving.pointerDown(event)) selection.pointerDown(event);
}
function lostCapture(event: PointerEvent) {
  moving.lostCapture(event);
  selection.lostCapture(event);
}
function clickCapture(event: MouseEvent) {
  moving.clickCapture(event);
  if (!event.cancelBubble) selection.clickCapture(event);
}
function selectCell(cell: ScheduleCell, event: MouseEvent) {
  if (moving.keyboard.value) moving.choose(cell);
  else selection.clickCell(cell, event);
}
function keyDown(event: KeyboardEvent) {
  if (!moving.keyDown(event)) selection.keyDown(event);
}
function startMove(cell: ScheduleCell) {
  quickDay.value = null;
  moving.startKeyboard(cell);
}
function editCell(cell: ScheduleCell) {
  moving.cancel(false);
  emit('edit', cell);
}
function openQuick(day: ScheduleDay, event: MouseEvent) {
  moving.cancel(false);
  quickAnchor.value = event.currentTarget as HTMLElement;
  quickDay.value = day;
}
function applyQuick(templateId: string) {
  if (quickDay.value)
    emit('quickAssign', { date: quickDay.value.date, templateId });
  quickDay.value = null;
}
function focusCell(cell: ScheduleCell) {
  calendar.value?.scrollIntoView({ block: 'nearest' });
  selection.focusCell(cell);
}
defineExpose({ focusCell, startMove });
watch(
  () =>
    `${props.employees.map((employee) => employee.id).join(',')}/${props.days.map((day) => day.date).join(',')}`,
  () => {
    quickDay.value = null;
    if (calendar.value) calendar.value.scrollTop = 0;
  },
);
</script>
<template>
  <div
    v-if="moving.keyboard.value && !moving.pending.value"
    class="move-instructions"
  >
    <span>Выберите цель стрелками и нажмите Enter или коснитесь другой
      ячейки.</span>
    <button
      class="button"
      type="button"
      @click="moving.cancel()"
    >
      Отменить перенос
    </button>
  </div>
  <div
    ref="calendar"
    class="calendar-scroll"
    :class="{
      'is-selecting': selection.dragging.value,
      'is-moving': moving.dragging.value,
    }"
    tabindex="0"
    aria-label="Прокручиваемый календарь смен"
    :aria-describedby="helpId"
    @pointerdown="pointerDown"
    @lostpointercapture="lostCapture"
    @click.capture="clickCapture"
    @dblclick.capture="moving.clickCapture"
    @keydown="keyDown"
  >
    <div
      class="schedule-table"
      :class="{ 'is-month': view === 'month' }"
      :style="{ '--day-count': days.length }"
      role="grid"
      aria-multiselectable="true"
      aria-label="Смены сотрудников"
      :aria-colcount="days.length + 1"
      :aria-rowcount="employees.length + 2"
    >
      <div
        ref="calendarHeader"
        class="calendar-header schedule-row"
        role="row"
        :aria-rowindex="1"
      >
        <div
          class="employee-heading sticky-employee"
          role="columnheader"
        >
          Сотрудник
        </div>
        <div
          v-for="day in days"
          :key="day.date"
          class="day-heading"
          :class="{ 'is-weekend': day.weekend }"
          role="columnheader"
          :aria-label="day.label"
        >
          <button
            class="day-button"
            type="button"
            :aria-label="`Назначить смены: ${day.label}`"
            aria-haspopup="dialog"
            :aria-expanded="quickDay?.date === day.date"
            :disabled="employees.length === 0"
            @click="openQuick(day, $event)"
          >
            <span>{{ day.weekday }}</span><span>{{ day.number }}</span>
          </button>
        </div>
      </div>
      <div
        class="virtual-rows"
        role="rowgroup"
        :style="{ height: `${rowsHeight}px` }"
      >
        <EmployeeRow
          v-for="row in virtualRows"
          :key="String(row.key)"
          :ref="measureRow"
          :data-index="row.index"
          :style="{ transform: `translateY(${row.start - headerHeight}px)` }"
          :row-index="row.index + 2"
          :employee="employees[row.index]!"
          :hours="employees[row.index]!.hours"
          :days="days"
          :assignments="assignments"
          :selected="selected"
          :view="view"
          :focused-key="selection.focusedKey.value"
          :move-source-key="moving.sourceKey.value"
          :move-target-key="
            moving.validTarget.value ? moving.targetKey.value : ''
          "
          :move-will-replace="moving.occupied.value"
          @select="selectCell"
          @edit="editCell"
        />
      </div>
      <CoverageRow
        :aria-rowindex="employees.length + 2"
        :days="days"
        :coverage="coverage"
      />
    </div>
    <p
      v-if="employees.length === 0"
      class="empty-search"
      role="status"
    >
      Сотрудники не найдены
    </p>
  </div>
  <p
    :id="helpId"
    class="selection-help"
  >
    Обычный клик выбирает одну ячейку. Ctrl или Command добавляет ячейку или
    снимает её выделение. Протяните мышью от пустой ячейки для выделения
    прямоугольника. Стрелки перемещают фокус, Shift со стрелками расширяет
    выделение. На сенсорном экране ячейки выбираются повторными касаниями.
    Перетаскивайте заполненную смену для переноса. Для переноса без мыши
    выделите смену и нажмите «Перенести», затем выберите цель стрелками и
    нажмите Enter. Escape отменяет перенос.
  </p>
  <p
    class="selection-help"
    role="status"
    aria-live="polite"
    aria-atomic="true"
  >
    {{ moving.announcement.value }}
  </p>
  <Teleport to="body">
    <div
      v-if="moving.dragging.value && moving.shift.value"
      class="shift-ghost"
      :style="{ ...ghostPosition, '--ghost-color': moving.shift.value.color }"
      aria-hidden="true"
    >
      <strong>{{ moving.shift.value.startTime }}–{{ moving.shift.value.endTime
      }}{{ moving.shift.value.endDayOffset ? ' +1' : '' }}</strong>
      <span>{{ formatDuration(moving.shift.value) }}</span>
      <small>{{
        moving.validTarget.value
          ? moving.occupied.value
            ? 'Замена с подтверждением'
            : 'Перенести сюда'
          : 'Выберите другую ячейку'
      }}</small>
    </div>
  </Teleport>
  <MoveShiftDialog
    v-if="moving.pending.value"
    :from-label="cellLabel(moving.pending.value.from)"
    :to-label="cellLabel(moving.pending.value.to)"
    :source="moving.pending.value.source"
    :destination="moving.pending.value.destination"
    @cancel="moving.cancel()"
    @confirm="moving.confirm"
  />
  <QuickAssignMenu
    v-if="quickDay && quickAnchor"
    :day="quickDay"
    :anchor="quickAnchor"
    :templates="templates"
    :employee-count="employees.length"
    :occupied-count="occupiedCount"
    @close="quickDay = null"
    @apply="applyQuick"
  />
</template>
<style scoped>
.calendar-scroll {
  overflow: auto;
  max-height: calc(100dvh - 306px);
  min-height: 330px;
  border-radius: 0 0 9px 9px;
  scrollbar-width: thin;
  scrollbar-color: #cdd3e8 transparent;
}
.schedule-table {
  user-select: none;
  --day-min-width: 80px;
  min-width: calc(
    var(--employee-width) + var(--day-count) * var(--day-min-width)
  );
}
.schedule-table.is-month {
  --day-min-width: 52px;
}
.virtual-rows {
  position: relative;
}
.virtual-rows :deep(.employee-row) {
  position: absolute;
  top: 0;
  left: 0;
  width: 100%;
}
.calendar-header {
  position: sticky;
  top: 0;
  z-index: 5;
  min-height: 42px;
  background: white;
  border-bottom: 1px solid #eeeff4;
  color: var(--color-muted);
  font-size: 0.75rem;
}
.employee-heading {
  display: flex;
  align-items: center;
  padding: 10px 4px;
  background: white;
}
.day-heading {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 3px 2px;
  white-space: nowrap;
}
.day-button {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 4px;
  min-height: 34px;
  width: 100%;
  padding: 4px 2px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  font-size: inherit;
}
.day-button:hover:not(:disabled),
.day-button[aria-expanded='true'] {
  background: var(--color-primary-soft);
  color: #516bff;
}
.is-month .day-button {
  flex-direction: column;
  gap: 1px;
}
.day-heading.is-weekend {
  color: #a5a7b2;
}
.is-selecting {
  cursor: crosshair;
}
.is-moving,
.is-moving :deep(.shift-cell) {
  cursor: grabbing;
}
.move-instructions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  padding: 10px;
  margin-bottom: 10px;
  border-radius: 8px;
  background: var(--color-primary-soft);
  color: #4459b4;
  font-size: 0.875rem;
}
.move-instructions .button {
  margin-left: auto;
}
.shift-ghost {
  position: fixed;
  z-index: 20;
  pointer-events: none;
  display: grid;
  gap: 5px;
  width: 180px;
  padding: 12px;
  border: 1px solid #9cacf8;
  border-radius: 10px;
  background: white;
  box-shadow: 0 8px 28px #293a6b33;
  color: var(--color-text);
  font-size: 0.875rem;
}
.shift-ghost::before {
  content: '';
  height: 4px;
  border-radius: 4px;
  background: var(--ghost-color);
}
.shift-ghost small {
  color: #68749a;
  font-size: 0.75rem;
}
.selection-help {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip-path: inset(50%);
  white-space: nowrap;
}
.is-selecting :deep(.shift-cell) {
  cursor: crosshair;
}
.empty-search {
  padding: 48px 16px;
  margin: 0;
  text-align: center;
  color: var(--color-muted);
  font-size: 0.875rem;
}
@media (max-width: 850px) {
  .calendar-scroll {
    max-height: 610px;
  }
}
</style>
