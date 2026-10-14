<script setup lang="ts">
withDefaults(defineProps<{ name: 'add' | 'trash' | 'grip' | 'image' | 'upload'; size?: number }>(), { size: 16 });
const paths = {
  add: 'M8 2v12M2 8h12',
  trash: 'M2 4h12M6 2h4M4 4l1 10h6l1-10M7 6v5M9 6v5',
  grip: 'M5 3h.01M11 3h.01M5 8h.01M11 8h.01M5 13h.01M11 13h.01',
  image: 'M2 2h12v12H2zM2 11l4-4 3 3 2-2 3 3M10 5h.01',
  upload: 'M8 11V2M4 6l4-4 4 4M2 10v4h12v-4',
};
</script>
<template><svg :width="size" :height="size" viewBox="0 0 16 16" fill="none" stroke="currentColor" :stroke-width="name === 'grip' ? 2.6 : 1.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path :d="paths[name]" /></svg></template>
