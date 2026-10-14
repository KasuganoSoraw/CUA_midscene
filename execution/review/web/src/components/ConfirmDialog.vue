<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';

const props = defineProps<{
  open: boolean;
  title: string;
  message: string;
  target: string;
  confirmLabel: string;
  cancelLabel: string;
  busy?: boolean;
  variant?: 'danger' | 'primary';
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const cancelButton = ref<HTMLButtonElement>();
const dialog = ref<HTMLElement>();
let previousFocus: HTMLElement | undefined;

watch(() => props.open, async (open) => {
  if (!open) {
    if (previousFocus?.isConnected) previousFocus.focus();
    return;
  }
  previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : undefined;
  await nextTick();
  cancelButton.value?.focus();
});

function cancel(): void {
  if (!props.busy) emit('cancel');
}

function trapFocus(event: KeyboardEvent): void {
  const buttons = Array.from(dialog.value?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? []);
  if (!buttons.length) { event.preventDefault(); return; }
  const first = buttons[0];
  const last = buttons[buttons.length - 1];
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop"
      @click.self="cancel"
      @keydown.esc.stop.prevent="cancel"
      @keydown.tab="trapFocus"
    >
      <section
        ref="dialog"
        class="confirm-dialog"
        role="alertdialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        aria-describedby="confirm-dialog-message"
      >
        <div class="confirm-dialog-icon" aria-hidden="true">!</div>
        <div class="confirm-dialog-copy">
          <h2 id="confirm-dialog-title">{{ title }}</h2>
          <p id="confirm-dialog-message">{{ message }}</p>
          <code>{{ target }}</code>
        </div>
        <div class="confirm-dialog-actions">
          <button ref="cancelButton" class="secondary" type="button" :disabled="busy" @click="cancel">
            {{ cancelLabel }}
          </button>
          <button :class="variant === 'primary' ? 'primary' : 'destructive'" type="button" :disabled="busy" @click="emit('confirm')">
            {{ confirmLabel }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
