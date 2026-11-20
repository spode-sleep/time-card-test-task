import pg from 'pg';
import { config } from './config.js';

export const database = new pg.Pool({
  connectionString: config.databaseUrl,
  connectionTimeoutMillis: 3000,
  idleTimeoutMillis: 10_000,
  query_timeout: 3000,
  max: 5,
});

database.on('error', (error) => {
  console.error('Idle PostgreSQL connection failed', error.message);
});
