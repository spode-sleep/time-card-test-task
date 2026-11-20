<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from 'vue';
import { XIcon } from '@lucide/vue';
import type { ShiftTemplate } from '@time-card/shared';
import type { ScheduleDay } from '../calendar';
import { shiftHours } from '../calendar';

const props = defineProps<{
  day: ScheduleDay;
  anchor: HTMLElement;
  templates: ShiftTemplate[];
  employeeCount: number;
  occupiedCount: number;
}>();
const emit = defineEmits<{ close: []; apply: [templateId: string] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const position = ref({ left: '12px', top: '12px' });
const label = computed(() => `Назначить смены: ${props.day.label}`);

function place() {
  if (!dialog.value) return;
  const anchor = props.anchor.getBoundingClientRect();
  const box = dialog.value.getBoundingClientRect();
  const viewportWidth =
    document.documentElement.clientWidth || window.innerWidth;
  const viewportHeight =
    document.documentElement.clientHeight || window.innerHeight;
  position.value = {
    left: `${Math.max(12, Math.min(anchor.left, viewportWidth - box.width - 12))}px`,
    top: `${Math.max(12, Math.min(anchor.bottom + 8, viewportHeight - box.height - 12))}px`,
  };
}
function outside(event: MouseEvent) {
  const element = dialog.value;
  if (!element || event.target !== element) return;
  const box = element.getBoundingClientRect();
  if (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  )
    emit('close');
}
function keyDown(event: KeyboardEvent) {
  if (event.key === 'Tab') {
    const controls = [
      ...(dialog.value?.querySelectorAll<HTMLButtonElement>(
        'button:not(:disabled)',
      ) ?? []),
    ];
    const first = controls[0];
    const last = controls.at(-1);
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === dialog.value)
    ) {
      event.preventDefault();
      last?.focus();
    } else if (
      !event.shiftKey &&
      (document.activeElement === last ||
        document.activeElement === dialog.value)
    ) {
      event.preventDefault();
      first?.focus();
    }
    return;
  }
  if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
  const choices = [
    ...(dialog.value?.querySelectorAll<HTMLButtonElement>(
      '.template-choice:not(:disabled)',
    ) ?? []),
  ];
  if (!choices.length) return;
  event.preventDefault();
  const index = choices.findIndex(
    (button) => button === document.activeElement,
  );
  const next =
    event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? choices.length - 1
        : event.key === 'ArrowDown'
          ? (index + 1) % choices.length
          : (index <= 0 ? choices.length : index) - 1;
  choices[next]?.focus();
}
onMounted(async () => {
  dialog.value?.showModal();
  place();
  await nextTick();
  (
    dialog.value?.querySelector<HTMLButtonElement>(
      '.template-choice:not(:disabled)',
    ) ?? dialog.value?.querySelector('button')
  )?.focus();
  window.addEventListener('resize', place);
  window.addEventListener('scroll', place, true);
});
onBeforeUnmount(() => {
  window.removeEventListener('resize', place);
  window.removeEventListener('scroll', place, true);
  dialog.value?.close();
  if (props.anchor.isConnected) props.anchor.focus({ preventScroll: true });
});
</script>

<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="quick-assign"
      :style="position"
      :aria-label="label"
      @cancel.prevent="$emit('close')"
      @click="outside"
      @keydown="keyDown"
      @keydown.esc.stop.prevent="$emit('close')"
    >
      <div class="menu-heading">
        <h2>Назначить смену</h2>
        <button
          class="icon-button"
          type="button"
          aria-label="Закрыть выбор шаблона"
          @click="$emit('close')"
        >
          <XIcon :size="17" />
        </button>
      </div>
      <p class="date-label">
        {{ day.label }}
      </p>
      <p class="scope">
        Видимые сотрудники: {{ employeeCount }}
      </p>
      <p
        v-if="occupiedCount"
        class="replacement"
      >
        Существующие смены будут заменены: {{ occupiedCount }}
      </p>
      <div class="template-choices">
        <button
          v-for="template in templates"
          :key="template.id"
          class="template-choice"
          type="button"
          :style="{ '--template-color': template.color }"
          :disabled="employeeCount === 0"
          @click="$emit('apply', template.id)"
        >
          <span>{{ template.name }}</span><small>{{ template.startTime }}–{{ template.endTime }} ·
            {{
              shiftHours(
                template.startTime,
                template.endTime,
                template.endDayOffset,
              )
            }}
            ч</small>
        </button>
      </div>
      <p
        v-if="!templates.length"
        class="empty-menu"
      >
        Нет доступных шаблонов.
      </p>
    </dialog>
  </Teleport>
</template>

<style scoped>
.quick-assign {
  position: fixed;
  width: min(304px, calc(100vw - 24px));
  max-height: calc(100dvh - 24px);
  margin: 0;
  padding: 14px;
  overflow: auto;
  border: 1px solid var(--color-border);
  border-radius: 12px;
  background: white;
  color: var(--color-text);
  box-shadow: 0 12px 40px #30364b26;
}
.quick-assign::backdrop {
  background: #25262c12;
}
.menu-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}
h2 {
  margin: 0;
  font-size: 0.9375rem;
  font-weight: 500;
}
.menu-heading .icon-button {
  width: 28px;
  height: 28px;
}
.date-label {
  margin: 4px 0 10px;
  color: #767b8e;
  font-size: 0.75rem;
  line-height: 1.5;
}
.scope {
  margin: 0 0 12px;
  font-size: 0.8125rem;
}
.replacement,
.empty-menu {
  margin: 0 0 12px;
  color: #767b8e;
  font-size: 0.75rem;
  line-height: 1.5;
}
.template-choices {
  display: grid;
  gap: 6px;
}
.template-choice {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-height: 56px;
  width: 100%;
  padding: 9px 12px;
  border: 1px solid transparent;
  border-left: 3px solid var(--template-color);
  border-radius: 7px;
  background: var(--color-field);
  text-align: left;
  font-size: 0.875rem;
}
.template-choice small {
  font-size: 0.75rem;
}
.template-choice:hover:not(:disabled) {
  background: #e9edff;
}
</style>
