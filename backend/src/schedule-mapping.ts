import type { PublicationSummary, ScheduleCell, ShiftAssignment, ShiftTemplate } from '@time-card/shared';
import type { SchedulePublication, ShiftAssignment as StoredAssignment, ShiftTemplate as StoredTemplate } from './generated/prisma/client.js';

export function timeToMinutes(time: string): number {
  return Number(time.slice(0, 2)) * 60 + Number(time.slice(3, 5));
}

function formatTime(minutes: number): string {
  const hours = String(Math.floor(minutes / 60)).padStart(2, '0');
  return `${hours}:${String(minutes % 60).padStart(2, '0')}`;
}

export function cellKey(cell: ScheduleCell): string {
  return `${cell.employeeId}/${cell.date}`;
}

export function assignmentCell(assignment: StoredAssignment): ScheduleCell {
  return { employeeId: assignment.employeeId, date: assignment.date.toISOString().slice(0, 10) };
}

export function assignmentResponse(assignment: StoredAssignment): ShiftAssignment {
  return {
    ...assignmentCell(assignment),
    id: assignment.id,
    templateId: assignment.templateId,
    startTime: formatTime(assignment.startMinute),
    endTime: formatTime(assignment.endMinute),
    endDayOffset: assignment.endDayOffset as 0 | 1,
    color: assignment.color,
  };
}

export function templateResponse(template: StoredTemplate): ShiftTemplate {
  return {
    id: template.id,
    code: template.code,
    name: template.name,
    startTime: formatTime(template.startMinute),
    endTime: formatTime(template.endMinute),
    endDayOffset: template.endDayOffset as 0 | 1,
    color: template.color,
    sortOrder: template.sortOrder,
  };
}

export function publicationResponse(publication: SchedulePublication): PublicationSummary {
  return {
    id: publication.id,
    revision: publication.revision,
    publishedAt: publication.publishedAt.toISOString(),
  };
}
