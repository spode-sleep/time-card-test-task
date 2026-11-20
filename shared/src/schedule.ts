/** Calendar date in YYYY-MM-DD format, interpreted in the schedule's time zone. */
export type CalendarDate = string;

/** Local wall-clock time in HH:mm format, with minute precision. */
export type LocalTime = string;

/** UTC timestamp in ISO 8601 format, ending in Z. */
export type Timestamp = string;

export interface Employee {
  id: string;
  fullName: string;
  position: string;
  avatarUrl: string | null;
  sortOrder: number;
}

export interface ShiftTime {
  startTime: LocalTime;
  endTime: LocalTime;
  endDayOffset: 0 | 1;
}

export interface ShiftTemplate extends ShiftTime {
  id: string;
  code: string;
  name: string;
  color: string;
  sortOrder: number;
}

export interface ScheduleCell {
  employeeId: string;
  date: CalendarDate;
}

export interface ShiftAssignment extends ScheduleCell, ShiftTime {
  id: string;
  templateId: string | null;
  color: string;
}

export interface EmployeesResponse {
  employees: Employee[];
}

export interface ShiftTemplatesResponse {
  templates: ShiftTemplate[];
}

export interface ScheduleRange {
  from: CalendarDate;
  to: CalendarDate;
}

export interface ScheduleResponse extends ScheduleRange {
  /** A fixture or preview server may allow local editing without persistence. */
  readOnly?: boolean;
  revision: number;
  timeZone: string;
  assignments: ShiftAssignment[];
  latestPublication: PublicationSummary | null;
}

export type ScheduleChange =
  | { type: 'assign-template'; cell: ScheduleCell; templateId: string }
  | { type: 'assign-custom'; cell: ScheduleCell; time: ShiftTime }
  | { type: 'delete'; cell: ScheduleCell }
  | { type: 'move'; from: ScheduleCell; to: ScheduleCell; replaceExisting: boolean };

export interface SaveScheduleRequest {
  requestId: string;
  baseRevision: number;
  changes: ScheduleChange[];
}

export interface SaveScheduleResponse {
  requestId: string;
  revision: number;
  assignments: ShiftAssignment[];
  deletedCells: ScheduleCell[];
}

export interface PublicationSummary {
  id: string;
  revision: number;
  publishedAt: Timestamp;
}

/** Complete publication, independent of later changes to employees or templates. */
export interface PublishedScheduleSnapshot {
  schemaVersion: 1;
  revision: number;
  timeZone: string;
  employees: Employee[];
  templates: ShiftTemplate[];
  assignments: ShiftAssignment[];
}

export type PublishScheduleRequest = SaveScheduleRequest;

export interface PublishScheduleResponse extends SaveScheduleResponse {
  publication: PublicationSummary;
}

export type ApiErrorCode =
  | 'VALIDATION_ERROR'
  | 'NOT_FOUND'
  | 'REVISION_CONFLICT'
  | 'REQUEST_ID_REUSED'
  | 'CELL_OCCUPIED'
  | 'INTERNAL_ERROR';

export interface ApiErrorResponse {
  error: {
    code: ApiErrorCode;
    message: string;
    details?: Record<string, string[]>;
    currentRevision?: number;
  };
}
