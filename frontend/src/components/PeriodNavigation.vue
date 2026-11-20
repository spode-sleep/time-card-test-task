<script setup lang="ts">
import { ChevronLeftIcon, ChevronRightIcon } from '@lucide/vue';
import type { CalendarView } from '../calendar';

defineProps<{
  label: string;
  view: CalendarView;
  canPrevious: boolean;
  canNext: boolean;
}>();
defineEmits<{ previous: []; next: []; today: [] }>();
</script>

<template>
  <nav
    class="period-navigation"
    aria-label="Период расписания"
  >
    <div class="period-arrows">
      <button
        class="icon-button"
        type="button"
        :aria-label="view === 'week' ? 'Предыдущая неделя' : 'Предыдущий месяц'"
        :disabled="!canPrevious"
        @click="$emit('previous')"
      >
        <ChevronLeftIcon :size="18" />
      </button>
      <button
        class="icon-button"
        type="button"
        :aria-label="view === 'week' ? 'Следующая неделя' : 'Следующий месяц'"
        :disabled="!canNext"
        @click="$emit('next')"
      >
        <ChevronRightIcon :size="18" />
      </button>
    </div>
    <span
      class="period-label"
      aria-live="polite"
      aria-atomic="true"
    >{{
      label
    }}</span>
    <button
      class="today-button"
      type="button"
      @click="$emit('today')"
    >
      Сегодня
    </button>
  </nav>
</template>

<style scoped>
.period-navigation {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  width: 100%;
  margin: 0 0 14px;
}
.period-arrows {
  display: flex;
  flex-shrink: 0;
  gap: 2px;
}
.period-arrows .icon-button {
  width: 32px;
  height: 32px;
  border: 1px solid #dfe1eb;
  border-radius: 8px;
}
.period-label {
  color: #646776;
  font-size: 0.8125rem;
  line-height: 1.5;
}
.today-button {
  min-height: 32px;
  padding: 5px 10px;
  border: 1px solid #dfe1eb;
  border-radius: 8px;
  background: transparent;
  color: #646776;
  font-size: 0.75rem;
}
.today-button:hover {
  background: #e7e9f1;
}
@media (max-width: 480px) {
  .period-label {
    order: -1;
    flex-basis: 100%;
  }
  .today-button {
    margin-left: auto;
  }
}
</style>
