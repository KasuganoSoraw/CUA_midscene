<script setup lang="ts">
import workflowIcon from '../assets/ucd/workflow.svg';
import searchIcon from '../assets/ucd/search.svg';
import eventLogIcon from '../assets/ucd/event-log.svg';
import addIcon from '../assets/ucd/ic_ict_redirect_plus.svg';
import trashIcon from '../assets/ucd/trash.svg';
import gripIcon from '../assets/ucd/grip.svg';
import imageIcon from '../assets/ucd/image.svg';

withDefaults(defineProps<{ name: 'add' | 'trash' | 'grip' | 'image' | 'search' | 'event-log' | 'workflow'; size?: number }>(), { size: 16 });
const icons = { workflow: workflowIcon, search: searchIcon, 'event-log': eventLogIcon, add: addIcon, trash: trashIcon, grip: gripIcon, image: imageIcon };
</script>
<template><img :src="icons[name]" :width="size" :height="['add', 'search', 'event-log', 'workflow'].includes(name) ? size : size * 22 / 16" alt="" aria-hidden="true" /></template>
