<script setup lang="ts">
import { computed } from 'vue';
import {
  LayoutTemplateIcon,
  MoveIcon,
  PencilIcon,
  Trash2Icon,
  XIcon,
} from '@lucide/vue';
import type { ScheduleCell } from '@time-card/shared';
const props = defineProps<{
  cells: ScheduleCell[];
  canApplyTemplate: boolean;
  canEditTime: boolean;
  canDeleteShifts: boolean;
}>();
defineEmits<{ clear: []; applyTemplate: []; delete: []; edit: []; move: [] }>();
const employees = computed(
  () => new Set(props.cells.map((cell) => cell.employeeId)).size,
);
const dates = computed(
  () => new Set(props.cells.map((cell) => cell.date)).size,
);
const cellWord = computed(() => {
  const form = new Intl.PluralRules('ru-RU').select(props.cells.length);
  return { one: 'ячейка', few: 'ячейки', many: 'ячеек', other: 'ячеек' }[
    form as 'one' | 'few' | 'many' | 'other'
  ];
});
</script>
<template>
  <div
    class="selection-toolbar"
    role="region"
    aria-label="Выделенные ячейки"
  >
    <div
      class="selection-summary"
      aria-live="polite"
    >
      <span>Выделено</span><strong>{{ cells.length }} {{ cellWord }}</strong><span class="selection-details">{{ employees }} сотр. · {{ dates }} дн.</span>
    </div>
    <div class="selection-actions">
      <button
        v-if="canEditTime"
        type="button"
        aria-label="Изменить время смены"
        @click="$emit('edit')"
      >
        <PencilIcon :size="14" /><span>Изменить время</span>
      </button>
      <button
        v-if="canEditTime"
        type="button"
        aria-label="Перенести смену"
        @click="$emit('move')"
      >
        <MoveIcon :size="14" /><span>Перенести</span>
      </button>
      <button
        type="button"
        :disabled="!canApplyTemplate"
        aria-label="Применить шаблон"
        @click="$emit('applyTemplate')"
      >
        <LayoutTemplateIcon :size="14" /><span>Применить шаблон</span>
      </button>
      <button
        type="button"
        aria-label="Очистить"
        :disabled="!canDeleteShifts"
        @click="$emit('delete')"
      >
        <Trash2Icon :size="14" /><span>Очистить</span>
      </button>
      <button
        type="button"
        aria-label="Снять выделение"
        @click="$emit('clear')"
      >
        <XIcon :size="14" /><span>Снять</span>
      </button>
    </div>
  </div>
</template>
<style scoped>
.selection-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  flex-wrap: wrap;
  gap: 8px 12px;
  min-height: 44px;
  margin-bottom: 16px;
  padding: 7px 10px;
  border-radius: 7px;
  background: #3f3e48;
  color: white;
  font-size: 0.75rem;
}
.selection-summary,
.selection-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.selection-summary {
  flex-wrap: wrap;
}
.selection-summary strong {
  padding: 3px 7px;
  border-radius: 5px;
  background: #ffffff1a;
  font-weight: 400;
}
.selection-details {
  color: #e1e0e7;
}
.selection-actions {
  margin-left: auto;
  gap: 12px;
}
.selection-actions button {
  display: flex;
  align-items: center;
  gap: 4px;
  min-height: 28px;
  padding: 0;
  border: 0;
  background: transparent;
  color: white;
  font-size: 0.75rem;
}
.selection-actions button:disabled {
  opacity: 0.45;
}
.selection-actions button:hover:not(:disabled) {
  color: #bfcaff;
}
@media (max-width: 600px) {
  .selection-details {
    display: none;
  }
  .selection-actions button span {
    display: none;
  }
}
</style>
