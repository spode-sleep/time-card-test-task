import axios from 'axios';
import type {
  EmployeesResponse,
  ScheduleRange,
  ScheduleResponse,
  ShiftTemplatesResponse,
  SaveScheduleRequest,
  SaveScheduleResponse,
  PublishScheduleResponse,
  ApiErrorResponse,
} from '@time-card/shared';

const http = axios.create({
  baseURL: '/api',
  timeout: 10_000,
  headers: { Accept: 'application/json' },
});

export const scheduleApi = {
  async employees(): Promise<EmployeesResponse> {
    return (await http.get<EmployeesResponse>('/employees')).data;
  },
  async templates(): Promise<ShiftTemplatesResponse> {
    return (await http.get<ShiftTemplatesResponse>('/shift-templates')).data;
  },
  async schedule(range: ScheduleRange): Promise<ScheduleResponse> {
    return (await http.get<ScheduleResponse>('/schedule', { params: range }))
      .data;
  },
  async save(body: SaveScheduleRequest): Promise<SaveScheduleResponse> {
    return (await http.post<SaveScheduleResponse>('/schedule/changes', body))
      .data;
  },
  async publish(body: SaveScheduleRequest): Promise<PublishScheduleResponse> {
    return (await http.post<PublishScheduleResponse>('/schedule/publish', body))
      .data;
  },
};

export function mutationError(error: unknown) {
  if (
    axios.isAxiosError<ApiErrorResponse>(error) &&
    error.response &&
    error.response.status >= 400 &&
    error.response.status < 500
  ) {
    const code = error.response.data?.error?.code;
    return {
      uncertain: false,
      conflict: code === 'REVISION_CONFLICT',
      message:
        code === 'REVISION_CONFLICT'
          ? 'Расписание изменилось в другой вкладке. Ваш черновик сохранён. Сравните версии.'
          : code === 'NOT_FOUND' ||
              code === 'CELL_OCCUPIED' ||
              code === 'REQUEST_ID_REUSED'
            ? 'Данные на сервере изменились. Сравните версии перед повторным сохранением.'
            : 'Сервер отклонил изменения. Проверьте черновик и попробуйте снова.',
    };
  }
  return {
    uncertain: true,
    conflict: false,
    message:
      'Ответ сервера не получен или не подтверждён. Черновик сохранён. Повторите ту же операцию, чтобы узнать её результат.',
  };
}

export function loadErrorMessage(error: unknown): string {
  if (
    axios.isAxiosError(error) &&
    (error.code === 'ECONNABORTED' || error.code === 'ETIMEDOUT')
  ) {
    return 'Сервер не ответил вовремя. Повторите загрузку.';
  }
  return 'Не удалось загрузить расписание. Проверьте соединение и попробуйте ещё раз.';
}
