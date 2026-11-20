import { createApp } from 'vue';
import PerformancePanel from './PerformancePanel.vue';
export function mountPerformancePanel() {
  const host = document.createElement('div');
  host.id = 'performance-tools';
  document.body.append(host);
  createApp(PerformancePanel).mount(host);
}
