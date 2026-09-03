<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue';
import type { SceneCatalogItem } from '../../../../cua/contracts/types';
import type {
  CreateRecordingTaskResult,
  RecorderDisplay,
  RecorderStatus,
  ReviewRecording,
  ReviewRecordingCatalog,
} from '../../../shared/types';
import { api } from '../api';

const props = defineProps<{
  scenes: SceneCatalogItem[];
}>();

const emit = defineEmits<{
  created: [result: CreateRecordingTaskResult];
}>();

const catalog = ref<ReviewRecordingCatalog>({
  configured: false,
  envName: 'CUA_RECORDINGS_ROOT',
  recordings: [],
});
const selectedId = ref('');
const sceneId = ref('');
const taskId = ref('');
const goal = ref('');
const busy = ref(false);
const opening = ref(false);
const sceneMenuOpen = ref(false);
const error = ref('');
const message = ref('正在读取录制目录…');
const recorderStatus = ref<RecorderStatus>({ phase: 'idle' });
const recorderDisplays = ref<RecorderDisplay[]>([]);
const selectedDisplayId = ref('');
const recorderBusy = ref(false);
const recorderError = ref('');
const clock = ref(Date.now());
let recorderPoll: ReturnType<typeof setInterval> | undefined;

const selected = computed<ReviewRecording | undefined>(() =>
  catalog.value.recordings.find((item) => item.id === selectedId.value),
);
const canCreate = computed(() =>
  Boolean(selected.value?.ready && sceneId.value.trim() && taskId.value.trim() && !busy.value),
);
const sceneOptions = computed(() => {
  const query = sceneId.value.trim().toLocaleLowerCase();
  return props.scenes
    .filter((item) => item.status === 'ready')
    .map((item) => ({
      id: item.scene,
      title: item.title,
    }))
    .filter((item) => item.id && (
      !query
      || item.id.toLocaleLowerCase().includes(query)
      || item.title.toLocaleLowerCase().includes(query)
    ));
});
const recorderCollapsed = computed(() =>
  ['arming', 'armed', 'starting', 'recording', 'stopping'].includes(recorderStatus.value.phase),
);
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

function formatSize(size: number | undefined): string {
  if (size === undefined) return '未找到';
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / (1024 * 1024)).toFixed(1)} MB`;
}

function formatTime(value: string | undefined): string {
  if (!value) return '录制时间未知';
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? value : parsed.toLocaleString();
}

function selectScene(id: string): void {
  sceneId.value = id;
  sceneMenuOpen.value = false;
}

function closeSceneMenu(event: FocusEvent): void {
  const container = event.currentTarget as HTMLElement;
  const next = event.relatedTarget;
  if (!(next instanceof Node) || !container.contains(next)) sceneMenuOpen.value = false;
}

function applyCatalog(next: ReviewRecordingCatalog): void {
  catalog.value = next;
  if (!next.configured) {
    selectedId.value = '';
    message.value = `尚未配置录制目录，请设置 ${next.envName}`;
    return;
  }
  selectedId.value = next.recordings.some((item) => item.id === selectedId.value)
    ? selectedId.value
    : next.recordings[0]?.id ?? '';
  message.value = next.recordings.length
    ? `已发现 ${next.recordings.length} 个录制目录`
    : '录制目录中尚无可展示内容';
}

async function loadRecordings(): Promise<void> {
  error.value = '';
  try {
    applyCatalog(await api.recordings());
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  }
}

async function loadRecorderStatus(): Promise<void> {
  try {
    const wasActive = recorderCollapsed.value;
    const next = await api.recorderStatus();
    recorderStatus.value = next;
    if (wasActive && next.phase === 'idle') await loadRecordings();
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
    recorderStatus.value = await api.startRecorder({
      displayId: selectedDisplayId.value,
    });
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
  if (!selected.value || opening.value || busy.value) return;
  opening.value = true;
  error.value = '';
  try {
    await api.openRecordingFolder(selected.value.id);
    message.value = `已在文件资源管理器中打开 ${selected.value.id}`;
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
  } finally {
    opening.value = false;
  }
}

async function createTask(): Promise<void> {
  if (!selected.value || !canCreate.value) return;
  busy.value = true;
  error.value = '';
  message.value = '正在处理录制并创建完整任务，请勿关闭页面';
  try {
    const result = await api.createRecordingTask(selected.value.id, {
      scene: sceneId.value.trim(),
      task: taskId.value.trim(),
      goal: goal.value.trim(),
    });
    message.value = `任务 ${result.scene}/${result.task} 已创建`;
    emit('created', result);
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
    message.value = '任务创建失败，请检查提示后重试';
  } finally {
    busy.value = false;
  }
}

onMounted(async () => {
  await Promise.all([loadRecordings(), loadRecorderStatus()]);
  recorderPoll = setInterval(() => {
    clock.value = Date.now();
    if (recorderCollapsed.value && !recorderBusy.value) void loadRecorderStatus();
  }, 1000);
});
onUnmounted(() => {
  if (recorderPoll) clearInterval(recorderPoll);
});
</script>

<template>
  <section class="panel recorder-control" :class="{ collapsed: recorderCollapsed }">
    <template v-if="recorderCollapsed">
      <span class="recorder-live-dot" :class="{ armed: recorderStatus.phase === 'armed' || recorderStatus.phase === 'arming' }"></span>
      <div class="recorder-live-copy">
        <strong>{{
          recorderStatus.phase === 'arming' ? '正在准备录制'
            : recorderStatus.phase === 'armed' ? '录制已准备'
              : recorderStatus.phase === 'starting' ? '正在启动录制'
                : recorderStatus.phase === 'stopping' ? '正在保存录制'
                  : '正在录制'
        }}</strong>
        <small v-if="recorderStatus.phase === 'armed'">切换到目标应用，按 {{ recorderStatus.hotkey || 'Ctrl+Shift+F9' }} 开始</small>
        <small v-else-if="recorderStatus.phase === 'recording'">{{ recorderStatus.recordingId }} · {{ elapsedRecording }} · 再按 {{ recorderStatus.hotkey || 'Ctrl+Shift+F9' }} 停止</small>
        <small v-else>{{ recorderStatus.recordingId || '正在注册全局快捷键' }}</small>
      </div>
      <button
        class="danger recorder-stop"
        type="button"
        :disabled="recorderBusy || recorderStatus.phase === 'arming' || recorderStatus.phase === 'stopping'"
        @click="stopRecorder"
      >{{ recorderStatus.phase === 'stopping' ? '正在停止…' : recorderStatus.phase === 'armed' ? '取消准备' : '紧急停止' }}</button>
    </template>

    <template v-else>
      <div class="recorder-heading">
        <div>
          <p class="eyebrow">WINDOWS RECORDER</p>
          <h2>开始一次新录制</h2>
          <p>选择要录制的屏幕；保存位置由 CUA_RECORDINGS_ROOT 统一配置。</p>
        </div>
        <button class="secondary" type="button" :disabled="recorderBusy" @click="refreshRecorderDisplays">
          {{ recorderBusy ? '正在处理…' : recorderDisplays.length ? '刷新屏幕截图' : '获取屏幕截图' }}
        </button>
      </div>

      <div v-if="recorderDisplays.length" class="recorder-displays">
        <button
          v-for="display in recorderDisplays"
          :key="display.id"
          type="button"
          class="recorder-display"
          :class="{ selected: selectedDisplayId === display.id }"
          :disabled="recorderBusy"
          @click="selectedDisplayId = display.id"
        >
          <img :src="display.previewUrl" :alt="`显示器 ${display.index + 1} 截图`" />
          <span>
            <strong>显示器 {{ display.index + 1 }}<em v-if="display.primary">主屏幕</em></strong>
            <small>{{ display.width }} × {{ display.height }} · {{ display.deviceName }}</small>
          </span>
        </button>
      </div>
      <div v-else class="recorder-preview-empty">点击“获取屏幕截图”查看并选择目标显示器。</div>

      <div class="recorder-output-row">
        <div>
          <small>保存位置（CUA_RECORDINGS_ROOT）</small>
          <strong :title="recorderStatus.outputRoot">{{ recorderStatus.outputRoot || '尚未配置' }}</strong>
          <small v-if="!recorderStatus.outputRoot">请在仓库根 .env.local 中配置绝对路径并重启服务</small>
        </div>
        <button class="primary" type="button" :disabled="!canStartRecorder" @click="startRecorder">准备录制</button>
      </div>
      <div v-if="recorderStatus.phase === 'failed' || recorderError" class="inline-error recorder-inline-error">
        {{ recorderError || recorderStatus.error }}
      </div>
    </template>
  </section>

  <aside class="catalog panel recording-catalog">
    <div class="recording-catalog-heading">
      <div>
        <p class="eyebrow">RECORDINGS</p>
        <h2>原始录制</h2>
      </div>
      <button class="icon-button" :disabled="busy" title="刷新录制目录" @click="loadRecordings">↻</button>
    </div>

    <div v-if="!catalog.configured" class="recording-config-empty">
      <strong>未配置录制目录</strong>
      <p>请在进程环境或仓库根 <code>.env.local</code> 中配置：</p>
      <code>{{ catalog.envName }}</code>
      <small>示例：</small>
      <code class="recording-config-example" title="CUA_RECORDINGS_ROOT=C:\path\to\recorder-output">
        <span>CUA_RECORDINGS_ROOT=</span>
        <span>C:\path\to\recorder-output</span>
      </code>
      <small>配置后重启本地 review 服务即可生效。</small>
      <small>任务复核功能不受影响。</small>
    </div>
    <div v-else-if="!catalog.recordings.length" class="recording-config-empty">
      <strong>尚无录制</strong>
      <p>录制器生成的一级目录会显示在这里。</p>
    </div>
    <button
      v-for="item in catalog.recordings"
      v-else
      :key="item.id"
      class="task-row recording-row"
      :class="{ active: selectedId === item.id }"
      :disabled="busy"
      @click="selectedId = item.id"
    >
      <span class="recording-row-copy">
        <strong :title="item.id">{{ item.id }}</strong>
        <small>{{ formatTime(item.startedAt) }}</small>
      </span>
      <span class="recording-status" :class="item.ready ? 'recording-ready' : 'recording-invalid'">
        {{ item.ready ? '可生成' : '需要检查' }}
      </span>
    </button>
  </aside>

  <section class="panel recording-detail">
    <div v-if="!selected" class="recording-detail-empty">
      <div class="recording-placeholder-icon">◎</div>
      <h2>{{ catalog.configured ? '选择一个录制目录' : `请配置 ${catalog.envName}` }}</h2>
      <p>{{ catalog.configured ? '选择后可查看录制文件并创建完整任务。' : '配置完成并重启服务后，即可发现录制器产物。' }}</p>
    </div>

    <template v-else>
      <div class="panel-heading recording-heading">
        <div>
          <p class="eyebrow">RECORDING DETAILS</p>
          <h2>{{ selected.id }}</h2>
        </div>
        <div class="recording-meta">
          <span>{{ formatTime(selected.startedAt) }}</span>
          <span v-if="selected.screen">{{ selected.screen.width }} × {{ selected.screen.height }}</span>
        </div>
      </div>

      <div class="recording-content">
        <div class="asset-grid">
          <button class="asset-card" :disabled="busy || opening" @click="openFolder">
            <span class="asset-icon video-icon">▶</span>
            <span class="asset-copy">
              <small>录制视频</small>
              <strong>{{ selected.video?.name ?? '未找到 MP4 文件' }}</strong>
              <span>{{ formatSize(selected.video?.size) }} · 点击打开目录</span>
            </span>
          </button>
          <button class="asset-card" :disabled="busy || opening" @click="openFolder">
            <span class="asset-icon log-icon">TXT</span>
            <span class="asset-copy">
              <small>事件日志</small>
              <strong>{{ selected.eventLog?.name ?? '未找到事件日志' }}</strong>
              <span>{{ formatSize(selected.eventLog?.size) }} · 点击打开目录</span>
            </span>
          </button>
        </div>

        <div v-if="selected.errors.length" class="recording-errors">
          <strong>该录制暂不可生成</strong>
          <span v-for="item in selected.errors" :key="item">{{ item }}</span>
        </div>

        <form class="recording-form" @submit.prevent="createTask">
          <div class="recording-form-heading">
            <div>
              <p class="eyebrow">CREATE TASK</p>
              <h3>从录制创建完整任务</h3>
            </div>
            <button type="button" class="secondary" :disabled="busy || opening" @click="openFolder">
              打开录制目录
            </button>
          </div>

          <div class="recording-field">
            <label for="recording-scene-input">场景</label>
            <div class="scene-combobox" @focusout="closeSceneMenu">
              <input
                id="recording-scene-input"
                v-model="sceneId"
                :disabled="busy"
                autocomplete="off"
                role="combobox"
                aria-autocomplete="list"
                aria-controls="recording-scene-options"
                :aria-expanded="sceneMenuOpen"
                placeholder="选择已有场景或输入新场景 ID"
                @focus="sceneMenuOpen = true"
                @input="sceneMenuOpen = true"
                @keydown.esc="sceneMenuOpen = false"
              />
              <button
                type="button"
                class="scene-combobox-toggle"
                :class="{ open: sceneMenuOpen }"
                :disabled="busy"
                :aria-expanded="sceneMenuOpen"
                aria-label="展开场景列表"
                @click="sceneMenuOpen = !sceneMenuOpen"
              ></button>
              <div
                v-if="sceneMenuOpen"
                id="recording-scene-options"
                class="scene-options"
                role="listbox"
              >
                <button
                  v-for="item in sceneOptions"
                  :key="item.id"
                  type="button"
                  role="option"
                  :aria-selected="sceneId === item.id"
                  @click="selectScene(item.id)"
                >
                  <strong>{{ item.id }}</strong>
                  <span v-if="item.title && item.title !== item.id">{{ item.title }}</span>
                </button>
                <div v-if="!sceneOptions.length" class="scene-option-empty">
                  按当前输入创建新场景
                </div>
              </div>
            </div>
          </div>
          <label>任务
            <input
              v-model="taskId"
              :disabled="busy"
              autocomplete="off"
              placeholder="输入新的任务 ID"
            />
          </label>
          <label class="wide">目标（可选）
            <textarea
              v-model="goal"
              :disabled="busy"
              rows="3"
              placeholder="用于描述最终任务，不参与 Trace 生成"
            ></textarea>
          </label>

          <div v-if="busy" class="generation-state wide" role="status">
            <div class="indeterminate-progress"><span></span></div>
            <strong>正在生成任务</strong>
            <p>正在处理录制并创建可执行任务，请勿关闭页面。</p>
          </div>
          <div v-if="error" class="inline-error wide">{{ error }}</div>
          <div class="recording-form-actions wide">
            <span>{{ message }}</span>
            <button class="primary" type="submit" :disabled="!canCreate">
              {{ busy ? '正在生成…' : '从录制生成任务' }}
            </button>
          </div>
        </form>
      </div>
    </template>
  </section>
</template>
