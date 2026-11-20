<script setup lang="ts">
import { computed, nextTick, ref, useId, watch } from 'vue';
import { PlusIcon, PencilIcon } from '@lucide/vue';
import {
  createShiftTime,
  isValidLocalTime,
  type ScheduleCell,
  type ShiftTime,
} from '@time-card/shared';
import { formatDuration } from '../calendar';

const props = withDefaults(
  defineProps<{
    canApply?: boolean;
    editingCell?: ScheduleCell | null;
    editingLabel?: string | null;
  }>(),
  { canApply: false, editingCell: null, editingLabel: null },
);
const emit = defineEmits<{ apply: [time: ShiftTime]; cancelEdit: [] }>();
const startTime = defineModel<string>('startTime', { required: true });
const endTime = defineModel<string>('endTime', { required: true });
const form = ref<HTMLFormElement | null>(null);
const startInput = ref<HTMLInputElement | null>(null);
const id = useId();
const errorId = `${id}-error`;
const summaryId = `${id}-summary`;
const time = computed(() => createShiftTime(startTime.value, endTime.value));
const error = computed(() => {
  if (!startTime.value || !endTime.value)
    return 'Укажите начало и конец смены.';
  if (!isValidLocalTime(startTime.value) || !isValidLocalTime(endTime.value))
    return 'Укажите время в формате ЧЧ:ММ.';
  if (startTime.value === endTime.value)
    return 'Начало и конец смены должны различаться.';
  return null;
});
const describedBy = computed(() => (error.value ? errorId : summaryId));
function apply() {
  if (!props.canApply || !time.value) return;
  emit('apply', time.value);
}
watch(
  () => props.editingCell,
  async (cell) => {
    if (!cell) return;
    await nextTick();
    if (props.editingCell !== cell) return;
    form.value?.scrollIntoView({ block: 'nearest' });
    startInput.value?.focus({ preventScroll: true });
  },
);
</script>

<template>
  <form
    ref="form"
    class="custom-shift"
    @submit.prevent="apply"
  >
    <h3>{{ editingCell ? 'Изменить смену' : 'Своя смена' }}</h3>
    <p
      v-if="editingLabel"
      class="editing-context"
      role="status"
    >
      {{ editingLabel }}
    </p>
    <div class="time-fields">
      <label><span>Начало</span><input
        ref="startInput"
        v-model="startTime"
        type="time"
        required
        step="60"
        :aria-invalid="!!error"
        :aria-describedby="describedBy"
      ></label>
      <label><span>Конец</span><input
        v-model="endTime"
        type="time"
        required
        step="60"
        :aria-invalid="!!error"
        :aria-describedby="describedBy"
      ></label>
    </div>
    <p
      v-if="error"
      :id="errorId"
      class="time-error"
      role="alert"
    >
      {{ error }}
    </p>
    <div
      v-else-if="time"
      :id="summaryId"
      class="time-summary"
      role="status"
      aria-live="polite"
    >
      <span>Длительность: {{ formatDuration(time) }}</span>
      <span
        v-if="time.endDayOffset"
        class="overnight-note"
      >Окончание на следующий день</span>
    </div>
    <button
      class="button apply-custom"
      type="submit"
      :disabled="!canApply || !time"
    >
      <component
        :is="editingCell ? PencilIcon : PlusIcon"
        :size="17"
      />{{
        editingCell ? 'Применить изменения' : 'Поставить в выделенные'
      }}
    </button>
    <button
      v-if="editingCell"
      class="cancel-edit"
      type="button"
      @click="$emit('cancelEdit')"
    >
      Отменить редактирование
    </button>
  </form>
</template>

<style scoped>
.custom-shift {
  margin-top: 24px;
}
h3 {
  margin: 0 0 12px;
  font-size: 0.875rem;
  font-weight: 400;
}
.editing-context {
  margin: -4px 0 12px;
  color: #767b8e;
  font-size: 0.75rem;
  line-height: 1.5;
  overflow-wrap: anywhere;
}
.time-fields {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 8px;
}
label {
  display: flex;
  flex-direction: column;
  gap: 6px;
  min-width: 0;
}
label span {
  color: var(--color-muted);
  font-size: 0.75rem;
}
input {
  width: 100%;
  min-width: 0;
  height: 44px;
  padding: 8px 10px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: var(--color-field);
  color: #646979;
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
}
input[aria-invalid='true'] {
  border-color: var(--color-danger);
}
input::-webkit-calendar-picker-indicator {
  opacity: 0.4;
}
.apply-custom {
  width: 100%;
  margin-top: 8px;
  padding-inline: 4px;
  font-size: 0.8125rem;
}
.time-error {
  margin: 8px 0 0;
  color: #d3434a;
  font-size: 0.75rem;
  line-height: 1.5;
}
.time-summary {
  display: flex;
  flex-direction: column;
  gap: 3px;
  margin-top: 10px;
  color: #767b8e;
  font-size: 0.75rem;
  line-height: 1.5;
}
.overnight-note {
  color: #6378c8;
}
.cancel-edit {
  display: block;
  width: 100%;
  margin-top: 8px;
  min-height: 32px;
  padding: 4px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  color: #767b8e;
  font-size: 0.75rem;
}
.cancel-edit:hover {
  background: var(--color-field);
  color: var(--color-text);
}
</style>
