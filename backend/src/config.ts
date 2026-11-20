const port = Number(process.env.PORT ?? 3000);

if (!Number.isInteger(port) || port < 1 || port > 65535) {
  throw new Error('PORT must be an integer between 1 and 65535');
}

if (!process.env.DATABASE_URL) {
  throw new Error('DATABASE_URL is required. Copy .env.example to .env.');
}

export const config = {
  host:
    process.env.HOST ??
    process.env.IP ??
    (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1'),
  port,
  databaseUrl: process.env.DATABASE_URL,
  serveFrontend: process.env.NODE_ENV === 'production',
};
