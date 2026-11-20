export type HealthResponse =
  | { status: 'ok'; database: 'connected' }
  | { status: 'error'; database: 'unavailable' };

export type {
  ApiErrorCode,
  ApiErrorResponse,
  CalendarDate,
  Employee,
  EmployeesResponse,
  LocalTime,
  PublicationSummary,
  PublishedScheduleSnapshot,
  PublishScheduleRequest,
  PublishScheduleResponse,
  SaveScheduleRequest,
  SaveScheduleResponse,
  ScheduleCell,
  ScheduleChange,
  ScheduleRange,
  ScheduleResponse,
  ShiftAssignment,
  ShiftTemplate,
  ShiftTemplatesResponse,
  ShiftTime,
  Timestamp,
} from './schedule.js';
export { LOCAL_TIME_PATTERN, createShiftTime, isValidLocalTime, isValidShiftTime } from './shift-time.js';
