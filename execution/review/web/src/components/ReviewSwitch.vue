<script setup lang="ts">
const props = defineProps<{ modelValue: boolean; disabled?: boolean; label: string }>();
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>();

function toggle(): void {
  if (!props.disabled) emit('update:modelValue', !props.modelValue);
}
</script>

<template>
  <button
    type="button"
    class="review-switch"
    role="switch"
    :aria-label="label"
    :aria-checked="modelValue"
    :disabled="disabled"
    @click="toggle"
  >
    <span class="switch-track" aria-hidden="true"><span class="switch-thumb"></span></span>
  </button>
</template>

<style scoped>
.review-switch { display: inline-flex; flex: 0 0 38px; align-items: center; width: 38px; height: 32px; min-height: 32px; padding: 6px 0; border: 0; border-radius: 4px; background: transparent; cursor: pointer; }
.switch-track { display: block; width: 38px; height: 20px; padding: 2px; box-sizing: border-box; border-radius: 10px; background: #a6a6a6; transition: background-color .15s ease; }
.switch-thumb { display: block; width: 16px; height: 16px; border-radius: 50%; background: #fff; box-shadow: 0 1px 3px rgba(0, 0, 0, .15); transition: transform .15s ease; }
.review-switch[aria-checked="true"] .switch-track { background: #0067d1; }
.review-switch[aria-checked="true"] .switch-thumb { transform: translateX(18px); }
.review-switch:focus-visible { outline: 2px solid #0067d1; outline-offset: 3px; }
.review-switch:disabled { opacity: .5; cursor: not-allowed; }
@media (prefers-reduced-motion: reduce) { .switch-track, .switch-thumb { transition: none; } }
</style>
