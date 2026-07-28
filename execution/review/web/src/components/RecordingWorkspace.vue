<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import type {
  CreateRecordingTaskResult,
  ReviewRecording,
  ReviewRecordingCatalog,
} from '../../../shared/types';
import { api } from '../api';

const props = defineProps<{
  scenes: Array<Record<string, unknown>>;
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
const error = ref('');
const message = ref('正在读取录制目录…');

const selected = computed<ReviewRecording | undefined>(() =>
  catalog.value.recordings.find((item) => item.id === selectedId.value),
);
const canCreate = computed(() =>
  Boolean(selected.value?.ready && sceneId.value.trim() && taskId.value.trim() && !busy.value),
);

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

async function loadRecordings(): Promise<void> {
  error.value = '';
  try {
    catalog.value = await api.recordings();
    if (!catalog.value.configured) {
      selectedId.value = '';
      message.value = `尚未配置录制目录，请设置 ${catalog.value.envName}`;
      return;
    }
    selectedId.value = catalog.value.recordings.some((item) => item.id === selectedId.value)
      ? selectedId.value
      : catalog.value.recordings[0]?.id ?? '';
    message.value = catalog.value.recordings.length
      ? `已发现 ${catalog.value.recordings.length} 个录制目录`
      : '录制目录中尚无可展示内容';
  } catch (caught) {
    error.value = caught instanceof Error ? caught.message : String(caught);
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

onMounted(loadRecordings);
</script>

<template>
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
      <p>请在 execution 环境中设置：</p>
      <code>{{ catalog.envName }}</code>
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
      <strong>{{ item.id }}</strong>
      <small>{{ formatTime(item.startedAt) }}</small>
      <span :class="item.ready ? 'recording-ready' : 'recording-invalid'">
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

          <label>场景
            <input
              v-model="sceneId"
              list="recording-scene-options"
              :disabled="busy"
              autocomplete="off"
              placeholder="选择已有场景或输入新场景 ID"
            />
            <datalist id="recording-scene-options">
              <option
                v-for="item in props.scenes"
                :key="String(item.scene)"
                :value="String(item.scene)"
              >{{ item.title }}</option>
            </datalist>
          </label>
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
