<script setup lang="ts">
import { nextTick, ref, watch } from 'vue';
import type {
  RecordingCard,
  RecordingCardInput,
} from '../../../shared/recording-cards';
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
        <h2 id="card-dialog-title">{{ card ? '编辑流程' : '创建任务' }}</h2>
        <button
          type="button"
          :disabled="busy"
          aria-label="关闭"
          @click="emit('close')"
        >
          ×
        </button>
      </header>
      <label
        ><span><b>*</b>任务名称</span
        ><input
          ref="nameInput"
          v-model="name"
          required
          maxlength="120"
          placeholder="请输入任务名称"
          :disabled="busy"
      /></label>
      <label
        ><span>任务描述</span
        ><textarea
          v-model="description"
          maxlength="2000"
          rows="3"
          placeholder="请输入描述"
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
          取消</button
        ><button class="primary" :disabled="busy || !name.trim()">
          {{ busy ? '保存中…' : '确认' }}
        </button>
      </footer>
    </form>
  </dialog>
</template>
