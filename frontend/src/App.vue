<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import type { ScheduleCell, ShiftTime } from '@time-card/shared';
import { storeToRefs } from 'pinia';
import { ChevronLeftIcon, MenuIcon } from '@lucide/vue';
import AppSidebar from './components/AppSidebar.vue';
import ScheduleToolbar from './components/ScheduleToolbar.vue';
import ScheduleGrid from './components/ScheduleGrid.vue';
import ShiftTemplatePanel from './components/ShiftTemplatePanel.vue';
import SelectionToolbar from './components/SelectionToolbar.vue';
import PeriodNavigation from './components/PeriodNavigation.vue';
import { useScheduleStore } from './stores/schedule';
import ScheduleComparison from './components/ScheduleComparison.vue';

const collapsed = ref(false);
const mobileMenuOpen = ref(false);
const editor = useScheduleStore();
const saveButton = ref<HTMLButtonElement | null>(null);
const calendarGrid = ref<{
  focusCell: (cell: ScheduleCell) => void;
  startMove: (cell: ScheduleCell) => void;
} | null>(null);
const { query, view, activeTemplateId, startTime, endTime } =
  storeToRefs(editor);
function closeOverlays() {
  editor.clearSelection();
  mobileMenuOpen.value = false;
}
function restoreCellFocus(cell: ScheduleCell | null) {
  if (cell) void nextTick(() => calendarGrid.value?.focusCell(cell));
}
function applyCustomTime(time: ShiftTime) {
  const cell = editor.editingCell ? { ...editor.editingCell } : null;
  if (editor.submitCustomTime(time)) restoreCellFocus(cell);
}
function cancelEdit() {
  const cell = editor.editingCell ? { ...editor.editingCell } : null;
  editor.cancelEditing();
  restoreCellFocus(cell);
}
function clearShifts() {
  const cell = editor.selectedCells[0] ?? null;
  if (editor.deleteShifts(editor.selectedCells)) restoreCellFocus(cell);
}
function moveSelectedShift() {
  const cell = editor.selectedCells[0];
  if (!editor.canEditTime || !cell) return;
  editor.cancelEditing();
  calendarGrid.value?.startMove(cell);
}
function applyReviewedVersions() {
  if (!editor.applyComparison()) return;
  void nextTick(() => {
    if (editor.canSave) saveButton.value?.focus();
    else {
      const employee = editor.visibleEmployees[0],
        day = editor.days[0];
      if (employee && day)
        calendarGrid.value?.focusCell({
          employeeId: employee.id,
          date: day.date,
        });
    }
  });
}
function warnBeforeUnload(event: BeforeUnloadEvent) {
  if (editor.hasUnsavedChanges || editor.pendingMutation || editor.busy) {
    event.preventDefault();
    event.returnValue = '';
  }
}
function publicationDate(value: string) {
  return new Intl.DateTimeFormat('ru-RU', {
    dateStyle: 'short',
    timeStyle: 'short',
    timeZone: editor.timeZone,
  }).format(new Date(value));
}
onMounted(() => {
  window.addEventListener('beforeunload', warnBeforeUnload);
  void editor.load();
});
onBeforeUnmount(() =>
  window.removeEventListener('beforeunload', warnBeforeUnload),
);
</script>

<template>
  <div
    class="app-shell"
    :class="{ 'is-collapsed': collapsed }"
    @keydown.esc="closeOverlays"
  >
    <AppSidebar
      :collapsed="collapsed"
      :mobile-open="mobileMenuOpen"
      @toggle="collapsed = !collapsed"
      @close="mobileMenuOpen = false"
    />
    <main
      id="schedule"
      class="workspace"
    >
      <div class="breadcrumb">
        <button
          id="mobile-menu-trigger"
          class="icon-button mobile-menu"
          type="button"
          aria-label="Открыть меню"
          :aria-expanded="mobileMenuOpen"
          aria-controls="app-navigation"
          @click="mobileMenuOpen = true"
        >
          <MenuIcon :size="20" />
        </button>
        <span
          class="breadcrumb-back"
          aria-hidden="true"
        ><ChevronLeftIcon :size="16" /></span>
        <span>Графики смен</span>
      </div>
      <header class="page-header">
        <div class="heading">
          <h1>График</h1>
        </div>
        <div class="page-actions">
          <button
            class="button button-secondary"
            type="button"
            :disabled="!editor.canPublish"
            title="Сохранить изменения и создать снимок всего расписания"
            @click="editor.publish()"
          >
            {{
              editor.busy === 'publish'
                ? 'Публикуем…'
                : editor.pendingMutation?.kind === 'publish'
                  ? 'Повторить публикацию'
                  : 'Опубликовать'
            }}
          </button>
          <button
            ref="saveButton"
            class="button button--primary"
            type="button"
            :disabled="!editor.canSave"
            @click="editor.save()"
          >
            {{
              editor.busy === 'save'
                ? 'Сохраняем…'
                : editor.pendingMutation?.kind === 'save'
                  ? 'Повторить сохранение'
                  : 'Сохранить'
            }}
          </button>
        </div>
        <p
          v-if="editor.hasUnsavedChanges"
          class="draft-state"
          role="status"
        >
          Есть несохранённые изменения
        </p>
      </header>
      <div
        class="persistence-state"
        aria-live="polite"
      >
        <p v-if="editor.readOnly">
          Демонстрационный режим: изменения хранятся только в этой вкладке.
        </p>
        <p v-if="editor.loaded">
          {{ editor.publicationState
          }}<span v-if="editor.latestPublication">
            · {{ publicationDate(editor.latestPublication.publishedAt) }}</span>
        </p>
        <p
          v-if="editor.persistenceNotice"
          role="status"
        >
          {{ editor.persistenceNotice }}
        </p>
        <p
          v-if="editor.persistenceError"
          role="alert"
        >
          {{ editor.persistenceError }}
        </p>
        <button
          v-if="
            (editor.hasConflict || editor.persistenceError) &&
              !editor.pendingMutation &&
              !editor.comparison
          "
          class="button"
          type="button"
          :disabled="!!editor.busy"
          @click="editor.compareWithServer()"
        >
          {{
            editor.busy === 'compare' ? 'Сравниваем…' : 'Сравнить с сервером'
          }}
        </button>
      </div>
      <ScheduleComparison
        v-if="editor.comparison"
        :conflicts="editor.comparison.conflicts"
        :choices="editor.conflictChoices"
        :ready="editor.canApplyComparison"
        :revision="editor.comparison.revision"
        :time-zone="editor.comparison.timeZone"
        @choose="editor.resolveConflict"
        @apply="applyReviewedVersions"
        @close="editor.closeComparison"
      />
      <fieldset
        class="editor-controls"
        :disabled="
          !!editor.busy || !!editor.pendingMutation || !!editor.comparison
        "
        :inert="
          !!editor.busy || !!editor.pendingMutation || !!editor.comparison
        "
      >
        <PeriodNavigation
          :label="editor.label"
          :view="view"
          :can-previous="editor.canPrevious"
          :can-next="editor.canNext"
          @previous="editor.navigate(-1)"
          @next="editor.navigate(1)"
          @today="editor.goToday()"
        />
      </fieldset>
      <fieldset
        class="editor-controls"
        :disabled="editor.editingLocked"
        :inert="editor.editingLocked"
      >
        <div
          class="schedule-layout"
          :class="{ 'is-loading': !editor.loaded }"
        >
          <section
            class="schedule-card"
            aria-label="Календарь смен"
            :aria-busy="editor.loading"
          >
            <SelectionToolbar
              v-if="editor.loaded && editor.selected.size"
              :cells="editor.selectedCells"
              :can-edit-time="editor.canEditTime"
              :can-delete-shifts="editor.canDeleteShifts"
              :can-apply-template="
                !!activeTemplateId && editor.periodReady && !editor.loading
              "
              @edit="editor.editSelectedShift()"
              @move="moveSelectedShift"
              @apply-template="
                editor.applyTemplate(editor.selectedCells, activeTemplateId)
              "
              @delete="clearShifts"
              @clear="editor.clearSelection"
            />
            <ScheduleToolbar
              v-else-if="editor.loaded"
              v-model:query="query"
              v-model:view="view"
            />
            <div
              v-if="editor.loading || (!editor.loaded && !editor.loadError)"
              class="load-state"
              role="status"
            >
              Загружаем расписание…
            </div>
            <div
              v-else-if="editor.loadError"
              class="load-state"
              role="alert"
            >
              <p>{{ editor.loadError }}</p>
              <button
                class="button"
                type="button"
                @click="editor.load()"
              >
                Повторить загрузку
              </button>
            </div>
            <template v-else>
              <p
                v-if="editor.editError"
                class="edit-error"
                role="alert"
              >
                {{ editor.editError }}
              </p>
              <ScheduleGrid
                ref="calendarGrid"
                :key="`${view}/${editor.rangeKey}`"
                :employees="editor.visibleEmployees"
                :days="editor.days"
                :assignments="editor.draftByCell"
                :coverage="editor.coverage"
                :selected="editor.selected"
                :view="view"
                :templates="editor.templates"
                :move-shift="editor.moveShift"
                @select="editor.selectCell"
                @edit="editor.startEditing($event)"
                @set-selection="editor.setSelection"
                @select-range="
                  editor.selectRectangle($event.from, $event.to, $event.base)
                "
                @quick-assign="
                  editor.applyDateTemplate($event.date, $event.templateId)
                "
              />
            </template>
          </section>
          <ShiftTemplatePanel
            v-if="editor.loaded"
            v-model:start-time="startTime"
            v-model:end-time="endTime"
            :active-template="activeTemplateId"
            :editing-cell="editor.editingCell"
            :editing-label="editor.editingLabel"
            :templates="editor.templates"
            :assignments="editor.visibleAssignments"
            :can-apply="
              editor.selected.size > 0 &&
                editor.periodReady &&
                !editor.loading &&
                !editor.loadError
            "
            @apply-custom="applyCustomTime"
            @cancel-edit="cancelEdit"
            @choose-template="editor.chooseTemplate"
          />
        </div>
      </fieldset>
    </main>
  </div>
</template>

<style scoped>
.editor-controls {
  min-width: 0;
  padding: 0;
  margin: 0;
  border: 0;
}
.editor-controls:disabled {
  opacity: 0.7;
}
.persistence-state {
  margin: 8px 0 14px;
  font-size: 0.875rem;
  color: #687189;
}
.persistence-state p {
  margin: 6px 0;
}
.persistence-state [role='alert'] {
  color: #b8424a;
}
.app-shell {
  display: grid;
  grid-template-columns: 240px minmax(0, 1fr);
  min-height: 100dvh;
}
.app-shell.is-collapsed {
  grid-template-columns: 72px minmax(0, 1fr);
}
.workspace {
  min-width: 0;
  padding: 26px 32px 36px;
}
.breadcrumb {
  display: flex;
  align-items: center;
  gap: 8px;
  min-height: 30px;
  color: #646776;
  font-size: 0.75rem;
}
.breadcrumb-back {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid #dfe1eb;
  border-radius: 50%;
}
.page-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
  margin: 22px 0 20px;
}
.heading {
  display: flex;
  align-items: baseline;
  gap: 12px;
}
h1 {
  margin: 0;
  font-size: 1.75rem;
  font-weight: 500;
  letter-spacing: -1px;
}
.page-actions {
  display: flex;
  gap: 6px;
}
.schedule-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 280px;
  align-items: stretch;
  gap: 12px;
}
.schedule-card {
  min-width: 0;
  padding: 14px 12px 12px;
  border-radius: var(--radius-card);
  background: white;
}
.mobile-menu {
  display: none;
}
.schedule-layout.is-loading {
  grid-template-columns: minmax(0, 1fr);
}
.load-state {
  display: flex;
  min-height: 330px;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  padding: 24px;
  text-align: center;
  color: #646776;
  font-size: 0.875rem;
}
.load-state p {
  margin: 0;
  max-width: 420px;
  line-height: 1.6;
}
.draft-state {
  flex-basis: 100%;
  margin: 0;
  color: #6d68a4;
  font-size: 0.75rem;
}
.edit-error {
  margin: 0 0 12px;
  color: #c43f47;
  font-size: 0.8125rem;
}
@media (max-width: 1200px) {
  .workspace {
    padding-inline: 24px;
  }
  .schedule-layout {
    grid-template-columns: minmax(0, 1fr) 250px;
  }
}
@media (max-width: 1100px) and (min-width: 851px) {
  .app-shell {
    grid-template-columns: 72px minmax(0, 1fr);
  }
}
@media (max-width: 850px) {
  .app-shell,
  .app-shell.is-collapsed {
    grid-template-columns: minmax(0, 1fr);
  }
  .workspace {
    padding: 16px;
  }
  .mobile-menu {
    display: grid;
  }
  .breadcrumb-back {
    display: none;
  }
  .schedule-layout {
    grid-template-columns: minmax(0, 1fr);
  }
}
@media (max-width: 480px) {
  .workspace {
    padding-inline: 12px;
  }
  .page-header {
    gap: 14px;
    margin-top: 18px;
  }
  .heading {
    width: 100%;
  }
  .page-actions {
    width: 100%;
  }
  .page-actions .button {
    flex: 1;
  }
}
</style>
