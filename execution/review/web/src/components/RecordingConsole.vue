<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import App from '../App.vue';
import backIcon from '../assets/ucd/record-back.svg';
import RecordingWorkflowView from './RecordingWorkflowView.vue';
import { api } from '../api';
import type {
  RecordingCard,
  RecordingCardInput,
  RecordingCardPage,
  RecentRecordingCard,
} from '../../../shared/recording-cards';
import RecordingCatalog from './RecordingCatalog.vue';
import RecordingCardDialog from './RecordingCardDialog.vue';
import ConfirmDialog from './ConfirmDialog.vue';
import WorkbenchIcon from './WorkbenchIcon.vue';

const home = ref(true);
const devEnabled = ref(false);
const activeMode = ref('recording');
const card = ref<RecordingCard>();
const workspaceKey = ref(0);
const result = ref<RecordingCardPage>({
  cards: [],
  total: 0,
  page: 1,
  pageSize: 16,
});
const recent = ref<RecentRecordingCard[]>([]);
const query = ref('');
const loading = ref(false);
const error = ref('');
const actionError = ref('');
const saving = ref(false);
const dialogOpen = ref(false);
const editing = ref<RecordingCard>();
const deleting = ref<RecordingCard>();
const clock = ref(Date.now());
let timer: ReturnType<typeof setInterval> | undefined;
let searchTimer: ReturnType<typeof setTimeout> | undefined;
let sequence = 0;
let navigation = 0;
const selectedId = computed(() => card.value?.id);

async function synchronize(): Promise<void> {
  try {
    await api.syncRecordingCards();
    await load();
  } catch (cause) {
    error.value = message(cause);
  }
}
async function load(page = result.value.page): Promise<void> {
  const request = ++sequence;
  loading.value = true;
  error.value = '';
  try {
    const next = await api.recordingCards(query.value, page);
    if (request !== sequence) return;
    result.value = next;
    recent.value = (await api.recentRecordingCards()).cards;
  } catch (cause) {
    if (request === sequence) error.value = message(cause);
  } finally {
    if (request === sequence) loading.value = false;
  }
}
function message(cause: unknown): string {
  return cause instanceof Error ? cause.message : String(cause);
}
function search(value: string): void {
  query.value = value;
  if (searchTimer) clearTimeout(searchTimer);
  searchTimer = setTimeout(() => void load(1), 250);
}
function setUrl(mode: string, id?: string, push = true): void {
  const url = new URL(location.href);
  url.searchParams.set('mode', mode);
  if (id) url.searchParams.set('card', id);
  else url.searchParams.delete('card');
  url.searchParams.delete('skillName');
  if (push) history.pushState(null, '', url);
  else history.replaceState(null, '', url);
}
async function openCard(target: RecordingCard, push = true): Promise<void> {
  const request = ++navigation;
  try {
    const loaded = await api.recordingCard(target.id);
    await api.visitRecordingCard(loaded.id);
    if (request !== navigation) return;
    card.value = loaded;
    activeMode.value = 'recording';
    if (push) setUrl('recording', loaded.id);
    workspaceKey.value++;
    home.value = false;
    recent.value = (await api.recentRecordingCards()).cards;
  } catch (cause) {
    error.value = message(cause);
  }
}
function navigate(mode: string): void {
  navigation++;
  card.value = undefined;
  activeMode.value = mode === 'home' ? 'recording' : mode;
  home.value = mode === 'home';
  setUrl(mode);
  workspaceKey.value++;
  if (home.value) void synchronize();
}
async function restore(): Promise<void> {
  const params = new URLSearchParams(location.search);
  const mode = params.get('mode');
  const id = params.get('card');
  if (id && mode === 'recording') {
    try {
      await openCard(await api.recordingCard(id), false);
    } catch (cause) {
      error.value = message(cause);
      home.value = true;
    }
  } else {
    card.value = undefined;
    home.value = !mode || mode === 'home';
    activeMode.value = mode ?? 'recording';
    workspaceKey.value++;
  }
}
async function showDialog(target?: RecordingCard): Promise<void> {
  try {
    editing.value = target ? await api.recordingCard(target.id) : undefined;
  } catch (cause) {
    error.value = message(cause);
    return;
  }
  actionError.value = '';
  dialogOpen.value = true;
}
async function save(input: RecordingCardInput): Promise<void> {
  saving.value = true;
  actionError.value = '';
  try {
    const next = editing.value
      ? await api.updateRecordingCard(editing.value.id, {
          ...input,
          version: editing.value.version,
        })
      : await api.createRecordingCard(input);
    dialogOpen.value = false;
    if (card.value?.id === next.id) card.value = next;
    await load(1);
    if (!editing.value) await openCard(next);
  } catch (cause) {
    actionError.value = message(cause);
  } finally {
    saving.value = false;
  }
}
async function remove(): Promise<void> {
  if (!deleting.value) return;
  saving.value = true;
  try {
    await api.deleteRecordingCard(deleting.value.id);
    deleting.value = undefined;
    await load();
  } catch (cause) {
    error.value = message(cause);
    deleting.value = undefined;
  } finally {
    saving.value = false;
  }
}
function relativeTime(value: string): string {
  const minutes = Math.max(
    0,
    Math.floor((clock.value - Date.parse(value)) / 60000),
  );
  if (minutes < 1) return '刚刚';
  if (minutes < 60) return `${minutes}分钟`;
  if (minutes < 1440) return `${Math.floor(minutes / 60)}小时`;
  return `${Math.floor(minutes / 1440)}天`;
}
onMounted(async () => {
  window.addEventListener('popstate', restore);
  timer = setInterval(() => {
    clock.value = Date.now();
  }, 30000);
  try {
    devEnabled.value =
      (await api.reviewIdentity()).devMode &&
      new URLSearchParams(location.search).get('dev') === '1';
  } catch (cause) {
    error.value = message(cause);
  }
  await synchronize();
  await restore();
});
onUnmounted(() => {
  window.removeEventListener('popstate', restore);
  if (timer) clearInterval(timer);
  if (searchTimer) clearTimeout(searchTimer);
});
</script>
<template>
  <div class="recording-console">
    <aside class="console-sidebar">
      <div class="console-brand">
        <img class="console-logo" src="/gde-claw-logo.svg" alt="" /><strong
          >GDE Claw</strong
        >
      </div>
      <nav aria-label="控制台导航">
        <button
          class="console-nav"
          :class="{
            active:
              home || activeMode === 'recording' || activeMode === 'recordings',
          }"
          @click="navigate('home')"
        >
          <WorkbenchIcon name="workflow" />流程录制
        </button>
      </nav>
      <h2 class="recent-heading">最近访问</h2>
      <div class="recent-list">
        <button
          v-for="entry in recent"
          :key="entry.id"
          :class="{ active: selectedId === entry.id }"
          :title="entry.name"
          @click="openCard(entry)"
        >
          <span>{{ entry.name }}</span
          ><time :datetime="entry.lastVisitedAt">{{
            relativeTime(entry.lastVisitedAt)
          }}</time>
        </button>
        <p v-if="!recent.length" class="recent-empty">暂无访问记录</p>
      </div>
      <nav v-if="devEnabled" class="console-secondary-nav" aria-label="工作区">

        <button
          v-if="devEnabled"
          :class="{ active: !home && activeMode === 'agent' }"
          @click="navigate('agent')"
        >
          开发调试
        </button>
      </nav>
    </aside>
    <div class="console-content">
      <div class="console-titlebar" aria-hidden="true"></div>
      <RecordingCatalog
        v-if="home"
        :result="result"
        :query="query"
        :busy="loading"
        :error="error"
        @open="openCard"
        @create="showDialog()"
        @edit="showDialog"
        @remove="deleting = $event"
        @search="search"
        @page="load"
        @retry="synchronize()"
      />
      <template v-else>
        <header v-if="card" class="console-detail-heading">
          <div>
            <button
              class="detail-back"
              aria-label="返回首页"
              @click="navigate('home')"
            ><img :src="backIcon" alt="" /></button>
            <h1>{{ card.name }}</h1>

          </div>
          <p>{{ card.description }}</p>
        </header>
        <p v-if="error" class="console-error" role="alert">{{ error }}</p>
        <RecordingWorkflowView v-if="card" :key="workspaceKey" :card="card" />
        <App v-else :key="workspaceKey" @mode-change="activeMode = $event" />
      </template>
    </div>
    <RecordingCardDialog
      :open="dialogOpen"
      :card="editing"
      :busy="saving"
      :error="actionError"
      @save="save"
      @close="dialogOpen = false"
    />
    <ConfirmDialog
      :open="!!deleting"
      title="删除流程卡片"
      message="删除卡片及其访问记录，原始录制文件和已生成技能会保留。"
      :target="deleting?.name ?? ''"
      confirm-label="删除"
      cancel-label="取消"
      :busy="saving"
      @confirm="remove"
      @cancel="deleting = undefined"
    />
  </div>
</template>
