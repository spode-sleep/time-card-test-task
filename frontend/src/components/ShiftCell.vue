<script setup lang="ts">
import { computed } from 'vue';
import type { ShiftAssignment } from '@time-card/shared';
import type { CalendarView, ScheduleDay } from '../calendar';
import { formatShiftTime, shiftHours } from '../calendar';
const props = defineProps<{
  shift?: ShiftAssignment | undefined;
  day: ScheduleDay;
  employeeName: string;
  employeeId: string;
  tabIndex: number;
  selected: boolean;
  view: CalendarView;
  moveSource: boolean;
  moveTarget: boolean;
  moveWillReplace: boolean;
}>();
defineEmits<{ select: [event: MouseEvent]; edit: [] }>();
const hours = computed(() =>
  props.shift
    ? shiftHours(
        props.shift.startTime,
        props.shift.endTime,
        props.shift.endDayOffset,
      )
    : '',
);
const label = computed(
  () =>
    `${props.employeeName}, ${props.day.label}, ${props.shift ? `${props.shift.startTime}–${props.shift.endTime}${props.shift.endDayOffset ? ', окончание на следующий день' : ''}, ${hours.value} ч` : 'нет смены'}`,
);
</script>
<template>
  <div
    class="day-cell"
    role="gridcell"
    :aria-selected="selected"
  >
    <button
      class="shift-cell"
      :class="{
        'is-filled': shift,
        'is-custom': shift && !shift.templateId,
        'is-selected': selected,
        'is-move-source': moveSource,
        'is-drop-target': moveTarget,
        'will-replace': moveTarget && moveWillReplace,
      }"
      :style="shift ? { '--shift-color': shift.color } : undefined"
      type="button"
      :data-employee-id="employeeId"
      :data-date="day.date"
      :tabindex="tabIndex"
      :aria-label="label"
      :aria-pressed="selected"
      :title="label"
      @click="$emit('select', $event)"
      @dblclick="shift && $emit('edit')"
      @keydown.f2.stop.prevent="shift && $emit('edit')"
    >
      <template v-if="shift">
        <span
          v-if="view === 'week'"
          class="shift-time"
          :class="{
            'has-minutes':
              !shift.startTime.endsWith(':00') ||
              !shift.endTime.endsWith(':00'),
          }"
        >{{ formatShiftTime(shift.startTime) }}–{{
          formatShiftTime(shift.endTime)
        }}</span>
        <span
          class="shift-hours"
          :class="{ 'is-month': view === 'month' }"
        >{{ hours }} ч</span>
        <span
          v-if="shift.endDayOffset"
          class="overnight"
        >+1</span>
      </template>
      <span
        v-else
        class="cell-plus"
        aria-hidden="true"
      >+</span>
    </button>
  </div>
</template>
<style scoped>
.day-cell {
  display: flex;
  align-items: stretch;
  min-width: 0;
  padding: 3px;
}
.shift-cell {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 3px;
  width: 100%;
  min-height: 55px;
  padding: 5px 2px;
  border: 1px dashed #e4e6ee;
  border-radius: 7px;
  background: transparent;
  font-size: 0.875rem;
}
.shift-cell:hover {
  border-color: #9eafff;
  background: #f0f3ff;
}
.shift-cell.is-filled {
  border: 1px solid transparent;
  background: var(--shift-color);
}
.is-filled:hover {
  filter: brightness(0.97);
}
.is-filled {
  cursor: grab;
}
.shift-cell.is-custom {
  color: white;
}
.shift-cell.is-selected {
  border: 1px solid #7b91ff;
  border-radius: 0;
  box-shadow: inset 0 0 0 1px #7b91ff;
  background: var(--color-selection);
  color: var(--color-text);
}
.shift-cell.is-move-source {
  opacity: 0.45;
  border: 2px dashed #7082ca;
}
.shift-cell.is-drop-target {
  border: 2px solid #2c9472;
  box-shadow: inset 0 0 0 1px #2c9472;
  background: #e7f8ef;
  color: var(--color-text);
}
.shift-cell.is-drop-target.will-replace {
  border-color: #b98023;
  box-shadow: inset 0 0 0 1px #b98023;
  background: #fff3da;
}
.shift-hours {
  color: #7568b8;
  font-size: 0.75rem;
}
.shift-time {
  white-space: nowrap;
  font-variant-numeric: tabular-nums;
}
.shift-time.has-minutes {
  font-size: 0.6875rem;
  letter-spacing: -0.15px;
}
.is-custom .shift-hours {
  color: #eef0ff;
}
.is-selected .shift-hours {
  color: #6378e8;
}
.is-drop-target .shift-hours {
  color: #53657c;
}
.shift-hours.is-month {
  font-size: 0.875rem;
}
.cell-plus {
  display: grid;
  place-items: center;
  width: 18px;
  height: 18px;
  border-radius: 50%;
  background: var(--color-primary);
  color: white;
  font-size: 16px;
  line-height: 1;
  opacity: 0;
}
.shift-cell:hover .cell-plus,
.is-selected .cell-plus,
.shift-cell:focus-visible .cell-plus {
  opacity: 1;
}
.overnight {
  position: absolute;
  right: 3px;
  top: 2px;
  font-size: 0.65rem;
}
</style>
