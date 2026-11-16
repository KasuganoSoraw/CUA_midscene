<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue';
import type {
  CreateRecordingSkillResult,
  RecorderDisplay,
  RecorderStatus,
  SkillGenerationStatus,
  ReviewRecording,
  ReviewRecordingCatalog,
} from '../../../shared/types';
import { api } from '../api';
import { useI18n } from '../i18n';
import { shouldDetectDisplays } from '../recording-display';
import ConfirmDialog from './ConfirmDialog.vue';
import tipIcon from '../assets/ucd/record-tip-blue.svg';
import playIcon from '../assets/ucd/record-play.svg';
import folderIcon from '../assets/ucd/record-floder.svg';
import reportIcon from '../assets/ucd/record-report.svg';
import videoIcon from '../assets/ucd/video.svg';
import logIcon from '../assets/ucd/event-log.svg';
import refreshIcon from '../assets/ucd/refresh.svg';

const { locale, t, formatDateTime } = useI18n();

const props = defineProps<{
  skillsConfigured: boolean;
  cardId?: string;
  recordingId?: string | null;
}>();

const emit = defineEmits<{
  created: [result: CreateRecordingSkillResult];
  analyze: [];
  folderError: [message: string];
}>();

const catalog = ref<ReviewRecordingCatalog>({
  configured: false,
  envName: 'CUA_RECORDINGS_ROOT',
  recordings: [],
});
const rerecord = ref(false);
const preview = ref<'video' | 'log'>();
const logPreview = ref('');
const previewDialog = ref<HTMLDialogElement>();
watch(preview, async value => {
  await nextTick();
  if (value) previewDialog.value?.showModal(); else previewDialog.value?.close();
});
async function previewAsset(kind: 'video' | 'log'): Promise<void> {
  if (!selected.value) return;
  error.value = '';
  try {
    if (kind === 'log') {
      const response = await fetch(`/api/recordings/${encodeURIComponent(selected.value.id)}/assets/log`);
      const value = await response.json();
      if (!response.ok) throw new Error(value.error);
      logPreview.value = value.text + (value.truncated ? '\n' + t('workflow.logTruncated') : '');
    }
    preview.value = kind;
  } catch (cause) { error.value = cause instanceof Error ? cause.message : String(cause); }
}
const selectedId = ref(props.recordingId ?? '');
const actionBusy = ref(false);
const generation = ref<SkillGenerationStatus>({ phase: 'idle' });
const busy = computed(() => actionBusy.value || generation.value.phase === 'running');
const opening = ref(false);
const error = ref('');
const message = ref(() => t('recording.loading'));
const recorderStatus = ref<RecorderStatus>({ phase: 'idle' });
const recorderDisplays = ref<RecorderDisplay[]>([]);
const selectedDisplayId = ref('');
const recorderBusy = ref(false);
const recorderError = ref('');
const recordingDeleteOpen = ref(false);
const clock = ref(Date.now());
let recorderPoll: ReturnType<typeof setInterval> | undefined;
let generationPolling = false;
let disposed = false;

function applyGeneration(next: SkillGenerationStatus, restoreForm = false): void {
  if (props.cardId && next.recording && next.recording !== selectedId.value) return;
  const wasRunning = generation.value.phase === 'running';
  generation.value = next;
  if (restoreForm && next.request && next.recording) {
    if (!props.cardId || next.recording === props.recordingId) selectedId.value = next.recording;
  }
  if (next.phase === 'running') message.value = () => t('recording.creating');
  else if (next.phase === 'succeeded' && next.result) {
    const result = next.result;
    message.value = () => t('recording.skillCreated', { name: result.skillName });
    if (wasRunning && !disposed) emit('created', result);
  } else if (next.phase === 'failed') message.value = () => t('recording.createFailed');
}

async function loadGeneration(restoreForm = false): Promise<void> {
  if (generationPolling) return;
  generationPolling = true;
  try {
    applyGeneration(await api.skillGeneration(), restoreForm);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    generationPolling = false;
  }
}

const selected = computed<ReviewRecording | undefined>(() =>
  catalog.value.recordings.find((item) => item.id === selectedId.value),
);
const canCreate = computed(() =>
  Boolean(selected.value?.ready && props.skillsConfigured && !busy.value),
);
const recorderCollapsed = computed(() =>
  ['arming', 'armed', 'starting', 'recording', 'stopping'].includes(recorderStatus.value.phase),
);
const canDeleteRecording = computed(() => Boolean(
  selected.value && !busy.value && !opening.value && !recorderBusy.value && !recorderCollapsed.value,
));
const canStartRecorder = computed(() => Boolean(
  selectedDisplayId.value
  && recorderStatus.value.outputRoot
  && ['idle', 'failed'].includes(recorderStatus.value.phase)
  && !recorderBusy.value,
));
const elapsedRecording = computed(() => {
  if (!recorderStatus.value.startedAt) return '00:00';
  const seconds = Math.max(0, Math.floor((clock.value - new Date(recorderStatus.value.startedAt).getTime()) / 1000));
  const minutes = Math.floor(seconds / 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds % 60).padStart(2, '0')}`;
});

const recorderPhaseLabel = computed(() => {
  if (recorderStatus.value.phase === 'arming') return t('recording.preparing');
  if (recorderStatus.value.phase === 'armed') return t('recording.armed');
  if (recorderStatus.value.phase === 'starting') return t('recording.starting');
  if (recorderStatus.value.phase === 'stopping') return t('recording.stopping');
  return t('recording.active');
});
const recorderStopLabel = computed(() => {
  if (recorderStatus.value.phase === 'stopping') return t('recording.stoppingButton');
  if (recorderStatus.value.phase === 'armed') return t('recording.cancelReady');
  return t('recording.stopNow');
});

function formatSize(size: number | undefined): string {
  if (size === undefined) return t('common.notFound');
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: string | undefined): string {
  return value ? formatDateTime(value) : t('common.unknownTime');
}

function applyCatalog(next: ReviewRecordingCatalog): void {
  catalog.value = next;
  if (!next.configured) {
    selectedId.value = '';
    message.value = () => t('recording.notConfigured', { name: next.envName });
    return;
  }
  if (!next.recordings.some((item) => item.id === selectedId.value)) {
    selectedId.value = props.cardId ? '' : next.recordings[0]?.id ?? '';
  }
  message.value = next.recordings.length
    ? () => t('recording.found', { count: next.recordings.length })
    : () => t('recording.empty');
}

async function loadRecordings(): Promise<void> {
  error.value = '';
  try {
    if (props.cardId) {
      const card = await api.recordingCard(props.cardId);
      selectedId.value = card.recordingId ?? '';
    }
    const next = await api.recordings();
    const linkedId = selectedId.value;
    applyCatalog(next);
    if (props.cardId && linkedId && !next.recordings.some(item => item.id === linkedId)) {
      error.value = t('workflow.relatedMissing', { id: linkedId });
    }
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

async function loadRecorderStatus(): Promise<void> {
  try {
    const wasActive = recorderCollapsed.value;
    const next = await api.recorderStatus();
    recorderStatus.value = next;
    if (wasActive && next.phase === 'idle') { await loadRecordings(); rerecord.value = false; }
  } catch (caught) {
    recorderError.value = caught instanceof Error ? caught.message : String(caught);
  }
}

async function refreshRecorderDisplays(): Promise<void> {
  if (recorderBusy.value || recorderCollapsed.value) return;
  recorderBusy.value = true;
  recorderError.value = '';
  try {
    const result = await api.refreshRecorderDisplays();
    recorderDisplays.value = result.displays;
    selectedDisplayId.value = result.displays.some((item) => item.id === selectedDisplayId.value)
      ? selectedDisplayId.value
      : result.displays.find((item) => item.primary)?.id ?? result.displays[0]?.id ?? '';
  } catch (caught) {
    recorderError.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    recorderBusy.value = false;
  }
}

async function startRecorder(): Promise<void> {
  if (!canStartRecorder.value) return;
  recorderBusy.value = true;
  recorderError.value = '';
  recorderStatus.value = {
    phase: 'arming',
    outputRoot: recorderStatus.value.outputRoot,
  };
  try {
    recorderStatus.value = props.cardId
      ? await api.startCardRecorder(props.cardId, { displayId: selectedDisplayId.value, language: locale.value })
      : await api.startRecorder({ displayId: selectedDisplayId.value, language: locale.value });
    clock.value = Date.now();
  } catch (caught) {
    recorderError.value = caught instanceof Error ? caught.message : String(caught);
    await loadRecorderStatus();
  } finally {
    recorderBusy.value = false;
  }
}

async function stopRecorder(): Promise<void> {
  if (recorderBusy.value || !recorderCollapsed.value) return;
  recorderBusy.value = true;
  recorderError.value = '';
  try {
    recorderStatus.value = await api.stopRecorder();
    await loadRecordings();
  } catch (caught) {
    recorderError.value = caught instanceof Error ? caught.message : String(caught);
    await loadRecorderStatus();
  } finally {
    recorderBusy.value = false;
  }
}

async function openFolder(): Promise<void> {
  if (opening.value) return;
  if (!selected.value) {
    reportFolderError(t('workflow.openFolderNotFound'));
    return;
  }
  opening.value = true;
  error.value = '';
  try {
    await api.openRecordingFolder(selected.value.id);
  } catch (caught) {
    reportFolderError(caught instanceof Error ? caught.message : String(caught));
  } finally {
    opening.value = false;
  }
}

function reportFolderError(message: string): void {
  if (props.cardId) emit('folderError', message);
  else error.value = message;
}

async function createTask(): Promise<void> {
  if (!selected.value || !canCreate.value) return;
  actionBusy.value = true;
  error.value = '';
  message.value = () => t('recording.creating');
  try {
    applyGeneration(await api.createRecordingSkill(selected.value.id, locale.value));
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
    message.value = () => t('recording.createFailed');
    await loadGeneration(true);
  } finally {
    actionBusy.value = false;
  }
}

function requestRecordingDeletion(): void {
  if (!canDeleteRecording.value) return;
  recordingDeleteOpen.value = true;
}

async function confirmRecordingDeletion(): Promise<void> {
  if (!selected.value || !canDeleteRecording.value) return;
  const recording = selected.value.id;
  actionBusy.value = true;
  error.value = '';
  try {
    await api.deleteRecording(recording);
    recordingDeleteOpen.value = false;
    await loadRecordings();
    message.value = () => t('recording.deleted', { recording });
  } catch (caught) {
    recordingDeleteOpen.value = false;
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    actionBusy.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadRecordings(), loadRecorderStatus()]);
  if (disposed) return;
  await loadGeneration(true);
  if (disposed) return;
  if (shouldDetectDisplays(recorderStatus.value.phase) && (!props.cardId || !selected.value)) await refreshRecorderDisplays();
  if (disposed) return;
  recorderPoll = setInterval(() => {
    clock.value = Date.now();
    if (recorderCollapsed.value && !recorderBusy.value) void loadRecorderStatus();
    if (generation.value.phase === 'running') void loadGeneration();
  }, 1000);
});
onUnmounted(() => {
  disposed = true;
  if (recorderPoll) clearInterval(recorderPoll);
});
</script>

<template>
  <div v-if="cardId" class="rw-root">
    <Teleport to="body"><dialog ref="previewDialog" class="asset-preview" :aria-label="preview === 'video' ? t('workflow.recordedVideo') : t('workflow.eventLog')" @cancel.prevent="preview = undefined"><button autofocus class="secondary" @click="preview = undefined">{{ t('workflow.closePreview') }}</button><video v-if="preview === 'video' && selected" controls autoplay :src="`/api/recordings/${encodeURIComponent(selected.id)}/assets/video`"></video><pre v-else>{{ logPreview }}</pre></dialog></Teleport>
    <div v-if="recorderError || error" class="console-error" role="alert">{{ recorderError || error }}</div>
    <template v-if="recorderCollapsed || rerecord || !selected">
      <div class="rw-scroll">
      <p class="workflow-warning"><img :src="tipIcon" alt="" />{{ t('workflow.greenBoxTip') }}</p>
      <div v-if="recorderCollapsed" class="workflow-live" role="status"><strong>{{ recorderStatus.phase === 'armed' ? t('workflow.armed') : t('workflow.recording') }}</strong><p>{{ t('workflow.useHotkey', { hotkey: recorderStatus.hotkey || 'Ctrl+Shift+F9' }) }} {{ elapsedRecording }}</p></div>
      <div class="workflow-screens"><button v-for="display in recorderDisplays" :key="display.id" :disabled="recorderCollapsed || recorderBusy" :class="{ selected: selectedDisplayId === display.id }" @click="selectedDisplayId = display.id"><span>{{ t('workflow.display', { index: display.index + 1 }) }} <em v-if="display.primary">{{ t('workflow.primary') }}</em><small>{{ display.width }}×{{ display.height }} / {{ display.deviceName }}</small></span><img :src="display.previewUrl" :alt="t('workflow.display', { index: display.index + 1 })" /></button></div>
      <p v-if="!recorderDisplays.length" class="catalog-feedback">{{ recorderBusy ? t('workflow.detecting') : t('workflow.noScreens') }}</p>
      </div>
      <div class="workflow-footer"><button v-if="rerecord && !recorderCollapsed" class="secondary" @click="rerecord = false">{{ t('workflow.backToResult') }}</button><button v-if="!recorderCollapsed" class="secondary" :disabled="recorderBusy" @click="refreshRecorderDisplays">{{ t('workflow.detectScreens') }}</button><button v-if="!recorderCollapsed" class="primary" :disabled="!canStartRecorder" @click="startRecorder">{{ t('workflow.prepareRecord') }}</button><button v-else class="secondary" :disabled="recorderBusy || recorderStatus.phase === 'arming' || recorderStatus.phase === 'stopping'" @click="stopRecorder">{{ recorderStatus.phase === 'armed' ? t('workflow.cancelPrepare') : t('workflow.endRecord') }}</button></div>
    </template>
    <template v-else>
      <div class="rw-scroll">
      <div class="workflow-recording-assets">
      <h2 class="workflow-asset-label">{{ t('workflow.recordedVideo') }}</h2><div class="workflow-asset"><img :src="videoIcon" alt="" /><span><strong>{{ selected.video?.name ?? t('workflow.videoMissing') }}</strong><small>{{ formatSize(selected.video?.size) }}　{{ selected.screen?.width }}×{{ selected.screen?.height }}</small></span><span class="asset-open"><button class="workflow-asset-action" :aria-label="t('workflow.play')" :title="t('workflow.play')" @click="previewAsset('video')"><img :src="playIcon" alt="" /></button><button class="workflow-asset-action" :disabled="opening" :aria-busy="opening" :aria-label="t('workflow.openFolder')" :title="opening ? t('workflow.openingFolder') : t('workflow.openFolder')" @click="openFolder"><img :src="folderIcon" class="workflow-folder-icon" alt="" /></button></span></div>
      <h2 class="workflow-asset-label">{{ t('workflow.eventLog') }}</h2><div class="workflow-asset"><img :src="logIcon" alt="" /><span><strong>{{ selected.eventLog?.name ?? t('workflow.logMissing') }}</strong><small>{{ formatSize(selected.eventLog?.size) }}</small></span><span class="asset-open"><button class="workflow-asset-action" :aria-label="t('workflow.viewLog')" :title="t('workflow.viewLog')" @click="previewAsset('log')"><img :src="reportIcon" alt="" /></button><button class="workflow-asset-action" :disabled="opening" :aria-busy="opening" :aria-label="t('workflow.openFolder')" :title="opening ? t('workflow.openingFolder') : t('workflow.openFolder')" @click="openFolder"><img :src="folderIcon" class="workflow-folder-icon" alt="" /></button></span></div>
      </div>
      <p v-for="problem in selected.errors" :key="problem" class="console-error">{{ problem }}</p>
      </div>
      <div class="workflow-footer"><button class="secondary" @click="rerecord = true; refreshRecorderDisplays()">{{ t('workflow.reRecord') }}</button><button class="primary" :disabled="!selected.ready" @click="emit('analyze')">{{ t('workflow.step3') }}</button></div>
    </template>
  </div>
  <template v-else>
  <section class="panel recorder-control" :class="{ collapsed: recorderCollapsed }">
    <template v-if="recorderCollapsed">
      <span class="recorder-live-dot" :class="{ armed: recorderStatus.phase === 'armed' || recorderStatus.phase === 'arming' }"></span>
      <div class="recorder-live-copy">
        <strong>{{ recorderPhaseLabel }}</strong>
        <small v-if="recorderStatus.phase === 'armed'">{{ t('recording.switchAndStart', { hotkey: recorderStatus.hotkey || 'Ctrl+Shift+F9' }) }}</small>
        <small v-else-if="recorderStatus.phase === 'recording'">{{ t('recording.stopHint', { id: recorderStatus.recordingId || '', elapsed: elapsedRecording, hotkey: recorderStatus.hotkey || 'Ctrl+Shift+F9' }) }}</small>
        <small v-else>{{ recorderStatus.recordingId || t('recording.registeringHotkey') }}</small>
      </div>
      <button class="destructive recorder-stop" type="button"
        :disabled="recorderBusy || recorderStatus.phase === 'arming' || recorderStatus.phase === 'stopping'"
        @click="stopRecorder">{{ recorderStopLabel }}</button>
    </template>
    <template v-else>
      <div class="recorder-heading">
        <div class="recorder-heading-copy">
          <h2>{{ t('recording.new') }}</h2>
          <p>{{ t('recording.newHelp') }}</p>
        </div>
        <div class="recorder-heading-actions">
          <button class="secondary" type="button" :disabled="recorderBusy" @click="refreshRecorderDisplays">{{ recorderBusy ? t('recording.detecting') : t('recording.detectAgain') }}</button>
          <button class="primary" type="button" :disabled="!canStartRecorder" @click="startRecorder">{{ t('recording.prepare') }}</button>
        </div>
      </div>
      <div v-if="recorderDisplays.length" class="recorder-displays">
        <button v-for="display in recorderDisplays" :key="display.id" type="button"
          class="recorder-display" :class="{ selected: selectedDisplayId === display.id }"
          :aria-pressed="selectedDisplayId === display.id" :disabled="recorderBusy" @click="selectedDisplayId = display.id">
          <img :src="display.previewUrl" :alt="t('recording.displayAlt', { index: display.index + 1 })" />
          <span>
            <strong>{{ t('recording.display', { index: display.index + 1 }) }}<em v-if="display.primary">{{ t('recording.primaryDisplay') }}</em></strong>
            <small>{{ display.width }} × {{ display.height }} · {{ display.deviceName }}</small>
          </span>
        </button>
      </div>
      <div v-else class="recorder-preview-empty">{{ recorderBusy ? t('recording.detectingHelp') : t('recording.noDisplays') }}</div>
      <p v-if="!recorderStatus.outputRoot" class="recorder-output-help">{{ t('recording.outputHelp') }}</p>
      <div v-if="recorderStatus.phase === 'failed' || recorderError" class="inline-error recorder-inline-error" role="alert">{{ recorderError || recorderStatus.error }}</div>
    </template>
  </section>

  <section class="panel recording-browser" :class="{ 'card-recording-browser': cardId }">
    <aside v-if="!cardId" class="catalog recording-catalog">
      <div class="recording-catalog-heading">
        <h2>{{ t('recording.raw') }}</h2>
        <button class="icon-button" :disabled="actionBusy" :title="t('recording.refreshCatalog')" :aria-label="t('recording.refreshCatalog')" @click="loadRecordings"><img :src="refreshIcon" alt="" /></button>
      </div>
      <div v-if="!catalog.configured" class="recording-config-empty">
        <strong>{{ t('recording.configTitle') }}</strong>
        <p>{{ t('recording.configIntro') }}</p><code>{{ catalog.envName }}</code>
        <small>{{ t('recording.example') }}</small>
        <code class="recording-config-example"><span>CUA_RECORDINGS_ROOT=</span><span>C:\path\to\recorder-output</span></code>
        <small>{{ t('recording.restart') }}</small><small>{{ t('recording.reviewUnaffected') }}</small>
      </div>
      <div v-else-if="!catalog.recordings.length" class="recording-config-empty">
        <strong>{{ t('recording.none') }}</strong>
      </div>
      <div v-else class="recording-list">
        <button v-for="item in catalog.recordings" :key="item.id" class="task-row recording-row"
          :class="{ active: selectedId === item.id }" :disabled="actionBusy" @click="selectedId = item.id">
          <strong :title="item.id">{{ item.id }}</strong>
          <span class="recording-row-meta"><small>{{ formatTime(item.startedAt) }}</small>
            <span class="recording-status" :class="item.ready ? 'recording-ready' : 'recording-invalid'">{{ item.ready ? t('recording.ready') : t('recording.needsCheck') }}</span>
          </span>
        </button>
      </div>
    </aside>

    <section class="recording-detail">
      <header class="recording-heading">
        <div class="recording-title">
          <h2>{{ selected?.id ?? t('recording.raw') }}</h2>
          <button v-if="recorderStatus.outputRoot && selected" class="recording-path" :title="recorderStatus.outputRoot" :disabled="opening || busy" @click="openFolder">{{ recorderStatus.outputRoot }}</button>
        </div>
        <div v-if="selected" class="recording-heading-actions">
          <div class="recording-meta"><span>{{ formatTime(selected.startedAt) }}</span><span v-if="selected.screen">{{ selected.screen.width }} × {{ selected.screen.height }}</span></div>
          <button class="destructive" type="button" :disabled="!canDeleteRecording" @click="requestRecordingDeletion">{{ t('recording.delete') }}</button>
        </div>
      </header>
      <div class="recording-columns">
        <div class="recording-create-column">
          <div v-if="!selected" class="recording-detail-empty">
            <template v-if="!catalog.configured">
              <h3>{{ t('recording.configure', { name: catalog.envName }) }}</h3>
              <p>{{ t('recording.configureHelp') }}</p>
            </template>
            <h3 v-else-if="!catalog.recordings.length">{{ t('recording.firstStart') }}</h3>
            <template v-else>
              <h3>{{ t('recording.select') }}</h3>
              <p>{{ t('recording.selectHelp') }}</p>
            </template>
          </div>
          <template v-else>
            <div class="asset-grid">
              <button class="asset-card" :disabled="busy || opening" :title="t('recording.openFolder')" @click="openFolder">
                <img class="asset-icon" :src="videoIcon" alt="" />
                <span class="asset-copy"><span class="asset-label">{{ t('recording.video') }}<small>{{ formatSize(selected.video?.size) }}</small></span>
                  <strong :title="selected.video?.name">{{ selected.video?.name ?? t('recording.videoMissing') }}</strong></span>
              </button>
              <button class="asset-card" :disabled="busy || opening" :title="t('recording.openFolder')" @click="openFolder">
                <img class="asset-icon" :src="logIcon" alt="" />
                <span class="asset-copy"><span class="asset-label">{{ t('recording.eventLog') }}<small>{{ formatSize(selected.eventLog?.size) }}</small></span>
                  <strong :title="selected.eventLog?.name">{{ selected.eventLog?.name ?? t('recording.logMissing') }}</strong></span>
              </button>
            </div>
            <div v-if="selected.errors.length" class="recording-errors"><strong>{{ t('recording.invalid') }}</strong><span v-for="item in selected.errors" :key="item">{{ item }}</span></div>
            <form class="recording-form" @submit.prevent="createTask">
              <h3>{{ t('recording.create') }}</h3>
              <p>{{ t('recording.skillAutoSummary') }}</p>
              <p v-if="!skillsConfigured" class="inline-error">{{ t('review.skillsConfigHelp') }}</p>
              <div v-if="error" class="inline-error" role="alert">{{ error }}</div>
              <div class="recording-form-actions"><button class="primary" type="submit" :disabled="!canCreate">{{ busy ? t('recording.generating') : t('recording.generate') }}</button></div>
            </form>
          </template>
        </div>

        <aside class="recording-progress" aria-live="polite">
          <h3>{{ t('recording.progress') }}</h3>
          <div v-if="generation.phase === 'running'" class="generation-state phase-running" role="status">
            <div class="indeterminate-progress"><span></span></div>
            <strong>{{ t('recording.generating') }}</strong>
            <small>{{ generation.recording }}</small>
            <p>{{ t('recording.generatingHelp') }}</p>
          </div>
          <div v-else-if="generation.phase === 'succeeded' && generation.result" class="generation-state phase-succeeded" role="status">
            <strong>{{ t('recording.generationSucceeded') }}</strong><p>{{ t('recording.skillCreated', { name: generation.result.skillName }) }}</p>
            <button type="button" class="text-link" @click="emit('created', generation.result)">{{ t('recording.openCreated') }}</button>
          </div>
          <div v-else-if="generation.phase === 'failed'" class="generation-state phase-failed" role="alert">
            <strong>{{ t('recording.createFailed') }}</strong><pre>{{ generation.error }}</pre>
          </div>
          <div v-else class="generation-empty">{{ t('recording.progressEmpty') }}</div>
          <p class="recording-message">{{ message() }}</p>
        </aside>
      </div>
    </section>
  </section>

  <ConfirmDialog
    :open="recordingDeleteOpen"
    :title="t('recording.deleteTitle')"
    :message="t('recording.deleteMessage')"
    :target="selected?.id ?? ''"
    :confirm-label="t('recording.delete')"
    :cancel-label="t('common.cancel')"
    :busy="busy"
    @confirm="confirmRecordingDeletion"
    @cancel="recordingDeleteOpen = false"
  />

  </template>
</template>
