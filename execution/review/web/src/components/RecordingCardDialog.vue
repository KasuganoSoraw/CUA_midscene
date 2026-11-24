<script setup lang="ts">
import importantIcon from '../assets/ucd/record-important.svg';
import { nextTick, ref, watch } from 'vue';
import { useI18n } from '../i18n';
import type {
  RecordingCard,
  RecordingCardInput,
} from '../../../shared/recording-cards';
const { t } = useI18n();
const props = defineProps<{
  open: boolean;
  card?: RecordingCard;
  busy: boolean;
  error: string;
}>();
const emit = defineEmits<{ save: [input: RecordingCardInput]; close: [] }>();
const dialog = ref<HTMLDialogElement>();
const name = ref('');
const description = ref('');
const nameInput = ref<HTMLInputElement>();
watch(
  () => props.open,
  async (open) => {
    if (!open) {
      dialog.value?.close();
      return;
    }
    name.value = props.card?.name ?? '';
    description.value = props.card?.description ?? '';
    await nextTick();
    dialog.value?.showModal();
    nameInput.value?.focus();
  },
);
function submit(): void {
  if (!name.value.trim() || props.busy) return;
  emit('save', {
    name: name.value.trim(),
    description: description.value.trim(),
  });
}
</script>
<template>
  <dialog
    ref="dialog"
    class="card-dialog"
    aria-labelledby="card-dialog-title"
    @cancel.prevent="!busy && emit('close')"
  >
    <form @submit.prevent="submit">
      <header>
        <h2 id="card-dialog-title">{{ card ? t('card.editCard') : t('card.create') }}</h2>
        <button
          type="button"
          :disabled="busy"
          :aria-label="t('card.cancel')"
          @click="emit('close')"
        >
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="m3 3 10 10M13 3 3 13" fill="none" stroke="currentColor" stroke-width="1" /></svg>
        </button>
      </header>
      <label
        ><span><img class="card-dialog-required" :src="importantIcon" alt="" />{{ t('card.taskName') }}</span
        ><input
          ref="nameInput"
          v-model="name"
          required
          maxlength="120"
          :placeholder="t('card.taskNamePlaceholder')"
          :disabled="busy"
      /></label>
      <label
        ><span>{{ t('card.taskDesc') }}</span
        ><textarea
          v-model="description"
          maxlength="2000"
          rows="3"
          :placeholder="t('card.taskDescPlaceholder')"
          :disabled="busy"
        ></textarea>
      </label>
      <p v-if="error" class="console-error" role="alert">{{ error }}</p>
      <footer>
        <button
          type="button"
          class="secondary"
          :disabled="busy"
          @click="emit('close')"
        >
          {{ t('card.cancel') }}</button
        ><button class="primary" :disabled="busy || !name.trim()">
          {{ busy ? t('card.saving') : t('card.confirm') }}
        </button>
      </footer>
    </form>
  </dialog>
</template>
