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
}>();

const emit = defineEmits<{
  confirm: [];
  cancel: [];
}>();

const cancelButton = ref<HTMLButtonElement>();

watch(() => props.open, async (open) => {
  if (!open) return;
  await nextTick();
  cancelButton.value?.focus();
});

function cancel(): void {
  if (!props.busy) emit('cancel');
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="dialog-backdrop"
      @click.self="cancel"
      @keydown.esc.stop.prevent="cancel"
    >
      <section
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
          <button class="destructive" type="button" :disabled="busy" @click="emit('confirm')">
            {{ confirmLabel }}
          </button>
        </div>
      </section>
    </div>
  </Teleport>
</template>
