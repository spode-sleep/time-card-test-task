import { createApp } from 'vue';
import { createPinia } from 'pinia';
import App from './App.vue';
import '@fontsource-variable/inter';
import './styles.css';

createApp(App).use(createPinia()).mount('#app');

// Developer diagnostics are loaded only when explicitly requested in the URL.
if (new URLSearchParams(location.search).get('metrics') === '1') {
  void import('./performance/bootstrap').then(({ mountPerformancePanel }) =>
    mountPerformancePanel(),
  );
}
