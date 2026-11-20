<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, useId } from 'vue';
import type { ShiftAssignment } from '@time-card/shared';
import { formatDuration } from '../calendar';
defineProps<{
  fromLabel: string;
  toLabel: string;
  source: ShiftAssignment;
  destination: ShiftAssignment;
}>();
const emit = defineEmits<{ cancel: []; confirm: [] }>();
const dialog = ref<HTMLDialogElement | null>(null);
const cancelButton = ref<HTMLButtonElement | null>(null);
const titleId = useId();
const descriptionId = useId();
function keyDown(event: KeyboardEvent) {
  if (event.key !== 'Tab') return;
  const buttons = [
    ...(dialog.value?.querySelectorAll<HTMLButtonElement>('button') ?? []),
  ];
  if (event.shiftKey && document.activeElement === buttons[0]) {
    event.preventDefault();
    buttons.at(-1)?.focus();
  } else if (!event.shiftKey && document.activeElement === buttons.at(-1)) {
    event.preventDefault();
    buttons[0]?.focus();
  }
}
function outside(event: MouseEvent) {
  if (event.target !== dialog.value || !dialog.value) return;
  const box = dialog.value.getBoundingClientRect();
  if (
    event.clientX < box.left ||
    event.clientX > box.right ||
    event.clientY < box.top ||
    event.clientY > box.bottom
  )
    emit('cancel');
}
onMounted(() => {
  dialog.value?.showModal();
  cancelButton.value?.focus();
});
onBeforeUnmount(() => dialog.value?.close());
</script>
<template>
  <Teleport to="body">
    <dialog
      ref="dialog"
      class="move-dialog"
      :aria-labelledby="titleId"
      :aria-describedby="descriptionId"
      @cancel.prevent="$emit('cancel')"
      @keydown="keyDown"
      @keydown.esc.stop.prevent="$emit('cancel')"
      @click="outside"
    >
      <h2 :id="titleId">
        Заменить смену?
      </h2>
      <div :id="descriptionId">
        <p class="move-detail">
          {{ toLabel }}
        </p>
        <p>
          Смена {{ destination.startTime }}–{{ destination.endTime
          }}{{ destination.endDayOffset ? ' (+1 день)' : '' }} будет заменена.
        </p>
        <div class="incoming-shift">
          <strong>{{ source.startTime }}–{{ source.endTime
          }}{{ source.endDayOffset ? ' (+1 день)' : '' }} ·
            {{ formatDuration(source) }}</strong>
          <span>Откуда: {{ fromLabel }}</span>
        </div>
        <p>Исходная ячейка освободится после подтверждения.</p>
      </div>
      <div class="move-dialog-actions">
        <button
          ref="cancelButton"
          class="button"
          type="button"
          @click="$emit('cancel')"
        >
          Отмена
        </button>
        <button
          class="button button--primary"
          type="button"
          @click="$emit('confirm')"
        >
          Заменить и перенести
        </button>
      </div>
    </dialog>
  </Teleport>
</template>
<style scoped>
.move-dialog {
  width: min(440px, calc(100% - 24px));
  max-height: calc(100dvh - 24px);
  overflow: auto;
  padding: 24px;
  border: 1px solid var(--color-border);
  border-radius: 16px;
  color: var(--color-text);
  background: white;
  box-shadow: 0 20px 70px #252e6633;
  font-size: 0.875rem;
  line-height: 1.5;
}
.move-dialog::backdrop {
  background: #24294566;
}
h2 {
  margin: 0 0 16px;
  font-size: 1.125rem;
}
p {
  margin: 12px 0;
}
.move-detail {
  font-weight: 500;
}
.incoming-shift {
  display: grid;
  gap: 6px;
  padding: 12px;
  border-radius: 8px;
  background: var(--color-primary-soft);
}
.incoming-shift span {
  color: #626b87;
}
.move-dialog-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: 8px;
  margin-top: 20px;
}
@media (max-width: 420px) {
  .move-dialog {
    padding: 18px;
  }
  .move-dialog-actions .button {
    width: 100%;
  }
}
</style>
