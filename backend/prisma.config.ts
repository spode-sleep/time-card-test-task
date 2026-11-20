import { existsSync } from 'node:fs';
import { loadEnvFile } from 'node:process';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'prisma/config';

const environmentFile = fileURLToPath(new URL('../.env', import.meta.url));

if (existsSync(environmentFile)) {
  loadEnvFile(environmentFile);
}

const databaseUrl = process.env.DATABASE_URL;

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'node --import=tsx prisma/seed.ts',
  },
  // Client generation also runs during image builds, before a database is configured.
  ...(databaseUrl ? { datasource: { url: databaseUrl } } : {}),
});
