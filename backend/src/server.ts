import { app } from './app.js';
import { config } from './config.js';
import { database } from './database.js';
import { prisma } from './prisma.js';

const server = app.listen(config.port, config.host, () => {
  console.log(`Time Card is listening at http://${config.host}:${config.port}`);
});

server.on('error', async (error) => {
  console.error('API failed to start', error.message);
  await prisma.$disconnect();
  await database.end();
  process.exitCode = 1;
});

function shutdown() {
  const timeout = setTimeout(() => process.exit(1), 5000);
  timeout.unref();

  server.close(async () => {
    await prisma.$disconnect();
    await database.end();
    clearTimeout(timeout);
  });
}

process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
