import { computed, ref, watch } from 'vue';
import { defineStore } from 'pinia';
import type {
  Employee,
  PublicationSummary,
  ScheduleCell,
  ScheduleRange,
  ScheduleResponse,
  ShiftAssignment,
  ShiftTemplate,
  ShiftTime,
  SaveScheduleRequest,
  SaveScheduleResponse,
  PublishScheduleResponse,
} from '@time-card/shared';
import { loadErrorMessage, mutationError, scheduleApi } from '../api/schedule';
import {
  buildChanges,
  dateRanges,
  mergeDraft,
  sameShift,
  type CellConflict,
} from '../persistence';
import { rectangleCells } from '../selection';
import {
  cellKey,
  formatHours,
  calendarDays,
  isCalendarDate,
  isValidShiftTime,
  normalizeName,
  periodLabel,
  periodRange,
  shiftAnchor,
  shiftMinutes,
  todayInTimeZone,
  type CalendarView,
} from '../calendar';

export const useScheduleStore = defineStore('schedule', () => {
  const employees = ref<Employee[]>([]);
  const templates = ref<ShiftTemplate[]>([]);
  const savedByCell = ref(new Map<string, ShiftAssignment>());
  const draftByCell = ref(new Map<string, ShiftAssignment>());
  const revision = ref<number | null>(null);
  const timeZone = ref('Europe/Moscow');
  const latestPublication = ref<PublicationSummary | null>(null);
  const loadedRange = ref<ScheduleRange | null>(null);
  const loadedDates = ref(new Set<string>());
  const loading = ref(false);
  const loaded = ref(false);
  const readOnly = ref(false);
  const loadError = ref<string | null>(null);
  const editError = ref<string | null>(null);
  const busy = ref<'save' | 'publish' | 'compare' | null>(null);
  const pendingMutation = ref<{
    kind: 'save' | 'publish';
    body: SaveScheduleRequest;
  } | null>(null);
  const persistenceError = ref<string | null>(null);
  const persistenceNotice = ref('');
  const hasConflict = ref(false);
  const comparison = ref<{
    revision: number;
    timeZone: string;
    publication: PublicationSummary | null;
    employees: Employee[];
    templates: ShiftTemplate[];
    remote: Map<string, ShiftAssignment>;
    merged: Map<string, ShiftAssignment>;
    conflicts: CellConflict[];
    dates: Set<string>;
  } | null>(null);
  const conflictChoices = ref<Record<string, 'local' | 'remote'>>({});
  const editingLocked = computed(
    () => !!busy.value || !!pendingMutation.value || hasConflict.value,
  );
  const view = ref<CalendarView>('week');
  const initialToday = todayInTimeZone(timeZone.value);
  const anchorDate = ref(initialToday);
  const query = ref('');
  const selected = ref(new Set<string>());
  const activeTemplateId = ref('');
  const startTime = ref('09:00');
  const endTime = ref('17:00');
  const editingCell = ref<ScheduleCell | null>(null);
  const formBeforeEdit = ref<{ startTime: string; endTime: string } | null>(
    null,
  );
  let hasNavigated = false;
  let initialTimeZoneResolved = false;
  let requestSequence = 0;
  let activeLoad: { key: string; promise: Promise<boolean> } | null = null;
  let referencesRequest: Promise<{
    employees: Employee[];
    templates: ShiftTemplate[];
  }> | null = null;
  const periodRequests = new Map<string, Promise<ScheduleResponse>>();

  const range = computed(() => periodRange(anchorDate.value, view.value));
  const rangeKey = computed(() => `${range.value.from}/${range.value.to}`);
  const label = computed(() => periodLabel(range.value, view.value));
  const days = computed(() => calendarDays(range.value));
  const periodReady = computed(
    () =>
      loaded.value &&
      days.value.every((day) => loadedDates.value.has(day.date)),
  );
  const canPrevious = computed(
    () => shiftAnchor(anchorDate.value, view.value, -1) !== null,
  );
  const canNext = computed(
    () => shiftAnchor(anchorDate.value, view.value, 1) !== null,
  );
  const visibleDates = computed(
    () => new Set(days.value.map((day) => day.date)),
  );
  const assignments = computed(() => [...draftByCell.value.values()]);
  const visibleAssignments = computed(() =>
    assignments.value.filter((shift) => visibleDates.value.has(shift.date)),
  );
  const coverage = computed(() => {
    const counts = new Map<string, number>();
    for (const shift of assignments.value)
      counts.set(shift.date, (counts.get(shift.date) ?? 0) + 1);
    return counts;
  });
  const visibleEmployees = computed(() => {
    const minutes = new Map<string, number>();
    for (const shift of visibleAssignments.value) {
      minutes.set(
        shift.employeeId,
        (minutes.get(shift.employeeId) ?? 0) + shiftMinutes(shift),
      );
    }
    const search = normalizeName(query.value);
    return employees.value
      .filter((employee) => normalizeName(employee.fullName).includes(search))
      .map((employee) => ({
        ...employee,
        hours: formatHours(minutes.get(employee.id) ?? 0),
      }));
  });
  const dirtyCells = computed(() => {
    const keys = new Set([
      ...savedByCell.value.keys(),
      ...draftByCell.value.keys(),
    ]);
    return new Set(
      [...keys].filter(
        (key) =>
          !sameShift(savedByCell.value.get(key), draftByCell.value.get(key)),
      ),
    );
  });
  const hasUnsavedChanges = computed(() => dirtyCells.value.size > 0);
  const selectedCells = computed<ScheduleCell[]>(() =>
    [...selected.value].map((key) => {
      const [employeeId = '', date = ''] = key.split('/');
      return { employeeId, date };
    }),
  );
  const canEditTime = computed(
    () =>
      periodReady.value &&
      !loading.value &&
      !loadError.value &&
      !editingLocked.value &&
      selectedCells.value.length === 1 &&
      draftByCell.value.has(cellKey(selectedCells.value[0]!)),
  );
  const canDeleteShifts = computed(
    () =>
      periodReady.value &&
      !loading.value &&
      !loadError.value &&
      !editingLocked.value &&
      selectedCells.value.some((cell) => draftByCell.value.has(cellKey(cell))),
  );
  const editingLabel = computed(() => {
    const cell = editingCell.value;
    if (!cell) return null;
    const employee = employees.value.find(
      (item) => item.id === cell.employeeId,
    );
    const day = days.value.find((item) => item.date === cell.date);
    return `${employee?.fullName ?? ''} · ${day?.label ?? cell.date}`;
  });

  function clearSelection() {
    cancelEditing();
    selected.value = new Set();
    editError.value = null;
  }
  watch(
    [view, rangeKey],
    () => {
      clearSelection();
      void load();
    },
    { flush: 'sync' },
  );
  watch(
    query,
    () => {
      const visibleIds = new Set(
        visibleEmployees.value.map((employee) => employee.id),
      );
      if (selectedCells.value.some((cell) => !visibleIds.has(cell.employeeId)))
        clearSelection();
    },
    { flush: 'sync' },
  );

  function getReferences() {
    if (loaded.value)
      return Promise.resolve({
        employees: employees.value,
        templates: templates.value,
      });
    if (referencesRequest) return referencesRequest;
    const pending = Promise.all([
      scheduleApi.employees(),
      scheduleApi.templates(),
    ]).then(([people, shifts]) => ({
      employees: people.employees,
      templates: shifts.templates,
    }));
    referencesRequest = pending;
    void pending.then(
      () => {
        referencesRequest = null;
      },
      () => {
        referencesRequest = null;
      },
    );
    return pending;
  }

  function getPeriod(requested: ScheduleRange) {
    const key = `${requested.from}/${requested.to}`;
    const existing = periodRequests.get(key);
    if (existing) return existing;
    const pending = scheduleApi.schedule(requested);
    periodRequests.set(key, pending);
    const remove = () => {
      if (periodRequests.get(key) === pending) periodRequests.delete(key);
    };
    void pending.then(remove, remove);
    return pending;
  }

  function mergePeriod(schedule: ScheduleResponse, reset: boolean) {
    const dirty = dirtyCells.value;
    const saved = new Map(reset ? [] : savedByCell.value);
    const draft = new Map(reset ? [] : draftByCell.value);
    const includes = (shift: ScheduleCell) =>
      shift.date >= schedule.from && shift.date <= schedule.to;
    for (const [key, shift] of saved) if (includes(shift)) saved.delete(key);
    for (const [key, shift] of draft)
      if (includes(shift) && !dirty.has(key)) draft.delete(key);
    for (const shift of schedule.assignments) {
      const key = cellKey(shift);
      saved.set(key, { ...shift });
      // A locally deleted cell is dirty too, even though it has no draft entry.
      if (!dirty.has(key)) draft.set(key, { ...shift });
    }
    const dates = new Set(reset ? [] : loadedDates.value);
    for (const day of calendarDays(schedule)) dates.add(day.date);
    savedByCell.value = saved;
    draftByCell.value = draft;
    loadedDates.value = dates;
  }

  function load(): Promise<boolean> {
    if (busy.value || pendingMutation.value) return Promise.resolve(false);
    const requested = { ...range.value };
    const key = rangeKey.value;
    if (activeLoad?.key === key) return activeLoad.promise;
    const requestId = ++requestSequence;
    if (periodReady.value) {
      activeLoad = null;
      loading.value = false;
      loadError.value = null;
      return Promise.resolve(true);
    }
    loading.value = true;
    loadError.value = null;
    const pending = Promise.resolve().then(async () => {
      try {
        const [references, schedule] = await Promise.all([
          getReferences(),
          getPeriod(requested),
        ]);
        if (requestId !== requestSequence) return false;
        if (
          !Array.isArray(references.employees) ||
          !Array.isArray(references.templates) ||
          !Array.isArray(schedule.assignments) ||
          !Number.isInteger(schedule.revision) ||
          schedule.revision < 0 ||
          typeof schedule.timeZone !== 'string' ||
          schedule.from !== requested.from ||
          schedule.to !== requested.to
        ) {
          throw new Error('Unexpected schedule response');
        }
        const employeeIds = new Set(
          references.employees.map((employee) => employee.id),
        );
        if (
          schedule.assignments.some(
            (shift) =>
              !employeeIds.has(shift.employeeId) ||
              !isCalendarDate(shift.date) ||
              shift.date < requested.from ||
              shift.date > requested.to,
          ) ||
          new Set(schedule.assignments.map(cellKey)).size !==
            schedule.assignments.length
        ) {
          throw new Error('Unexpected schedule assignments');
        }
        // Validate the server's zone before applying any part of the response.
        const organizationToday = todayInTimeZone(schedule.timeZone);
        const baseRevision = revision.value;
        const changedRevision =
          baseRevision !== null && schedule.revision !== baseRevision;
        if (
          changedRevision &&
          baseRevision !== null &&
          (schedule.revision < baseRevision || hasUnsavedChanges.value)
        ) {
          if (schedule.revision > baseRevision && hasUnsavedChanges.value)
            hasConflict.value = true;
          loadError.value =
            schedule.revision < baseRevision
              ? 'Получен устаревший ответ сервера. Повторите загрузку.'
              : 'Расписание на сервере изменилось. Черновик сохранён в этой вкладке. Можно вернуться к ранее загруженным датам.';
          return false;
        }
        if (
          loaded.value &&
          schedule.timeZone !== timeZone.value &&
          hasUnsavedChanges.value
        ) {
          hasConflict.value = true;
          loadError.value =
            'Часовой пояс расписания изменился. Черновик сохранён в этой вкладке.';
          return false;
        }
        const reset =
          changedRevision ||
          (loaded.value && schedule.timeZone !== timeZone.value);
        mergePeriod(schedule, reset);
        employees.value = references.employees;
        templates.value = references.templates;
        revision.value = schedule.revision;
        timeZone.value = schedule.timeZone;
        latestPublication.value = schedule.latestPublication;
        loadedRange.value = { from: schedule.from, to: schedule.to };
        if (
          !references.templates.some(
            (template) => template.id === activeTemplateId.value,
          )
        ) {
          activeTemplateId.value = references.templates[0]?.id ?? '';
        }
        loaded.value = true;
        readOnly.value = schedule.readOnly === true;
        clearSelection();
        if (!initialTimeZoneResolved) {
          initialTimeZoneResolved = true;
          if (
            !hasNavigated &&
            anchorDate.value === initialToday &&
            organizationToday !== anchorDate.value
          ) {
            anchorDate.value = organizationToday;
            if (rangeKey.value !== key) return await load();
          }
        }
        return true;
      } catch (error) {
        if (requestId === requestSequence)
          loadError.value = loadErrorMessage(error);
        return false;
      } finally {
        if (requestId === requestSequence) {
          loading.value = false;
          activeLoad = null;
        }
      }
    });
    activeLoad = { key, promise: pending };
    return pending;
  }

  function goToDate(date: string): Promise<boolean> {
    if (busy.value || pendingMutation.value || comparison.value)
      return Promise.resolve(false);
    if (!isCalendarDate(date)) return Promise.resolve(false);
    hasNavigated = true;
    anchorDate.value = date;
    return load();
  }
  function navigate(direction: -1 | 1): Promise<boolean> {
    const next = shiftAnchor(anchorDate.value, view.value, direction);
    return next ? goToDate(next) : Promise.resolve(false);
  }
  function goToday(): Promise<boolean> {
    return goToDate(todayInTimeZone(timeZone.value));
  }

  function rejectEdit(message: string): false {
    editError.value = message;
    return false;
  }

  function validCells(cells: ScheduleCell[]): boolean {
    if (editingLocked.value)
      return rejectEdit(
        'Завершите сохранение или сравнение версий перед редактированием.',
      );
    if (!periodReady.value || loading.value || loadError.value)
      return rejectEdit('Дождитесь загрузки расписания.');
    if (!cells.length) return rejectEdit('Выберите хотя бы одну ячейку.');
    const employeeIds = new Set(employees.value.map((employee) => employee.id));
    if (
      cells.some(
        (cell) =>
          !employeeIds.has(cell.employeeId) ||
          !loadedDates.value.has(cell.date),
      )
    ) {
      return rejectEdit(
        'Выбранная ячейка отсутствует в загруженном расписании.',
      );
    }
    return true;
  }

  function setSelection(cells: ScheduleCell[]): boolean {
    if (!cells.length) {
      clearSelection();
      return true;
    }
    if (!validCells(cells)) return false;
    const visibleIds = new Set(
      visibleEmployees.value.map((employee) => employee.id),
    );
    if (
      cells.some(
        (cell) =>
          !visibleDates.value.has(cell.date) ||
          !visibleIds.has(cell.employeeId),
      )
    ) {
      return rejectEdit('Выберите ячейки среди видимых сотрудников и дат.');
    }
    if (
      editingCell.value &&
      (cells.length !== 1 || cellKey(cells[0]!) !== cellKey(editingCell.value))
    )
      cancelEditing();
    selected.value = new Set(cells.map(cellKey));
    editError.value = null;
    return true;
  }

  function selectCell(cell: ScheduleCell, additive = false): boolean {
    if (!additive) return setSelection([cell]);
    if (!validCells([cell])) return false;
    const key = cellKey(cell);
    const next = selectedCells.value.filter((item) => cellKey(item) !== key);
    if (!selected.value.has(key)) next.push(cell);
    return setSelection(next);
  }

  function toggleCell(cell: ScheduleCell): boolean {
    return selectCell(cell, true);
  }

  function selectRectangle(
    from: ScheduleCell,
    to: ScheduleCell,
    base: ScheduleCell[] = [],
  ): boolean {
    const cells = rectangleCells(
      from,
      to,
      visibleEmployees.value.map((employee) => employee.id),
      days.value.map((day) => day.date),
    );
    if (!cells.length)
      return rejectEdit(
        'Границы выделения должны быть в видимой части расписания.',
      );
    return setSelection([...base, ...cells]);
  }

  function assign(
    cells: ScheduleCell[],
    time: ShiftTime,
    templateId: string | null,
    color: string,
  ): boolean {
    editError.value = null;
    if (!validCells(cells)) return false;
    if (!isValidShiftTime(time))
      return rejectEdit('Укажите корректные часы начала и окончания смены.');
    const next = new Map(draftByCell.value);
    for (const cell of cells) {
      const key = cellKey(cell);
      next.set(key, {
        id: next.get(key)?.id ?? crypto.randomUUID(),
        employeeId: cell.employeeId,
        date: cell.date,
        startTime: time.startTime,
        endTime: time.endTime,
        endDayOffset: time.endDayOffset,
        templateId,
        color,
      });
    }
    draftByCell.value = next;
    if (
      editingCell.value &&
      cells.some((cell) => cellKey(cell) === cellKey(editingCell.value!))
    )
      cancelEditing();
    return true;
  }

  function applyTemplate(cells: ScheduleCell[], templateId: string): boolean {
    const template = templates.value.find((item) => item.id === templateId);
    if (!template) return rejectEdit('Выберите доступный шаблон смены.');
    return assign(cells, template, template.id, template.color);
  }

  function chooseTemplate(templateId: string): boolean {
    if (editingLocked.value) return false;
    if (!templates.value.some((template) => template.id === templateId))
      return rejectEdit('Выберите доступный шаблон смены.');
    activeTemplateId.value = templateId;
    return selected.value.size
      ? applyTemplate(selectedCells.value, templateId)
      : true;
  }

  function applyDateTemplate(date: string, templateId: string): boolean {
    if (!visibleDates.value.has(date))
      return rejectEdit('Выберите дату в текущем периоде.');
    const cells = visibleEmployees.value.map((employee) => ({
      employeeId: employee.id,
      date,
    }));
    if (!applyTemplate(cells, templateId)) return false;
    activeTemplateId.value = templateId;
    return setSelection(cells);
  }

  function applyCustomShift(cells: ScheduleCell[], time: ShiftTime): boolean {
    return assign(cells, time, null, '#6172F3');
  }

  function startEditing(cell: ScheduleCell): boolean {
    if (!validCells([cell])) return false;
    const shift = draftByCell.value.get(cellKey(cell));
    if (!shift)
      return rejectEdit('В выбранной ячейке нет смены для редактирования.');
    if (!setSelection([cell])) return false;
    if (!editingCell.value)
      formBeforeEdit.value = {
        startTime: startTime.value,
        endTime: endTime.value,
      };
    editingCell.value = { ...cell };
    startTime.value = shift.startTime;
    endTime.value = shift.endTime;
    editError.value = null;
    return true;
  }

  function editSelectedShift(): boolean {
    if (!canEditTime.value)
      return rejectEdit('Выберите одну заполненную ячейку.');
    return startEditing(selectedCells.value[0]!);
  }

  function cancelEditing() {
    if (!editingCell.value) return;
    editingCell.value = null;
    if (formBeforeEdit.value) {
      startTime.value = formBeforeEdit.value.startTime;
      endTime.value = formBeforeEdit.value.endTime;
    }
    formBeforeEdit.value = null;
    editError.value = null;
  }

  function submitCustomTime(time: ShiftTime): boolean {
    if (!isValidShiftTime(time))
      return rejectEdit('Укажите корректные часы начала и окончания смены.');
    const cell = editingCell.value;
    if (!cell) return applyCustomShift(selectedCells.value, time);
    if (!validCells([cell])) return false;
    if (
      selectedCells.value.length !== 1 ||
      cellKey(selectedCells.value[0]!) !== cellKey(cell)
    ) {
      return rejectEdit(
        'Выделение изменилось. Снова выберите смену для редактирования.',
      );
    }
    const current = draftByCell.value.get(cellKey(cell));
    if (!current) return rejectEdit('В выбранной ячейке больше нет смены.');
    // Applying untouched hours preserves the original template association and color.
    if (
      current.startTime === time.startTime &&
      current.endTime === time.endTime &&
      current.endDayOffset === time.endDayOffset
    ) {
      cancelEditing();
      clearSelection();
      editError.value = null;
      return true;
    }
    const applied = applyCustomShift([cell], time);
    if (applied) clearSelection();
    return applied;
  }

  function deleteShifts(cells: ScheduleCell[]): boolean {
    editError.value = null;
    if (!validCells(cells)) return false;
    const next = new Map(draftByCell.value);
    for (const cell of cells) next.delete(cellKey(cell));
    draftByCell.value = next;
    if (
      editingCell.value &&
      cells.some((cell) => cellKey(cell) === cellKey(editingCell.value!))
    )
      cancelEditing();
    return true;
  }

  function moveShift(
    from: ScheduleCell,
    to: ScheduleCell,
    replaceExisting = false,
  ): boolean {
    editError.value = null;
    if (!validCells([from, to])) return false;
    if (cellKey(from) === cellKey(to))
      return rejectEdit('Выберите другую ячейку для переноса.');
    const shift = draftByCell.value.get(cellKey(from));
    if (!shift) return rejectEdit('В исходной ячейке нет смены.');
    if (draftByCell.value.has(cellKey(to)) && !replaceExisting) {
      return rejectEdit(
        'Целевая ячейка занята. Для переноса нужно подтвердить замену.',
      );
    }
    const next = new Map(draftByCell.value);
    next.delete(cellKey(from));
    next.set(cellKey(to), {
      ...shift,
      employeeId: to.employeeId,
      date: to.date,
    });
    draftByCell.value = next;
    if (
      editingCell.value &&
      [from, to].some((cell) => cellKey(cell) === cellKey(editingCell.value!))
    )
      cancelEditing();
    return true;
  }

  const canSave = computed(
    () =>
      loaded.value &&
      !readOnly.value &&
      !loading.value &&
      !busy.value &&
      !hasConflict.value &&
      (pendingMutation.value
        ? pendingMutation.value.kind === 'save'
        : hasUnsavedChanges.value),
  );
  const canPublish = computed(
    () =>
      loaded.value &&
      !readOnly.value &&
      !loading.value &&
      !busy.value &&
      !hasConflict.value &&
      (pendingMutation.value
        ? pendingMutation.value.kind === 'publish'
        : hasUnsavedChanges.value ||
          latestPublication.value?.revision !== revision.value),
  );
  const canApplyComparison = computed(
    () =>
      !!comparison.value &&
      comparison.value.conflicts.every(
        (item) =>
          conflictChoices.value[item.key] === 'remote' ||
          (item.localAllowed && conflictChoices.value[item.key] === 'local'),
      ),
  );
  const publicationState = computed(() =>
    !latestPublication.value
      ? 'Расписание ещё не опубликовано'
      : hasUnsavedChanges.value ||
          latestPublication.value.revision !== revision.value
        ? 'Есть неопубликованные изменения'
        : 'Текущая версия опубликована',
  );

  async function persist(kind: 'save' | 'publish'): Promise<boolean> {
    if (
      busy.value ||
      hasConflict.value ||
      !loaded.value ||
      readOnly.value ||
      loading.value ||
      revision.value === null
    )
      return false;
    if (pendingMutation.value && pendingMutation.value.kind !== kind)
      return false;
    if (!pendingMutation.value) {
      if (kind === 'save' && !hasUnsavedChanges.value) return false;
      if (
        kind === 'publish' &&
        !hasUnsavedChanges.value &&
        latestPublication.value?.revision === revision.value
      )
        return false;
      try {
        const changes = buildChanges(
          savedByCell.value,
          draftByCell.value,
          templates.value,
        );
        if (changes.length > 1000)
          throw new Error(
            'В одном сохранении допускается до 1000 изменений. Сократите черновик перед сохранением.',
          );
        pendingMutation.value = {
          kind,
          body: {
            requestId: crypto.randomUUID(),
            baseRevision: revision.value,
            changes,
          },
        };
      } catch (error) {
        persistenceError.value =
          error instanceof Error
            ? error.message
            : 'Не удалось подготовить сохранение.';
        return false;
      }
    }
    const pending = pendingMutation.value;
    busy.value = kind;
    persistenceError.value = null;
    persistenceNotice.value = '';
    cancelEditing();
    try {
      const result =
        kind === 'save'
          ? await scheduleApi.save(pending.body)
          : await scheduleApi.publish(pending.body);
      validateMutation(result, pending.body, kind);
      const saved = new Map(savedByCell.value);
      for (const cell of result.deletedCells) saved.delete(cellKey(cell));
      for (const shift of result.assignments)
        saved.set(cellKey(shift), { ...shift });
      savedByCell.value = saved;
      draftByCell.value = new Map(
        [...saved].map(([key, shift]) => [key, { ...shift }]),
      );
      revision.value = result.revision;
      if (kind === 'publish')
        latestPublication.value = {
          ...(result as PublishScheduleResponse).publication,
        };
      pendingMutation.value = null;
      clearSelection();
      persistenceNotice.value =
        kind === 'save'
          ? 'Изменения сохранены.'
          : 'Расписание сохранено и опубликовано.';
      return true;
    } catch (error) {
      const failure = mutationError(error);
      persistenceError.value = failure.message;
      if (!failure.uncertain) pendingMutation.value = null;
      if (failure.conflict) hasConflict.value = true;
      return false;
    } finally {
      busy.value = null;
    }
  }
  function validateMutation(
    result: SaveScheduleResponse,
    request: SaveScheduleRequest,
    kind: 'save' | 'publish',
  ) {
    const expected = new Set(
      request.changes.flatMap((change) =>
        change.type === 'move'
          ? [cellKey(change.from), cellKey(change.to)]
          : [cellKey(change.cell)],
      ),
    );
    if (
      result.requestId !== request.requestId ||
      result.revision !==
        request.baseRevision +
          (request.changes.length || kind === 'publish' ? 1 : 0) ||
      !Array.isArray(result.assignments) ||
      !Array.isArray(result.deletedCells)
    )
      throw new Error('Invalid mutation response');
    const keys = [
      ...result.assignments.map(cellKey),
      ...result.deletedCells.map(cellKey),
    ];
    if (
      keys.length !== expected.size ||
      new Set(keys).size !== keys.length ||
      keys.some((key) => !expected.has(key)) ||
      result.assignments.some(
        (shift) =>
          !isValidShiftTime(shift) ||
          !shift.id ||
          !/^#[0-9a-f]{6}$/i.test(shift.color),
      )
    )
      throw new Error('Invalid mutation cells');
    if (kind === 'publish') {
      const publication = (result as PublishScheduleResponse).publication;
      if (
        !publication?.id ||
        publication.revision !== result.revision ||
        !Number.isFinite(Date.parse(publication.publishedAt))
      )
        throw new Error('Invalid publication');
    }
  }
  async function compareWithServer(): Promise<boolean> {
    if (busy.value || pendingMutation.value || !loaded.value) return false;
    busy.value = 'compare';
    requestSequence++;
    activeLoad = null;
    loading.value = false;
    periodRequests.clear();
    hasConflict.value = true;
    comparison.value = null;
    persistenceError.value = null;
    cancelEditing();
    try {
      const dates = new Set([
        ...loadedDates.value,
        ...days.value.map((day) => day.date),
      ]);
      const [people, shifts, schedules] = await Promise.all([
        scheduleApi.employees(),
        scheduleApi.templates(),
        Promise.all(
          dateRanges(dates).map((requested) =>
            scheduleApi.schedule(requested).then((result) => {
              if (result.from !== requested.from || result.to !== requested.to)
                throw new Error('Invalid comparison range');
              return result;
            }),
          ),
        ),
      ]);
      const first = schedules[0];
      if (
        !first ||
        !Number.isInteger(first.revision) ||
        first.revision < (revision.value ?? 0) ||
        schedules.some(
          (item) =>
            item.revision !== first.revision ||
            item.timeZone !== first.timeZone,
        )
      )
        throw new Error('Schedule changed during comparison');
      todayInTimeZone(first.timeZone);
      const remote = new Map<string, ShiftAssignment>();
      const ids = new Set(people.employees.map((employee) => employee.id));
      for (const schedule of schedules)
        for (const shift of schedule.assignments) {
          const key = cellKey(shift);
          if (
            !ids.has(shift.employeeId) ||
            !isValidShiftTime(shift) ||
            !isCalendarDate(shift.date) ||
            shift.date < schedule.from ||
            shift.date > schedule.to ||
            remote.has(key)
          )
            throw new Error('Invalid comparison assignments');
          remote.set(key, { ...shift });
        }
      const merged = mergeDraft(
        savedByCell.value,
        draftByCell.value,
        remote,
        people.employees,
        shifts.templates,
      );
      for (const item of merged.conflicts)
        item.employeeName =
          people.employees.find(
            (employee) => employee.id === item.cell.employeeId,
          )?.fullName ??
          employees.value.find(
            (employee) => employee.id === item.cell.employeeId,
          )?.fullName ??
          item.cell.employeeId;
      comparison.value = {
        revision: first.revision,
        timeZone: first.timeZone,
        publication: first.latestPublication,
        employees: people.employees,
        templates: shifts.templates,
        remote,
        dates,
        ...merged,
      };
      conflictChoices.value = {};
      loadError.value = null;
      return true;
    } catch {
      persistenceError.value =
        'Не удалось получить согласованную версию сервера. Черновик не изменён. Повторите сравнение.';
      return false;
    } finally {
      busy.value = null;
    }
  }
  function resolveConflict(key: string, choice: 'local' | 'remote') {
    const item = comparison.value?.conflicts.find(
      (conflict) => conflict.key === key,
    );
    if (item && (choice === 'remote' || item.localAllowed))
      conflictChoices.value = { ...conflictChoices.value, [key]: choice };
  }
  function applyComparison(): boolean {
    const result = comparison.value;
    if (!result || !canApplyComparison.value || busy.value) return false;
    const draft = new Map(result.merged);
    for (const item of result.conflicts) {
      const shift =
        conflictChoices.value[item.key] === 'local' ? item.local : item.remote;
      if (shift) draft.set(item.key, { ...shift });
      else draft.delete(item.key);
    }
    employees.value = result.employees;
    templates.value = result.templates;
    if (
      !result.templates.some(
        (template) => template.id === activeTemplateId.value,
      )
    )
      activeTemplateId.value = result.templates[0]?.id ?? '';
    savedByCell.value = new Map(
      [...result.remote].map(([key, shift]) => [key, { ...shift }]),
    );
    draftByCell.value = draft;
    revision.value = result.revision;
    timeZone.value = result.timeZone;
    latestPublication.value = result.publication;
    loadedDates.value = result.dates;
    comparison.value = null;
    hasConflict.value = false;
    loadError.value = null;
    persistenceError.value = null;
    clearSelection();
    persistenceNotice.value = hasUnsavedChanges.value
      ? 'Версии объединены в черновике. Сохраните результат.'
      : 'Загружена актуальная версия. Несохранённых изменений нет.';
    return true;
  }

  return {
    readOnly,
    busy,
    pendingMutation,
    persistenceError,
    persistenceNotice,
    hasConflict,
    comparison,
    conflictChoices,
    editingLocked,
    canSave,
    canPublish,
    canApplyComparison,
    publicationState,
    save: () => persist('save'),
    publish: () => persist('publish'),
    compareWithServer,
    resolveConflict,
    applyComparison,
    closeComparison: () => {
      comparison.value = null;
    },
    employees,
    templates,
    savedByCell,
    draftByCell,
    revision,
    timeZone,
    latestPublication,
    loadedRange,
    loadedDates,
    anchorDate,
    range,
    rangeKey,
    label,
    periodReady,
    canPrevious,
    canNext,
    loading,
    loaded,
    loadError,
    editError,
    view,
    query,
    selected,
    activeTemplateId,
    startTime,
    endTime,
    editingCell,
    formBeforeEdit,
    editingLabel,
    canEditTime,
    canDeleteShifts,
    days,
    assignments,
    visibleAssignments,
    coverage,
    visibleEmployees,
    dirtyCells,
    hasUnsavedChanges,
    selectedCells,
    load,
    navigate,
    goToday,
    goToDate,
    clearSelection,
    toggleCell,
    setSelection,
    selectCell,
    selectRectangle,
    chooseTemplate,
    applyDateTemplate,
    applyTemplate,
    applyCustomShift,
    startEditing,
    editSelectedShift,
    cancelEditing,
    submitCustomTime,
    deleteShifts,
    moveShift,
  };
});
