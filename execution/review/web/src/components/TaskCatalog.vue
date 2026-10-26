<script setup lang="ts">
import { computed, ref } from 'vue';
import type { SkillCatalogItem } from '../../../../cua/contracts/types';
import { useI18n } from '../i18n';
import searchIcon from '../assets/ucd/search.svg';

const props = defineProps<{
  skills: SkillCatalogItem[];
  skillName: string;
  busy: boolean;
  currentStepCount: number;
}>();
const emit = defineEmits<{ select: [skillName: string]; create: [] }>();
const { t } = useI18n();
const query = ref('');
const visibleSkills = computed(() => {
  const needle = query.value.trim().toLocaleLowerCase();
  return props.skills.filter(item => `${item.skillName} ${item.description}`.toLocaleLowerCase().includes(needle));
});
</script>

<template>
  <aside class="task-catalog" :aria-label="t('review.catalog')">
    <label class="catalog-search"><img :src="searchIcon" alt="" /><input v-model="query" type="search" :aria-label="t('review.search')" :placeholder="t('review.search')" /></label>
    <div v-for="entry in visibleSkills" :key="entry.skillName" class="skill-entry">
      <button class="catalog-task" :class="{ active: props.skillName === entry.skillName }"
        :disabled="busy || entry.status === 'error'" :title="entry.status === 'error' ? entry.error : entry.description"
        @click="emit('select', entry.skillName)">
        <span>{{ entry.skillName }}</span><small v-if="entry.status === 'ready'">{{ t('common.steps', { count: props.skillName === entry.skillName ? currentStepCount : entry.taskCount }) }}</small>
        <small v-else>{{ t('common.unavailable') }}</small>
      </button>
      <p v-if="entry.status === 'error'" class="task-error">{{ entry.error }}</p>
    </div>
    <p v-if="!visibleSkills.length" class="catalog-note">{{ t('review.searchEmpty') }}</p>
    <button v-if="!skills.length" class="secondary catalog-create" @click="emit('create')">{{ t('review.createFromRecording') }}</button>
  </aside>
</template>

<style scoped>
.task-catalog { min-width: 0; overflow-y: auto; padding: 4px 16px 0 0; border-right: 1px solid var(--cua-color-border); }
.catalog-search { display: flex; align-items: center; gap: 8px; padding: 4px 10px; margin-bottom: 12px; border: 1px solid var(--cua-color-border); border-radius: 20px; }
.catalog-search:focus-within { border-color: var(--cua-color-primary); }
.catalog-search img { width: 16px; height: 16px; }
.catalog-search input { width: 100%; min-width: 0; padding: 0; border: 0; outline: none; background: transparent; font-size: 13px; line-height: 24px; }
.catalog-task { display: flex; width: 100%; align-items: center; justify-content: space-between; gap: 8px; margin: 2px 0; padding: 8px; border: 0; border-radius: 8px; background: transparent; text-align: left; color: var(--cua-color-text); font-size: 13px; }
.catalog-task:hover:not(:disabled), .catalog-task.active { background: var(--cua-color-bg-tertiary); }
.catalog-task > span { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.catalog-task small { flex: 0 0 auto; color: var(--cua-color-text-tertiary); font-size: 11px; }
.catalog-note { padding: 12px 4px; color: var(--cua-color-text-tertiary); font-size: 12px; line-height: 1.6; }
.catalog-create { width: 100%; margin-top: 12px; }
.task-error { font-size: 12px; overflow-wrap: anywhere; }
</style>
