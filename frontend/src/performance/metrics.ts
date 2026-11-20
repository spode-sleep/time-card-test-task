import { onBeforeUnmount, onMounted, ref } from 'vue';
import { onCLS, onFCP, onINP, onLCP, onTTFB, type Metric } from 'web-vitals';

export interface VitalReading {
  value: number;
  rating: Metric['rating'];
}
export interface FrameSample {
  time: number;
  duration: number;
}
export function summarizeFrames(samples: FrameSample[]) {
  if (!samples.length) return { fps: null, p95: null, slow: 0 };
  const durations = samples
    .map((sample) => sample.duration)
    .sort((a, b) => a - b);
  return {
    fps:
      (1000 * durations.length) /
      durations.reduce((sum, duration) => sum + duration, 0),
    p95: durations[Math.ceil(durations.length * 0.95) - 1]!,
    slow: durations.filter((duration) => duration > 50).length,
  };
}
export function collectDomStats() {
  const grid = document.querySelector('.schedule-table');
  const employees = Math.max(
    0,
    Number(grid?.getAttribute('aria-rowcount') ?? 2) - 2,
  );
  const days = Math.max(
    0,
    Number(grid?.getAttribute('aria-colcount') ?? 1) - 1,
  );
  const mountedRows = document.querySelectorAll('.employee-row').length;
  return {
    employees,
    days,
    mountedRows,
    mountedCells: document.querySelectorAll('.shift-cell').length,
    possibleCells: employees * days,
    avoidedRowsPercent: employees ? 100 * (1 - mountedRows / employees) : 0,
    totalDomNodes: document.getElementsByTagName('*').length,
  };
}
export function usePerformanceMetrics() {
  const vitals = ref<Partial<Record<Metric['name'], VitalReading>>>({});
  const dom = ref(collectDomStats());
  const frames = ref(summarizeFrames([]));
  const longTasks = ref({
    supported: false,
    count: 0,
    totalMs: 0,
    longestMs: 0,
  });
  const visible = ref(document.visibilityState === 'visible');
  const elapsedMs = ref(0);
  const jsDecodedBytes = ref(0);
  const started = performance.now();
  let observer: PerformanceObserver | undefined;
  let animation: number | undefined;
  let interval: number | undefined;
  let previousFrame = 0;
  let samples: FrameSample[] = [];
  function record(metric: Metric) {
    if (Number.isFinite(metric.value))
      vitals.value[metric.name] = {
        value: metric.value,
        rating: metric.rating,
      };
  }
  function frame(time: number) {
    if (!visible.value) return;
    if (previousFrame) samples.push({ time, duration: time - previousFrame });
    previousFrame = time;
    samples = samples
      .filter((sample) => sample.time >= time - 5000)
      .slice(-1200);
    animation = window.requestAnimationFrame(frame);
  }
  function visibility() {
    visible.value = document.visibilityState === 'visible';
    if (animation !== undefined) window.cancelAnimationFrame(animation);
    previousFrame = 0;
    samples = [];
    frames.value = summarizeFrames([]);
    if (visible.value) animation = window.requestAnimationFrame(frame);
  }
  function tick() {
    if (!visible.value) return;
    elapsedMs.value = performance.now() - started;
    dom.value = collectDomStats();
    frames.value = summarizeFrames(samples);
    jsDecodedBytes.value = (
      performance.getEntriesByType('resource') as PerformanceResourceTiming[]
    )
      .filter((entry) =>
        new URL(entry.name, location.href).pathname.endsWith('.js'),
      )
      .reduce((sum, entry) => sum + entry.decodedBodySize, 0);
  }
  function snapshot() {
    tick();
    return {
      capturedAt: new Date().toISOString(),
      scope:
        'Single local page visit; no CPU/network throttling configured by this panel',
      viewport: { width: innerWidth, height: innerHeight, devicePixelRatio },
      elapsedMs: elapsedMs.value,
      vitals: Object.fromEntries(
        Object.entries(vitals.value).map(([name, reading]) => [
          name,
          { ...reading },
        ]),
      ),
      dom: { ...dom.value },
      frames: { ...frames.value },
      longTasks: { ...longTasks.value },
      jsDecodedBytes: jsDecodedBytes.value,
    };
  }
  onMounted(() => {
    const options = { reportAllChanges: true };
    onLCP(record, options);
    onCLS(record, options);
    onINP(record, options);
    onFCP(record, options);
    onTTFB(record, options);
    if (
      typeof PerformanceObserver !== 'undefined' &&
      PerformanceObserver.supportedEntryTypes.includes('longtask')
    ) {
      observer = new PerformanceObserver((list) => {
        for (const entry of list.getEntries()) {
          longTasks.value.count++;
          longTasks.value.totalMs += entry.duration;
          longTasks.value.longestMs = Math.max(
            longTasks.value.longestMs,
            entry.duration,
          );
        }
      });
      observer.observe({ type: 'longtask', buffered: true });
      longTasks.value.supported = true;
    }
    document.addEventListener('visibilitychange', visibility);
    visibility();
    tick();
    interval = window.setInterval(tick, 1000);
  });
  onBeforeUnmount(() => {
    observer?.disconnect();
    if (animation !== undefined) window.cancelAnimationFrame(animation);
    window.clearInterval(interval);
    document.removeEventListener('visibilitychange', visibility);
  });
  return {
    vitals,
    dom,
    frames,
    longTasks,
    visible,
    elapsedMs,
    jsDecodedBytes,
    snapshot,
  };
}
