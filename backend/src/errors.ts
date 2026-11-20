import type { ErrorRequestHandler } from 'express';
import type { ApiErrorResponse } from '@time-card/shared';

export class ApiError extends Error {
  readonly status: number;
  readonly body: ApiErrorResponse['error'];

  constructor(status: number, body: ApiErrorResponse['error']) {
    super(body.message);
    this.status = status;
    this.body = body;
  }
}

export const errorHandler: ErrorRequestHandler = (error: unknown, _request, response, next) => {
  if (response.headersSent) {
    next(error);
    return;
  }

  if (error instanceof ApiError) {
    response.status(error.status).json({ error: error.body } satisfies ApiErrorResponse);
    return;
  }

  if (error instanceof Error && 'type' in error) {
    if (error.type === 'entity.parse.failed') {
      response.status(400).json({
        error: { code: 'VALIDATION_ERROR', message: 'Некорректный JSON в теле запроса.' },
      } satisfies ApiErrorResponse);
      return;
    }

    if (error.type === 'entity.too.large') {
      response.status(413).json({
        error: { code: 'VALIDATION_ERROR', message: 'Размер запроса превышает 1 МБ.' },
      } satisfies ApiErrorResponse);
      return;
    }
  }

  console.error('Unhandled API error', error);
  response.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Не удалось выполнить запрос. Попробуйте ещё раз.' },
  } satisfies ApiErrorResponse);
};
