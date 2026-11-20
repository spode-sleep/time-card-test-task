<script setup lang="ts">
import { computed, ref } from 'vue';
import type { ShiftAssignment } from '@time-card/shared';
import type { CellConflict } from '../persistence';
const props = defineProps<{
  conflicts: CellConflict[];
  choices: Record<string, 'local' | 'remote'>;
  ready: boolean;
  revision: number;
  timeZone: string;
}>();
const emit = defineEmits<{
  choose: [key: string, choice: 'local' | 'remote'];
  apply: [];
  close: [];
}>();
const page = ref(0);
const pages = computed(() =>
  Math.max(1, Math.ceil(props.conflicts.length / 20)),
);
const items = computed(() =>
  props.conflicts.slice(page.value * 20, (page.value + 1) * 20),
);
const shiftText = (shift: ShiftAssignment | undefined) =>
  shift
    ? `${shift.startTime}–${shift.endTime}${shift.endDayOffset ? ' (+1 день)' : ''}`
    : 'Нет смены';
</script>
<template>
  <section
    class="comparison"
    aria-label="Сравнение версий расписания"
  >
    <h2>Сравнение с сервером</h2>
    <p>
      Версия {{ revision }} · {{ timeZone }}. Правки в разных ячейках
      объединятся. Спорных ячеек: {{ conflicts.length }}.
    </p>
    <p>
      Выберите решения и примените их к черновику, затем сохраните результат.
    </p>
    <fieldset
      v-for="item in items"
      :key="item.key"
      class="cell-conflict"
    >
      <legend>{{ item.employeeName }} · {{ item.cell.date }}</legend>
      <p>Было: {{ shiftText(item.before) }}</p>
      <p v-if="item.note">
        {{ item.note }}
      </p>
      <label><input
        type="radio"
        :name="item.key"
        :checked="choices[item.key] === 'local'"
        :disabled="!item.localAllowed"
        @change="emit('choose', item.key, 'local')"
      >Моя версия: {{ shiftText(item.local) }}</label>
      <label><input
        type="radio"
        :name="item.key"
        :checked="choices[item.key] === 'remote'"
        @change="emit('choose', item.key, 'remote')"
      >Сервер: {{ shiftText(item.remote) }}</label>
    </fieldset>
    <div
      v-if="pages > 1"
      class="comparison-actions"
    >
      <button
        class="button"
        type="button"
        :disabled="page === 0"
        @click="page--"
      >
        Предыдущие ячейки
      </button>
      <span>{{ page + 1 }} / {{ pages }}</span>
      <button
        class="button"
        type="button"
        :disabled="page + 1 >= pages"
        @click="page++"
      >
        Следующие ячейки
      </button>
    </div>
    <div class="comparison-actions">
      <button
        class="button button--primary"
        type="button"
        :disabled="!ready"
        @click="$emit('apply')"
      >
        Применить решения к черновику
      </button>
      <button
        class="button"
        type="button"
        @click="$emit('close')"
      >
        Отложить сравнение
      </button>
    </div>
  </section>
</template>
<style scoped>
.comparison {
  padding: 18px;
  margin: 16px 0;
  border: 1px solid #c9d3fa;
  border-radius: 12px;
  background: white;
  font-size: 0.875rem;
}
h2 {
  margin: 0;
  font-size: 1.125rem;
}
.cell-conflict {
  display: grid;
  gap: 10px;
  padding: 12px;
  margin: 12px 0;
  border: 1px solid var(--color-border);
  border-radius: 8px;
}
.cell-conflict legend {
  padding: 0 5px;
  font-weight: 500;
}
.cell-conflict p {
  margin: 0;
  color: #6b7182;
}
label {
  display: flex;
  align-items: center;
  gap: 8px;
}
.comparison-actions {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 14px;
}
</style>
