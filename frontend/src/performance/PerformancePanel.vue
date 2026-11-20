<script setup lang="ts">
import { computed, ref } from 'vue';
import { usePerformanceMetrics } from './metrics';
const metrics = usePerformanceMetrics();
// Keep the initial paint free of a diagnostic panel that could become LCP.
const open = ref(false);
const names = ['LCP', 'INP', 'CLS', 'FCP', 'TTFB'] as const;
const ratings = {
  good: 'Хорошо',
  'needs-improvement': 'Улучшить',
  poor: 'Плохо',
};
const descriptions = {
  LCP: 'Крупнейший контент',
  INP: 'Отклик на ввод',
  CLS: 'Сдвиги макета',
  FCP: 'Первый контент',
  TTFB: 'Первый байт',
};
const integer = (value: number) => Math.round(value).toLocaleString('ru-RU');
const frameText = computed(() =>
  metrics.frames.value.fps === null ? '—' : integer(metrics.frames.value.fps),
);
function download() {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(metrics.snapshot(), null, 2)], {
      type: 'application/json',
    }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = 'time-card-performance.json';
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
</script>
<template>
  <aside
    class="performance-widget"
    aria-label="Диагностика производительности"
  >
    <section
      v-if="open"
      id="performance-details"
      class="performance-panel"
    >
      <h2>Производительность</h2>
      <p class="performance-note">
        Текущая вкладка ·
        {{ metrics.visible.value ? 'измерение идёт' : 'кадры на паузе' }}
      </p>
      <div class="vitals-grid">
        <div
          v-for="name in names"
          :key="name"
          class="vital"
          :class="metrics.vitals.value[name]?.rating"
        >
          <span :title="descriptions[name]">{{ name }}</span>
          <strong>{{
            metrics.vitals.value[name]
              ? name === 'CLS'
                ? metrics.vitals.value[name]!.value.toFixed(3)
                : `${integer(metrics.vitals.value[name]!.value)} мс`
              : '—'
          }}</strong>
          <small>{{
            metrics.vitals.value[name]
              ? ratings[metrics.vitals.value[name]!.rating]
              : name === 'INP'
                ? 'Нужен ввод'
                : 'Ожидание'
          }}</small>
        </div>
      </div>
      <dl class="performance-stats">
        <div>
          <dt>Строк в DOM / всего</dt>
          <dd>
            {{ metrics.dom.value.mountedRows }} /
            {{ metrics.dom.value.employees }}
          </dd>
        </div>
        <div>
          <dt>Ячеек в DOM / всего</dt>
          <dd>
            {{ integer(metrics.dom.value.mountedCells) }} /
            {{ integer(metrics.dom.value.possibleCells) }}
          </dd>
        </div>
        <div>
          <dt>Строк не отрисовано</dt>
          <dd>{{ metrics.dom.value.avoidedRowsPercent.toFixed(1) }}%</dd>
        </div>
        <div>
          <dt>FPS · окно 5 с</dt>
          <dd>{{ frameText }}</dd>
        </div>
        <div>
          <dt>Кадр p95 · окно 5 с</dt>
          <dd>
            {{
              metrics.frames.value.p95 === null
                ? '—'
                : `${metrics.frames.value.p95.toFixed(1)} мс`
            }}
          </dd>
        </div>
        <div>
          <dt>Кадры &gt;50 мс · 5 с</dt>
          <dd>{{ metrics.frames.value.slow }}</dd>
        </div>
        <div>
          <dt>Задачи &gt;50 мс</dt>
          <dd>
            {{
              metrics.longTasks.value.supported
                ? metrics.longTasks.value.count
                : 'Недоступно'
            }}
          </dd>
        </div>
        <div>
          <dt>Самая долгая задача</dt>
          <dd>
            {{
              metrics.longTasks.value.supported
                ? `${integer(metrics.longTasks.value.longestMs)} мс`
                : '—'
            }}
          </dd>
        </div>
        <div>
          <dt>Узлов DOM</dt>
          <dd>{{ integer(metrics.dom.value.totalDomNodes) }}</dd>
        </div>
        <div>
          <dt>JS · распакованный</dt>
          <dd>{{ integer(metrics.jsDecodedBytes.value / 1024) }} КиБ</dd>
        </div>
      </dl>
      <p class="performance-note">
        INP обновляется после действий. Кадры — за последние 5 с видимой
        вкладки; Web Vitals и задачи — с загрузки. Это один замер, без полевой
        статистики.
      </p>
      <button
        class="export-metrics"
        type="button"
        @click="download"
      >
        Скачать JSON
      </button>
    </section>
    <button
      class="metrics-toggle"
      type="button"
      aria-controls="performance-details"
      :aria-expanded="open"
      @click="open = !open"
    >
      {{ open ? 'Свернуть метрики' : 'Метрики' }}
    </button>
  </aside>
</template>
<style scoped>
.performance-widget {
  position: fixed;
  right: 12px;
  bottom: 12px;
  z-index: 30;
  width: min(350px, calc(100% - 24px));
  color: #edf2ff;
  font-size: 0.875rem;
}
.performance-panel {
  max-height: calc(100dvh - 80px);
  overflow: auto;
  padding: 18px;
  margin-bottom: 8px;
  border: 1px solid #384966;
  border-radius: 14px;
  background: #182234;
  box-shadow: 0 12px 40px #16213d55;
}
h2 {
  margin: 0 0 6px;
  font-size: 1rem;
}
.performance-note {
  margin: 0 0 14px;
  color: #b2bed4;
  font-size: 0.75rem;
  line-height: 1.5;
}
.vitals-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 6px;
  margin-bottom: 14px;
}
.vital {
  display: grid;
  gap: 4px;
  padding: 8px;
  border: 1px solid #445370;
  border-radius: 8px;
  font-size: 0.75rem;
}
.vital strong {
  font-size: 0.875rem;
  font-variant-numeric: tabular-nums;
}
.vital.good {
  border-color: #467c69;
}
.vital.good small {
  color: #92e2bd;
}
.vital.needs-improvement {
  border-color: #a08548;
}
.vital.needs-improvement small {
  color: #ffd28a;
}
.vital.poor {
  border-color: #b26773;
}
.vital.poor small {
  color: #ffb1b8;
}
.performance-stats {
  display: grid;
  gap: 7px;
  margin: 0 0 16px;
  font-size: 0.8125rem;
}
.performance-stats div {
  display: flex;
  justify-content: space-between;
  gap: 12px;
}
dt {
  color: #c1cce0;
}
dd {
  margin: 0;
  text-align: right;
  font-variant-numeric: tabular-nums;
}
.metrics-toggle,
.export-metrics {
  min-height: 36px;
  padding: 6px 12px;
  border: 1px solid #566d9a;
  border-radius: 8px;
  background: #263b60;
  color: white;
  font-size: 0.8125rem;
}
.metrics-toggle {
  display: block;
  margin-left: auto;
}
.export-metrics {
  width: 100%;
}
</style>
