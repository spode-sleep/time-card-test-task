<script setup lang="ts">
import type {
  ShiftAssignment,
  ScheduleCell,
  ShiftTemplate,
  ShiftTime,
} from '@time-card/shared';
import { shiftHours } from '../calendar';
import CustomShiftForm from './CustomShiftForm.vue';
defineProps<{
  templates: ShiftTemplate[];
  assignments: ShiftAssignment[];
  canApply: boolean;
  activeTemplate: string;
  editingCell: ScheduleCell | null;
  editingLabel: string | null;
}>();
defineEmits<{
  applyCustom: [time: ShiftTime];
  chooseTemplate: [templateId: string];
  cancelEdit: [];
}>();
const startTime = defineModel<string>('startTime', { required: true });
const endTime = defineModel<string>('endTime', { required: true });
</script>
<template>
  <aside
    class="template-panel"
    aria-label="Назначение смен"
  >
    <h2>Шаблоны смен</h2>
    <div class="template-list">
      <button
        v-for="template in templates"
        :key="template.id"
        class="template-card"
        :style="{ '--template-color': template.color }"
        :aria-pressed="activeTemplate === template.id"
        type="button"
        @click="$emit('chooseTemplate', template.id)"
      >
        <span class="template-name">{{ template.name }}</span>
        <span class="template-time">{{ template.startTime }}–{{ template.endTime }} ·
          {{
            shiftHours(
              template.startTime,
              template.endTime,
              template.endDayOffset,
            )
          }}
          ч</span>
        <span
          class="template-count"
          :aria-label="`Назначений по шаблону ${assignments.filter((shift) => shift.templateId === template.id).length}`"
        >{{
          assignments.filter((shift) => shift.templateId === template.id)
            .length
        }}</span>
      </button>
    </div>
    <p
      v-if="!templates.length"
      class="empty-templates"
    >
      Шаблонов пока нет. Можно задать часы своей смены.
    </p>
    <CustomShiftForm
      v-model:start-time="startTime"
      v-model:end-time="endTime"
      :can-apply="canApply"
      :editing-cell="editingCell"
      :editing-label="editingLabel"
      @apply="$emit('applyCustom', $event)"
      @cancel-edit="$emit('cancelEdit')"
    />
  </aside>
</template>
<style scoped>
.template-panel {
  padding: 18px 16px;
  border-radius: var(--radius-card);
  background: white;
}
h2 {
  margin: 0 0 12px;
  font-size: 0.875rem;
  font-weight: 400;
}
.empty-templates {
  margin: 0;
  color: var(--color-muted);
  font-size: 0.8125rem;
  line-height: 1.5;
}
.template-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.template-card {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 3px;
  width: 100%;
  min-height: 56px;
  padding: 8px 32px 8px 12px;
  border: 1px solid transparent;
  border-left: 3px solid var(--template-color);
  border-radius: 7px;
  background: var(--color-field);
  text-align: left;
}
.template-card:hover {
  background: #ebeef8;
}
.template-card[aria-pressed='true'] {
  border-color: #c1cbff;
  border-left-color: #adbcff;
}
.template-name {
  font-size: 0.875rem;
}
.template-time {
  font-size: 0.75rem;
  white-space: nowrap;
}
.template-count {
  position: absolute;
  top: 10px;
  right: 9px;
  display: grid;
  place-items: center;
  min-width: 18px;
  height: 19px;
  padding-inline: 3px;
  border-radius: 3px;
  background: white;
  color: #656977;
  font-size: 0.6875rem;
}
</style>
