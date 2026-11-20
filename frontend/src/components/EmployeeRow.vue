<script setup lang="ts">
import type {
  Employee,
  ScheduleCell,
  ShiftAssignment,
} from '@time-card/shared';
import type { CalendarView, ScheduleDay } from '../calendar';
import { cellKey } from '../calendar';
import ShiftCell from './ShiftCell.vue';
defineProps<{
  employee: Employee;
  hours: string;
  days: ScheduleDay[];
  assignments: Map<string, ShiftAssignment>;
  selected: Set<string>;
  view: CalendarView;
  focusedKey: string;
  rowIndex: number;
  moveSourceKey: string;
  moveTargetKey: string;
  moveWillReplace: boolean;
}>();
defineEmits<{
  select: [cell: ScheduleCell, event: MouseEvent];
  edit: [cell: ScheduleCell];
}>();
</script>
<template>
  <div
    class="employee-row schedule-row"
    :class="{ 'is-alternate': rowIndex % 2 === 1 }"
    role="row"
    :aria-rowindex="rowIndex"
  >
    <div
      class="employee-info sticky-employee"
      role="rowheader"
    >
      <img
        v-if="employee.avatarUrl"
        :src="employee.avatarUrl"
        alt=""
        width="32"
        height="32"
        class="avatar"
      >
      <span
        v-else
        class="avatar initials"
        aria-hidden="true"
      >{{
        employee.fullName.slice(0, 1)
      }}</span>
      <div class="employee-text">
        <span
          class="employee-name"
          :title="employee.fullName"
        >{{
          employee.fullName
        }}</span><span class="employee-meta">{{ employee.position }} · {{ hours }} ч</span>
      </div>
    </div>
    <ShiftCell
      v-for="day in days"
      :key="day.date"
      :day="day"
      :employee-name="employee.fullName"
      :employee-id="employee.id"
      :shift="assignments.get(`${employee.id}/${day.date}`)"
      :selected="selected.has(`${employee.id}/${day.date}`)"
      :view="view"
      :move-source="moveSourceKey === `${employee.id}/${day.date}`"
      :move-target="moveTargetKey === `${employee.id}/${day.date}`"
      :move-will-replace="moveWillReplace"
      :tab-index="
        focusedKey === cellKey({ employeeId: employee.id, date: day.date })
          ? 0
          : -1
      "
      @select="
        $emit('select', { employeeId: employee.id, date: day.date }, $event)
      "
      @edit="$emit('edit', { employeeId: employee.id, date: day.date })"
    />
  </div>
</template>
<style scoped>
.employee-row {
  min-height: 64px;
  background: white;
}
.employee-row.is-alternate {
  background: #f8f8fa;
}
.employee-info {
  display: flex;
  align-items: center;
  gap: 10px;
  min-width: 0;
  padding: 8px 12px 8px 4px;
  background: inherit;
  border-right: 1px solid #f1f2f6;
}
.avatar {
  display: block;
  flex-shrink: 0;
  width: 32px;
  height: 32px;
  border-radius: 9px;
  object-fit: cover;
  background: #edf0f7;
}
.initials {
  display: grid;
  place-items: center;
  color: #6774a5;
}
.employee-text {
  display: flex;
  flex-direction: column;
  gap: 3px;
  min-width: 0;
}
.employee-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.875rem;
}
.employee-meta {
  font-size: 0.75rem;
  color: #9598a4;
}
</style>
