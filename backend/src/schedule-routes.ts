import { Router } from 'express';
import { getEmployees, getSchedule, getTemplates, mutateSchedule } from './schedule-service.js';
import { parseRequest, saveScheduleSchema, scheduleRangeSchema } from './validation.js';

export const scheduleRouter = Router();

scheduleRouter.use((_request, response, next) => {
  response.set('Cache-Control', 'no-store');
  next();
});

scheduleRouter.get('/employees', async (_request, response) => {
  response.json(await getEmployees());
});

scheduleRouter.get('/shift-templates', async (_request, response) => {
  response.json(await getTemplates());
});

scheduleRouter.get('/schedule', async (request, response) => {
  const range = parseRequest(scheduleRangeSchema, request.query);
  response.json(await getSchedule(range));
});

scheduleRouter.post('/schedule/changes', async (request, response) => {
  const body = parseRequest(saveScheduleSchema, request.body);
  response.json(await mutateSchedule(body, 'save'));
});

scheduleRouter.post('/schedule/publish', async (request, response) => {
  const body = parseRequest(saveScheduleSchema, request.body);
  response.json(await mutateSchedule(body, 'publish'));
});
