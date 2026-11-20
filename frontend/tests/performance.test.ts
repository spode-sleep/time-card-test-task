// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, type App } from 'vue';
import { onLCP, type LCPMetric } from 'web-vitals';
import {
  collectDomStats,
  summarizeFrames,
  usePerformanceMetrics,
} from '../src/performance/metrics';
vi.mock('web-vitals', () => ({
  onCLS: vi.fn(),
  onINP: vi.fn(),
  onLCP: vi.fn(),
  onFCP: vi.fn(),
  onTTFB: vi.fn(),
}));
let app: App | undefined;
beforeEach(() => {
  vi.clearAllMocks();
});
afterEach(() => {
  app?.unmount();
  app = undefined;
  document.body.innerHTML = '';
  vi.unstubAllGlobals();
  vi.useRealTimers();
});
describe('performance diagnostics', () => {
  it('reports no frame data before sampling and calculates fps, frame p95 and slow frames from real intervals', () => {
    expect(summarizeFrames([])).toEqual({ fps: null, p95: null, slow: 0 });
    const summary = summarizeFrames([
      { time: 20, duration: 20 },
      { time: 40, duration: 20 },
      { time: 140, duration: 100 },
    ]);
    expect(summary.fps).toBeCloseTo((1000 * 3) / 140);
    expect(summary.p95).toBe(100);
    expect(summary.slow).toBe(1);
  });
  it('counts the complete accessible grid separately from mounted rows and cells', () => {
    document.body.innerHTML =
      '<div class="schedule-table" aria-rowcount="1002" aria-colcount="31"><div class="employee-row"><button class="shift-cell"></button></div><div class="employee-row"><button class="shift-cell"></button></div></div>';
    expect(collectDomStats()).toMatchObject({
      employees: 1000,
      days: 30,
      mountedRows: 2,
      mountedCells: 2,
      possibleCells: 30000,
      avoidedRowsPercent: 99.8,
    });
    document.body.innerHTML = '';
    expect(collectDomStats()).toMatchObject({
      employees: 0,
      possibleCells: 0,
      avoidedRowsPercent: 0,
    });
  });
  it('exports plain metric values without DOM entries, keeps missing INP pending and cleans up observers', () => {
    vi.useFakeTimers();
    vi.stubGlobal('performance', {
      now: () => 100,
      getEntriesByType: () => [],
    });
    vi.stubGlobal(
      'requestAnimationFrame',
      vi.fn(() => 1),
    );
    vi.stubGlobal('cancelAnimationFrame', vi.fn());
    let callback: PerformanceObserverCallback;
    const disconnect = vi.fn();
    vi.stubGlobal(
      'PerformanceObserver',
      class {
        static supportedEntryTypes = ['longtask'];
        constructor(handler: PerformanceObserverCallback) {
          callback = handler;
        }
        observe = vi.fn();
        disconnect = disconnect;
      },
    );
    let metrics!: ReturnType<typeof usePerformanceMetrics>;
    const host = document.createElement('div');
    document.body.append(host);
    app = createApp(
      defineComponent({
        setup() {
          metrics = usePerformanceMetrics();
          return () => null;
        },
      }),
    );
    app.mount(host);
    const report = vi.mocked(onLCP).mock.calls[0]![0];
    report({
      name: 'LCP',
      value: 1234,
      rating: 'good',
      entries: [document.body],
    } as unknown as LCPMetric);
    callback!(
      {
        getEntries: () => [{ duration: 70 }, { duration: 130 }],
      } as unknown as PerformanceObserverEntryList,
      {} as PerformanceObserver,
    );
    const snapshot = metrics.snapshot();
    expect(snapshot.vitals.LCP).toEqual({ value: 1234, rating: 'good' });
    expect(snapshot.vitals.INP).toBeUndefined();
    expect(snapshot.longTasks).toMatchObject({
      supported: true,
      count: 2,
      totalMs: 200,
      longestMs: 130,
    });
    expect(() => JSON.stringify(snapshot)).not.toThrow();
    expect(JSON.stringify(snapshot)).not.toContain('entries');
    app.unmount();
    app = undefined;
    expect(disconnect).toHaveBeenCalledOnce();
    expect(cancelAnimationFrame).toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });
});
