<script setup lang="ts">
import type { ScheduleDay } from '../calendar';
defineProps<{ days: ScheduleDay[]; coverage: Map<string, number> }>();
</script>
<template>
  <div
    class="coverage-row schedule-row"
    role="row"
  >
    <div
      class="coverage-label sticky-employee"
      role="rowheader"
    >
      Покрытие
    </div>
    <div
      v-for="day in days"
      :key="day.date"
      class="coverage-cell"
      :class="{ 'is-covered': (coverage.get(day.date) ?? 0) > 0 }"
      role="gridcell"
      :aria-label="`${day.label}, назначено смен ${coverage.get(day.date) ?? 0}`"
    >
      {{ coverage.get(day.date) ?? 0 }}
    </div>
  </div>
</template>
<style scoped>
.coverage-row {
  position: sticky;
  bottom: 0;
  z-index: 3;
  min-height: 36px;
  background: white;
}
.coverage-label {
  display: flex;
  align-items: center;
  padding: 8px 4px;
  background: white;
  color: var(--color-muted);
  font-size: 0.75rem;
}
.coverage-cell {
  display: grid;
  place-items: center;
  background: var(--color-danger-soft);
  color: var(--color-danger);
  font-size: 0.75rem;
  font-variant-numeric: tabular-nums;
}
.coverage-cell.is-covered {
  background: var(--color-primary-soft);
  color: #516bff;
}
</style>
