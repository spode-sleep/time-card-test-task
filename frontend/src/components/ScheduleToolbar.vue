<script setup lang="ts">
import { SearchIcon, XIcon } from '@lucide/vue';
import type { CalendarView } from '../calendar';
const query = defineModel<string>('query', { required: true });
const view = defineModel<CalendarView>('view', { required: true });
</script>
<template>
  <div class="schedule-toolbar">
    <div class="search-field">
      <SearchIcon
        :size="17"
        :stroke-width="1.5"
        aria-hidden="true"
      />
      <input
        v-model="query"
        type="search"
        aria-label="Поиск по ФИО"
        placeholder="Поиск по ФИО"
      >
      <button
        v-if="query"
        class="icon-button clear-search"
        type="button"
        aria-label="Очистить поиск"
        @click="query = ''"
      >
        <XIcon :size="15" />
      </button>
    </div>
    <div
      class="view-switch"
      role="group"
      aria-label="Отображение расписания"
    >
      <button
        type="button"
        :aria-pressed="view === 'month'"
        @click="view = 'month'"
      >
        Месяц
      </button>
      <button
        type="button"
        :aria-pressed="view === 'week'"
        @click="view = 'week'"
      >
        Неделя
      </button>
    </div>
  </div>
</template>
<style scoped>
.schedule-toolbar {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 44px;
  margin-bottom: 16px;
}
.search-field {
  display: flex;
  align-items: center;
  gap: 8px;
  flex: 0 1 350px;
  min-width: 0;
  height: 40px;
  padding-inline: 12px 4px;
  border: 1px solid transparent;
  border-radius: var(--radius-control);
  background: var(--color-field);
  color: #a0a3b0;
}
.search-field:focus-within {
  border-color: #a7b4ff;
}
input {
  width: 100%;
  min-width: 0;
  padding: 0;
  border: 0;
  outline: 0;
  background: transparent;
  color: var(--color-text);
  font-size: 0.875rem;
}
input::placeholder {
  color: #9b9eaa;
}
input::-webkit-search-cancel-button {
  display: none;
}
.clear-search {
  width: 28px;
  height: 28px;
}
.view-switch {
  display: flex;
  flex-shrink: 0;
  width: 264px;
  padding: 3px;
  border-radius: var(--radius-control);
  background: var(--color-field);
}
.view-switch button {
  flex: 1;
  min-height: 34px;
  border: 0;
  border-radius: 6px;
  background: transparent;
  font-size: 0.875rem;
}
.view-switch button[aria-pressed='true'] {
  background: #3e3e47;
  color: white;
}
.view-switch button:hover:not([aria-pressed='true']) {
  background: #e7e8f0;
}
@media (max-width: 600px) {
  .schedule-toolbar {
    flex-wrap: wrap;
    gap: 10px;
  }
  .search-field {
    flex-basis: 100%;
  }
  .view-switch {
    width: 100%;
  }
}
</style>
