<script setup lang="ts">
import addIcon from '../assets/ucd/add.svg';
import trashIcon from '../assets/ucd/trash.svg';
import gripIcon from '../assets/ucd/grip.svg';
import imageIcon from '../assets/ucd/image.svg';
import uploadIcon from '../assets/ucd/upload-placeholder.svg';

withDefaults(defineProps<{ name: 'add' | 'trash' | 'grip' | 'image' | 'upload'; size?: number }>(), { size: 16 });
const icons = { add: addIcon, trash: trashIcon, grip: gripIcon, image: imageIcon, upload: uploadIcon };
</script>
<template><img :src="icons[name]" :width="size" :height="size" alt="" aria-hidden="true" /></template>
