<script setup lang="ts">
import { computed, onUnmounted, ref, watch } from 'vue';
import type { SceneCatalogItem, TaskCatalogItem } from '../../../../cua/contracts/types';
import { api } from '../api';
import { useI18n } from '../i18n';
import searchIcon from '../assets/ucd/search.svg';

const props = defineProps<{
  scenes: SceneCatalogItem[];
  scene: string;
  task: string;
  busy: boolean;
  version: number;
  currentStepCount: number;
}>();
const emit = defineEmits<{ select: [target: { scene: string; task: string }]; create: [] }>();
const { t } = useI18n();
const query = ref('');
const expanded = ref<string[]>([props.scene]);
const catalog = ref<Record<string, TaskCatalogItem[]>>({});
const errors = ref<Record<string, string>>({});
const loading = ref(false);
let requestVersion = 0;

watch(() => [props.scenes, props.version], async () => {
  const version = ++requestVersion;
  loading.value = true;
  const entries = await Promise.all(props.scenes.filter(item => item.status === 'ready').map(async item => {
    try { return { scene: item.scene, tasks: (await api.tasks(item.scene)).tasks }; }
    catch (error) { return { scene: item.scene, tasks: [], error: error instanceof Error ? error.message : String(error) }; }
  }));
  if (version !== requestVersion) return;
  catalog.value = Object.fromEntries(entries.map(item => [item.scene, item.tasks]));
  errors.value = Object.fromEntries(entries.filter(item => item.error).map(item => [item.scene, item.error!]));
  loading.value = false;
}, { immediate: true });
watch(() => props.scene, value => { if (!expanded.value.includes(value)) expanded.value.push(value); });
onUnmounted(() => { requestVersion += 1; });

const visibleScenes = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  return props.scenes.map(item => {
    const sceneMatches = `${item.scene} ${item.title}`.toLocaleLowerCase().includes(needle);
    const tasks = (catalog.value[item.scene] ?? []).filter(task => !needle || sceneMatches
      || `${task.task} ${task.title}`.toLocaleLowerCase().includes(needle));
    return { ...item, tasks };
  }).filter(item => !needle || item.tasks.length || `${item.scene} ${item.title}`.toLocaleLowerCase().includes(needle));
});
function toggle(scene: string): void {
  expanded.value = expanded.value.includes(scene) ? expanded.value.filter(item => item !== scene) : [...expanded.value, scene];
}
</script>

<template>
  <aside class="task-catalog" :aria-label="t('review.catalog')">
    <label class="catalog-search"><img :src="searchIcon" alt="" /><input v-model="query" type="search" :aria-label="t('review.search')" :placeholder="t('review.search')" /></label>
    <p v-if="loading" class="catalog-note" role="status">{{ t('review.loading') }}</p>
    <div v-for="item in visibleScenes" :key="item.scene" class="scene-group">
      <button class="scene-heading" :aria-expanded="Boolean(query.trim()) || expanded.includes(item.scene)" @click="toggle(item.scene)">
        <span class="scene-chevron" :class="{ expanded: query.trim() || expanded.includes(item.scene) }">›</span><span :title="item.scene">{{ item.title }}</span>
      </button>
      <div v-if="query.trim() || expanded.includes(item.scene)" class="scene-tasks">
        <p v-if="item.status === 'error' || errors[item.scene]" class="task-error">{{ item.status === 'error' ? item.error : errors[item.scene] }}</p>
        <button v-for="entry in item.tasks" :key="entry.task" class="catalog-task" :class="{ active: props.scene === item.scene && props.task === entry.task }"
          :disabled="busy || entry.status === 'error'" :title="entry.status === 'error' ? entry.error : entry.task"
          @click="emit('select', { scene: item.scene, task: entry.task })">
          <span>{{ entry.title }}</span><small v-if="entry.status === 'ready'">{{ t('common.steps', { count: props.scene === item.scene && props.task === entry.task ? currentStepCount : entry.taskCount }) }}</small>
          <small v-else>{{ t('common.unavailable') }}</small>
        </button>
        <p v-if="!loading && !item.tasks.length && !errors[item.scene] && item.status === 'ready'" class="catalog-note">{{ t('review.noTasks') }}</p>
      </div>
    </div>
    <p v-if="!loading && !visibleScenes.length" class="catalog-note">{{ t('review.searchEmpty') }}</p>
    <button v-if="!loading && !Object.values(catalog).some(items => items.length)" class="secondary catalog-create" @click="emit('create')">{{ t('review.createFromRecording') }}</button>
  </aside>
</template>

<style scoped>
.task-catalog { min-width: 0; overflow-y: auto; padding: 4px 16px 0 0; border-right: 1px solid var(--cua-color-border); }
.catalog-search { display: flex; align-items: center; gap: 8px; padding: 4px 10px; margin-bottom: 12px; border: 1px solid var(--cua-color-border); border-radius: 20px; }
.catalog-search:focus-within { border-color: var(--cua-color-primary); }
.catalog-search img { width: 16px; height: 16px; }
.catalog-search input { width: 100%; min-width: 0; padding: 0; border: 0; outline: none; background: transparent; font-size: 13px; line-height: 24px; }
.scene-heading { display: flex; align-items: center; gap: 8px; width: 100%; padding: 8px 4px; border: 0; background: transparent; color: var(--cua-color-text); font-size: 13px; text-align: left; }
.scene-heading > span:last-child { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.scene-chevron { font-size: 19px; line-height: 16px; transition: transform .15s; }
.scene-chevron.expanded { transform: rotate(90deg); }
.scene-tasks { padding-left: 14px; }
.catalog-task { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px; margin: 2px 0; padding: 8px; border: 0; border-radius: 8px; background: transparent; text-align: left; color: var(--cua-color-text); font-size: 13px; }
.catalog-task:hover:not(:disabled), .catalog-task.active { background: var(--cua-color-bg-tertiary); }
.catalog-task > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.catalog-task small { flex: 0 0 auto; color: var(--cua-color-text-tertiary); font-size: 11px; }
.catalog-note { padding: 12px 4px; color: var(--cua-color-text-tertiary); font-size: 12px; line-height: 1.6; }
.catalog-create { width: 100%; margin-top: 12px; }
.task-error { font-size: 12px; overflow-wrap: anywhere; }
</style>
