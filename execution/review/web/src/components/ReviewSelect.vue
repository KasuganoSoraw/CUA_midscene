<script setup lang="ts">
import { computed, nextTick, ref, useId } from 'vue';

export interface ReviewSelectOption {
  value: string;
  label: string;
  description?: string;
  disabled?: boolean;
}

const props = withDefaults(defineProps<{
  modelValue: string;
  options: ReviewSelectOption[];
  disabled?: boolean;
  placeholder?: string;
  ariaLabel?: string;
}>(), {
  disabled: false,
  placeholder: '请选择',
  ariaLabel: '选择选项',
});

const emit = defineEmits<{
  'update:modelValue': [value: string];
  change: [value: string];
}>();

const container = ref<HTMLElement>();
const trigger = ref<HTMLButtonElement>();
const open = ref(false);
const highlighted = ref(-1);
const listboxId = `review-select-${useId()}`;
const selected = computed(() =>
  props.options.find((option) => option.value === props.modelValue),
);
const activeOptionId = computed(() =>
  open.value && highlighted.value >= 0
    ? `${listboxId}-option-${highlighted.value}`
    : undefined,
);

function enabledIndex(start: number, direction: 1 | -1): number {
  if (!props.options.length) return -1;
  for (let offset = 0; offset < props.options.length; offset += 1) {
    const index = (start + direction * offset + props.options.length) % props.options.length;
    if (!props.options[index]?.disabled) return index;
  }
  return -1;
}

function openMenu(): void {
  if (props.disabled || open.value) return;
  open.value = true;
  const selectedIndex = props.options.findIndex((option) => option.value === props.modelValue);
  highlighted.value = enabledIndex(selectedIndex >= 0 ? selectedIndex : 0, 1);
}

function closeMenu(restoreFocus = false): void {
  open.value = false;
  highlighted.value = -1;
  if (restoreFocus) void nextTick(() => trigger.value?.focus());
}

function toggleMenu(): void {
  if (open.value) closeMenu();
  else openMenu();
}

function selectOption(option: ReviewSelectOption): void {
  if (option.disabled) return;
  if (option.value !== props.modelValue) {
    emit('update:modelValue', option.value);
    emit('change', option.value);
  }
  closeMenu(true);
}

function moveHighlight(direction: 1 | -1): void {
  if (!open.value) openMenu();
  if (!open.value || !props.options.length) return;
  const start = highlighted.value < 0
    ? (direction === 1 ? 0 : props.options.length - 1)
    : highlighted.value + direction;
  highlighted.value = enabledIndex(start, direction);
}

function handleKeydown(event: KeyboardEvent): void {
  if (props.disabled) return;
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    moveHighlight(event.key === 'ArrowDown' ? 1 : -1);
    return;
  }
  if (event.key === 'Enter' || event.key === ' ') {
    event.preventDefault();
    if (!open.value) {
      openMenu();
      return;
    }
    const option = props.options[highlighted.value];
    if (option) selectOption(option);
    return;
  }
  if (event.key === 'Escape' && open.value) {
    event.preventDefault();
    closeMenu();
  }
}

function handleFocusout(event: FocusEvent): void {
  const next = event.relatedTarget;
  if (!(next instanceof Node) || !container.value?.contains(next)) closeMenu();
}
</script>

<template>
  <div ref="container" class="review-select" @focusout="handleFocusout">
    <button
      ref="trigger"
      type="button"
      class="review-select-control"
      role="combobox"
      :disabled="disabled"
      :aria-label="ariaLabel"
      :aria-expanded="open"
      aria-haspopup="listbox"
      :aria-controls="listboxId"
      :aria-activedescendant="activeOptionId"
      @click="toggleMenu"
      @keydown="handleKeydown"
    >
      <span :class="{ placeholder: !selected }">{{ selected?.label ?? placeholder }}</span>
      <span class="review-select-arrow" :class="{ open }" aria-hidden="true"></span>
    </button>
    <div v-if="open" :id="listboxId" class="review-select-options" role="listbox">
      <button
        v-for="(option, index) in options"
        :id="`${listboxId}-option-${index}`"
        :key="option.value"
        type="button"
        role="option"
        tabindex="-1"
        :disabled="option.disabled"
        :aria-selected="modelValue === option.value"
        :class="{ highlighted: highlighted === index }"
        @mouseenter="highlighted = option.disabled ? highlighted : index"
        @click="selectOption(option)"
      >
        <strong>{{ option.label }}</strong>
        <span v-if="option.description">{{ option.description }}</span>
      </button>
    </div>
  </div>
</template>
