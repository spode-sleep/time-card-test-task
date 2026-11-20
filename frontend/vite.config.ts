import { fileURLToPath } from 'node:url';
import { defineConfig, loadEnv } from 'vite';
import vue from '@vitejs/plugin-vue';

export default defineConfig(({ mode }) => {
  const rootDirectory = fileURLToPath(new URL('../', import.meta.url));
  const env = { ...loadEnv(mode, rootDirectory, ''), ...process.env };
  const port = Number(env.FRONTEND_PORT ?? 5173);

  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('FRONTEND_PORT must be an integer between 1 and 65535');
  }

  return {
    plugins: [vue()],
    envDir: rootDirectory,
    server: {
      host: '127.0.0.1',
      port,
      strictPort: true,
      proxy: {
        '/api': { target: env.BACKEND_URL ?? 'http://127.0.0.1:3000' },
      },
    },
  };
});
