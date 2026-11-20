import express from 'express';
import type { HealthResponse } from '@time-card/shared';
import { database } from './database.js';
import { ApiError, errorHandler } from './errors.js';
import { scheduleRouter } from './schedule-routes.js';
import { config } from './config.js';
import { installFrontend } from './frontend.js';

export const app = express();

app.disable('x-powered-by');
app.use((_request, response, next) => {
  response.set('X-Content-Type-Options', 'nosniff');
  next();
});
app.use(express.json({ limit: '1mb' }));

app.get('/api/health', async (_request, response) => {
  response.set('Cache-Control', 'no-store');

  try {
    await database.query('SELECT 1');
    const body: HealthResponse = { status: 'ok', database: 'connected' };
    response.json(body);
  } catch {
    const body: HealthResponse = { status: 'error', database: 'unavailable' };
    response.status(503).json(body);
  }
});

app.use('/api', scheduleRouter, (_request, _response, next) => {
  next(
    new ApiError(404, {
      code: 'NOT_FOUND',
      message: 'Запрошенный ресурс не найден.',
    }),
  );
});
if (config.serveFrontend) installFrontend(app);
app.use((_request, _response, next) => {
  next(
    new ApiError(404, {
      code: 'NOT_FOUND',
      message: 'Запрошенный ресурс не найден.',
    }),
  );
});
app.use(errorHandler);
