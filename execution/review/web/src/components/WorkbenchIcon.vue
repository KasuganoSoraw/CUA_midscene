<script setup lang="ts">
import addIcon from '../assets/ucd/ic_ict_redirect_plus.svg';
import trashIcon from '../assets/ucd/trash.svg';
import gripIcon from '../assets/ucd/grip.svg';
import imageIcon from '../assets/ucd/image.svg';

withDefaults(defineProps<{ name: 'add' | 'trash' | 'grip' | 'image'; size?: number }>(), { size: 16 });
const icons = { add: addIcon, trash: trashIcon, grip: gripIcon, image: imageIcon };
</script>
<template><img :src="icons[name]" :width="size" :height="size" alt="" aria-hidden="true" /></template>
