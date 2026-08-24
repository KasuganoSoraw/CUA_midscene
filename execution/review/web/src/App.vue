<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import type { JsonObject, SceneCatalogItem, TaskCatalogItem } from '../../../cua/contracts/types';
import type {
  ReviewChange,
  ReviewEvidence,
  ReviewMutation,
  ReviewOperation,
  ReviewReferenceImage,
  ReviewStep,
  ReviewTaskDraft,
  ReviewTaskView,
} from '../../shared/types';
import {
  buildStepContent,
  defaultStepEditor,
  inputPreview,
  parseInputPreview,
  parseStepEditor,
  referenceImagesFromFlow,
} from '../../shared/step-editor';
import { ApiError, api } from './api';
import EvidencePlaceholder from './components/EvidencePlaceholder.vue';
import ExecutionWorkspace from './components/ExecutionWorkspace.vue';
import RecordingWorkspace from './components/RecordingWorkspace.vue';
import ReviewSelect, { type ReviewSelectOption } from './components/ReviewSelect.vue';

const mode = ref<'review' | 'recordings' | 'execution'>('review');
const scenes = ref<SceneCatalogItem[]>([]);
const tasks = ref<TaskCatalogItem[]>([]);
const scene = ref('');
const task = ref('');
const executionScene = ref('');
const executionTask = ref('');
const executionTargetVersion = ref(0);
const sceneSelectOptions = computed<ReviewSelectOption[]>(() =>
  scenes.value.map((item) => ({
    value: item.scene,
    label: item.status === 'error' ? `${item.title}（不可用）` : item.title,
    description: item.status === 'error' ? item.error : item.description,
    disabled: item.status === 'error',
  })),
);
const operationOptions: ReviewSelectOption[] = [
  { value: 'click', label: 'click' },
  { value: 'doubleClick', label: 'doubleClick' },
  { value: 'input', label: 'input' },
  { value: 'keyboard', label: 'keyboard' },
  { value: 'wait', label: 'wait' },
];
const inputModeOptions: ReviewSelectOption[] = [
  { value: 'replace', label: '替换原内容' },
  { value: 'append', label: '追加到末尾' },
];
const view = ref<ReviewTaskView>();
const draft = ref<ReviewTaskDraft>();
const steps = ref<ReviewStep[]>([]);
const selected = ref(0);
const editor = reactive(defaultStepEditor('click'));
const advancedEditing = ref(false);
const advancedFlowText = ref('[]');
const advancedInputText = ref('{}');
const changes = ref<ReviewChange[]>([]);
const status = ref('正在加载本地任务…');
const busy = ref(false);
const conflict = ref(false);
const evidenceMode = ref<'full' | 'crop' | 'reference' | 'placeholder'>('full');
const evidenceBySource = new Map<number, ReviewEvidence>();
let hydratingEditor = false;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const current = computed(() => steps.value[selected.value]);
const writable = computed(() => Boolean(view.value?.writable));
const referenceImageCandidate = computed<ReviewReferenceImage | undefined>(() => {
  const step = current.value;
  return step?.evidence?.reference
    ? { name: `${step.id}-reference`, url: step.evidence.reference }
    : undefined;
});
const displayedReferenceImages = computed<ReviewReferenceImage[]>(() => {
  if (editor.referenceImages.length) return editor.referenceImages;
  return referenceImageCandidate.value ? [referenceImageCandidate.value] : [];
});
const referenceImagesBound = computed(() => editor.referenceImages.length > 0);
const multipleReferenceImages = computed(() => editor.referenceImages.length > 1);
const referenceBindingStatus = computed(() => {
  if (multipleReferenceImages.value) return `已使用 ${editor.referenceImages.length} 张 · 兼容模式`;
  return referenceImagesBound.value ? '已用于执行定位' : '可用，尚未用于定位';
});
const referenceBindingDisabledReason = computed<string | undefined>(() => {
  if (!writable.value) return '内置任务为只读模式，无法修改定位参考图。';
  if (busy.value) return '任务正在处理中，请稍后再试。';
  if (advancedEditing.value) return '请先应用或取消高级 JSON 编辑。';
  if (editor.custom) return '当前 Flow 不是标准动作模板，请通过高级 JSON 维护。';
  if (editor.operation !== 'click' && editor.operation !== 'doubleClick') {
    return '仅点击和双击动作支持定位参考图。';
  }
  if (multipleReferenceImages.value) {
    return '当前步骤包含多张定位参考图，请通过高级 JSON 维护，系统不会自动合并或删除。';
  }
  if (!referenceImagesBound.value && !referenceImageCandidate.value) {
    return '当前步骤没有可用的录制定位参考图。';
  }
  return undefined;
});
const dirty = computed(() => changes.value.length > 0);
const builtContent = computed(() => buildStepContent(editor, current.value?.id ?? 'step-001'));
const flowPreview = computed(() => JSON.stringify(builtContent.value.flow, null, 2));
const parameterPreview = computed(() => JSON.stringify(
  inputPreview(current.value?.id ?? 'step-001', builtContent.value.input),
  null,
  2,
));

function rebuildSteps(): void {
  if (!draft.value) return;
  const bindings = draft.value.manifest.source.stepBindings ?? {};
  steps.value = (draft.value.document.tasks as JsonObject[]).map((item, index) => {
    const name = String(item.name);
    const match = /^(step-\d{3,}) \| (click|doubleClick|input|keyboard|wait)$/.exec(name);
    const id = match?.[1] ?? `step-${String(index + 1).padStart(3, '0')}`;
    const operation = (match?.[2] ?? 'click') as ReviewOperation;
    const flow = clone(item.flow as JsonObject[]);
    const referenceImages = referenceImagesFromFlow(flow, operation);
    const sourceStep = bindings[id];
    const evidence = typeof sourceStep === 'number' ? evidenceBySource.get(sourceStep) : undefined;
    return {
      id,
      name,
      operation,
      flow,
      ...(draft.value!.manifest.inputs[`${id}-input`] ? { input: clone(draft.value!.manifest.inputs[`${id}-input`]) } : {}),
      ...(evidence ? { evidence } : {}),
      ...(referenceImages.length ? { referenceImages } : {}),
    };
  });
  if (selected.value >= steps.value.length) selected.value = steps.value.length - 1;
}

function populateEditor(): void {
  const step = current.value;
  if (!step) return;
  hydratingEditor = true;
  Object.assign(editor, parseStepEditor(step));
  advancedEditing.value = false;
  advancedFlowText.value = JSON.stringify(step.flow, null, 2);
  advancedInputText.value = JSON.stringify(inputPreview(step.id, step.input), null, 2);
  const evidence = step.evidence;
  evidenceMode.value = evidence?.crop
    ? 'crop'
    : evidence?.full ? 'full' : 'placeholder';
  hydratingEditor = false;
}

function clearTaskView(): void {
  view.value = undefined;
  draft.value = undefined;
  steps.value = [];
  changes.value = [];
  selected.value = 0;
  evidenceBySource.clear();
}

watch(selected, populateEditor);
watch(editor, () => {
  if (!hydratingEditor && !advancedEditing.value) syncSemanticDraft();
}, { deep: true, flush: 'sync' });

async function loadScenes(): Promise<void> {
  busy.value = true;
  try {
    scenes.value = (await api.scenes()).scenes;
    const currentReady = scenes.value.some((item) => item.scene === scene.value && item.status === 'ready');
    if (!currentReady) scene.value = scenes.value.find((item) => item.status === 'ready')?.scene ?? '';
    if (scene.value) {
      await loadTasks();
    } else {
      tasks.value = [];
      task.value = '';
      clearTaskView();
      status.value = scenes.value.length ? '当前没有可复核的健康场景' : '当前没有场景';
    }
  } catch (error) {
    scenes.value = [];
    tasks.value = [];
    scene.value = '';
    task.value = '';
    clearTaskView();
    status.value = error instanceof Error ? error.message : String(error);
  } finally { busy.value = false; }
}

async function openCreatedTask(result: { scene: string; task: string }): Promise<void> {
  scene.value = result.scene;
  task.value = result.task;
  mode.value = 'review';
  await loadScenes();
}

async function loadTasks(): Promise<void> {
  if (!scene.value) {
    tasks.value = [];
    task.value = '';
    clearTaskView();
    return;
  }
  busy.value = true;
  conflict.value = false;
  try {
    tasks.value = (await api.tasks(scene.value)).tasks;
    const currentReady = tasks.value.some((item) => item.task === task.value && item.status === 'ready');
    if (!currentReady) task.value = tasks.value.find((item) => item.status === 'ready')?.task ?? '';
    if (task.value) {
      await loadTask();
    } else {
      clearTaskView();
      status.value = tasks.value.length ? '当前场景没有可复核的健康任务' : '当前场景没有任务';
    }
  } catch (error) {
    tasks.value = [];
    task.value = '';
    clearTaskView();
    status.value = error instanceof Error ? error.message : String(error);
  } finally { busy.value = false; }
}

async function openTask(item: TaskCatalogItem): Promise<void> {
  if (item.status !== 'ready') return;
  task.value = item.task;
  await loadTask();
}

async function loadTask(): Promise<void> {
  if (!scene.value || !task.value) return;
  busy.value = true;
  conflict.value = false;
  try {
    const loaded = await api.task(scene.value, task.value);
    view.value = loaded;
    draft.value = { manifest: clone(loaded.manifest), document: clone(loaded.document) };
    evidenceBySource.clear();
    loaded.steps.forEach((item) => { if (item.evidence) evidenceBySource.set(item.evidence.sourceStep, item.evidence); });
    changes.value = [];
    selected.value = 0;
    rebuildSteps();
    populateEditor();
    status.value = loaded.writable ? '任务已同步，可开始复核' : '内置任务为只读模式';
  } catch (error) {
    clearTaskView();
    status.value = error instanceof Error ? error.message : String(error);
  } finally { busy.value = false; }
}

async function mutate(mutation: ReviewMutation): Promise<void> {
  if (!draft.value || !writable.value) return;
  busy.value = true;
  try {
    const result = await api.mutate(scene.value, task.value, draft.value, mutation);
    draft.value = result.draft;
    changes.value.push(result.change);
    rebuildSteps();
    populateEditor();
    status.value = '草稿已通过任务契约校验，尚未写入磁盘';
  } catch (error) {
    status.value = error instanceof Error ? error.message : String(error);
  } finally { busy.value = false; }
}

function syncSemanticDraft(): void {
  const step = current.value;
  if (!draft.value || !step || !writable.value) return;
  const content = buildStepContent(editor, step.id);
  const referenceImages = referenceImagesFromFlow(content.flow, editor.operation);
  const taskItem = (draft.value.document.tasks as JsonObject[])[selected.value];
  taskItem.name = `${step.id} | ${editor.operation}`;
  taskItem.flow = clone(content.flow);
  const inputId = `${step.id}-input`;
  if (content.input) draft.value.manifest.inputs[inputId] = clone(content.input);
  else delete draft.value.manifest.inputs[inputId];
  steps.value[selected.value] = {
    ...step,
    name: String(taskItem.name),
    operation: editor.operation,
    flow: clone(content.flow),
    ...(content.input ? { input: clone(content.input) } : { input: undefined }),
    ...(referenceImages.length ? { referenceImages } : { referenceImages: undefined }),
  };
  const summary = `修改第 ${selected.value + 1} 个步骤`;
  const existing = changes.value.find((item) => item.kind === 'update' && item.summary === summary);
  if (!existing) changes.value.push({ kind: 'update', summary, details: ['步骤内容已更新'] });
  status.value = '已更新浏览器草稿，尚未写入磁盘';
}

function changeOperation(value: string): void {
  const next = value as ReviewOperation;
  if (next === editor.operation) return;
  if (!confirm(`将 ${editor.operation} 改为 ${next} 会按新动作模板重建当前步骤，是否继续？`)) {
    return;
  }
  const nextEditor = defaultStepEditor(next, editor.delayMs);
  hydratingEditor = true;
  Object.assign(editor, nextEditor);
  hydratingEditor = false;
  syncSemanticDraft();
}

function enableAdvancedEditing(): void {
  advancedFlowText.value = flowPreview.value;
  advancedInputText.value = parameterPreview.value;
  advancedEditing.value = true;
}

function cancelAdvancedEditing(): void {
  advancedEditing.value = false;
  advancedFlowText.value = flowPreview.value;
  advancedInputText.value = parameterPreview.value;
}

function applyAdvancedEditor(): void {
  const step = current.value;
  if (!step) return;
  try {
    const parsedFlow = JSON.parse(advancedFlowText.value) as unknown;
    if (!Array.isArray(parsedFlow) || !parsedFlow.length || parsedFlow.some((item) => !item || typeof item !== 'object' || Array.isArray(item))) {
      throw new Error('Flow 必须是由 action 对象组成的非空 JSON 数组');
    }
    const input = parseInputPreview(JSON.parse(advancedInputText.value) as unknown, step.id);
    if (input && editor.operation !== 'input') throw new Error('只有 input 动作可以定义运行时参数');
    const parsedEditor = parseStepEditor({
      id: step.id,
      operation: editor.operation,
      flow: parsedFlow as JsonObject[],
      ...(input ? { input } : {}),
    });
    hydratingEditor = true;
    Object.assign(editor, parsedEditor);
    hydratingEditor = false;
    advancedEditing.value = false;
    syncSemanticDraft();
    status.value = parsedEditor.custom
      ? '高级 Flow 已应用；该结构无法映射为标准表单，请继续使用高级模式维护'
      : '高级 JSON 已校验并同步回普通表单';
  } catch (error) {
    status.value = error instanceof Error ? error.message : String(error);
  }
}

async function insertStep(): Promise<void> {
  const index = selected.value + 1;
  await mutate({ type: 'insert', index, step: { operation: 'click', flow: [{ aiTap: '描述要点击的目标' }] } });
  selected.value = index;
  populateEditor();
}

async function removeStep(): Promise<void> {
  if (!confirm(`确认删除 ${current.value?.name}？`)) return;
  await mutate({ type: 'remove', index: selected.value });
}

async function move(delta: number): Promise<void> {
  const target = selected.value + delta;
  if (target < 0 || target >= steps.value.length) return;
  const from = selected.value;
  await mutate({ type: 'move', from, to: target });
  selected.value = target;
}

async function validate(): Promise<void> {
  if (!draft.value) return;
  try {
    await api.validate(scene.value, task.value, draft.value);
    status.value = '✓ 当前草稿通过 JSON、CUA 与 Midscene 校验';
  } catch (error) { status.value = error instanceof Error ? error.message : String(error); }
}

async function save(): Promise<boolean> {
  if (!draft.value || !view.value) return false;
  if (!dirty.value) return true;
  busy.value = true;
  try {
    const result = await api.save(scene.value, task.value, view.value.revision, draft.value);
    status.value = `已写入 ${result.changed.join('、') || '无变更'}`;
    await loadTask();
    return true;
  } catch (error) {
    conflict.value = error instanceof ApiError && error.status === 409;
    status.value = error instanceof Error ? error.message : String(error);
    return false;
  } finally { busy.value = false; }
}

async function runCurrentTask(): Promise<void> {
  if (!view.value || busy.value) return;
  if (dirty.value && !(await save())) return;
  executionScene.value = scene.value;
  executionTask.value = task.value;
  executionTargetVersion.value += 1;
  mode.value = 'execution';
}

function evidencePath(step: ReviewStep | undefined): string | undefined {
  const evidence = step?.evidence;
  return evidenceMode.value === 'crop' ? evidence?.crop ?? evidence?.full : evidence?.full ?? evidence?.crop;
}

function referenceImageUrl(image: ReviewReferenceImage): string {
  return /^(?:https?:|data:)/i.test(image.url)
    ? image.url
    : api.evidenceUrl(scene.value, task.value, image.url);
}

function bindReferenceImage(): void {
  const candidate = referenceImageCandidate.value;
  if (!candidate || referenceBindingDisabledReason.value) return;
  editor.referenceImages = [clone(candidate)];
  editor.convertHttpImage2Base64 = false;
}

function unbindReferenceImage(): void {
  if (
    editor.referenceImages.length !== 1
    || referenceBindingDisabledReason.value
  ) return;
  editor.referenceImages = [];
  editor.convertHttpImage2Base64 = false;
}

onMounted(loadScenes);
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">GDE CLAW · LOCAL REVIEW</p>
        <h1>CUA 本地任务工作台</h1>
      </div>
      <div v-if="mode === 'review'" class="top-actions">
        <span class="status-chip" :class="{ readonly: !writable }">{{ writable ? '用户任务 · 可写' : '内置任务 · 只读' }}</span>
        <button class="secondary" :disabled="busy || !view" @click="runCurrentTask">{{ dirty && writable ? '保存并运行' : '运行此任务' }}</button>
        <button class="secondary" :disabled="busy || !draft" @click="validate">校验草稿</button>
        <button class="primary" :disabled="busy || !dirty || !writable" @click="save">确认并写入</button>
      </div>
      <div v-else-if="mode === 'recordings'" class="top-actions">
        <span class="status-chip">本地录制 · 创建任务</span>
      </div>
      <div v-else class="top-actions"><span class="status-chip">本地执行 · 操作桌面</span></div>
    </header>

    <nav class="mode-tabs" aria-label="复核控制台功能">
      <button :class="{ active: mode === 'review' }" @click="mode = 'review'">任务复核</button>
      <button :class="{ active: mode === 'recordings' }" @click="mode = 'recordings'">从录制创建任务</button>
      <button :class="{ active: mode === 'execution' }" @click="mode = 'execution'">任务运行</button>
    </nav>

    <div v-if="mode === 'review' && conflict" class="conflict">
      Agent 已在外部修改任务，当前草稿不会覆盖磁盘内容。
      <button @click="loadTask">重新载入</button>
    </div>

    <main v-if="mode === 'review'" class="workspace">
      <aside class="catalog panel">
        <label>场景</label>
        <ReviewSelect
          v-model="scene"
          class="catalog-select"
          aria-label="场景"
          :options="sceneSelectOptions"
          @change="loadTasks"
        />
        <label>任务</label>
        <button
          v-for="item in tasks" :key="String(item.task)"
          class="task-row"
          :class="{ active: task === item.task, error: item.status === 'error' }"
          :disabled="item.status === 'error'"
          @click="openTask(item)"
        >
          <strong>{{ item.title }}</strong>
          <small>{{ item.task }}</small>
          <span v-if="item.status === 'error'" class="task-error">{{ item.error }}</span>
        </button>
      </aside>

      <section class="steps panel">
        <div class="panel-heading">
          <div><p class="eyebrow">TASK.YAML</p><h2>{{ view?.title ?? '选择任务' }}</h2></div>
          <span>{{ steps.length }} steps</span>
        </div>
        <div class="step-list">
          <button
            v-for="(item, index) in steps" :key="item.id"
            class="step-row" :class="{ active: selected === index }" @click="selected = index"
          >
            <span class="step-index">{{ String(index + 1).padStart(2, '0') }}</span>
            <span><strong>{{ item.operation }}</strong><small>{{ item.id }}</small></span>
            <span class="step-markers">
              <span v-if="item.evidence" class="evidence-dot" title="有录制证据"></span>
              <span
                v-if="item.referenceImages?.length"
                class="reference-mark"
                title="YAML 已使用定位参考图"
              >▣</span>
              <span
                v-else-if="item.evidence?.reference"
                class="reference-mark available"
                title="有可用定位参考图，当前 YAML 尚未使用"
              >▢</span>
            </span>
          </button>
        </div>
        <div class="structure-actions">
          <button :disabled="!writable || busy" @click="insertStep">＋ 插入</button>
          <button :disabled="!writable || busy || selected === 0" @click="move(-1)">↑</button>
          <button :disabled="!writable || busy || selected === steps.length - 1" @click="move(1)">↓</button>
          <button class="danger" :disabled="!writable || busy || steps.length <= 1" @click="removeStep">删除</button>
        </div>
      </section>

      <section class="editor panel">
        <div class="panel-heading">
          <div><p class="eyebrow">STEP CONFIGURATION</p><h2>{{ current?.name ?? '未选择步骤' }}</h2></div>
        </div>

        <div class="evidence-viewer" v-if="current?.evidence || displayedReferenceImages.length">
          <div class="evidence-tabs">
            <button
              v-if="current.evidence?.full"
              :class="{ active: evidenceMode === 'full' }"
              @click="evidenceMode = 'full'"
            >全局图</button>
            <button
              v-if="current.evidence?.crop"
              :class="{ active: evidenceMode === 'crop' }"
              @click="evidenceMode = 'crop'"
            >局部图</button>
            <button
              v-if="!current.evidence?.full && !current.evidence?.crop"
              :class="{ active: evidenceMode === 'placeholder' }"
              @click="evidenceMode = 'placeholder'"
            >无录制图</button>
            <button
              v-if="displayedReferenceImages.length"
              :class="{ active: evidenceMode === 'reference' }"
              @click="evidenceMode = 'reference'"
            >定位参考图</button>
            <small v-if="evidenceMode === 'reference'">{{ referenceBindingStatus }}</small>
            <small v-else-if="current.evidence">source step {{ current.evidence.sourceStep }}</small>
            <small v-else>当前步骤无独立证据</small>
          </div>
          <div v-if="evidenceMode === 'reference'" class="reference-gallery">
            <article
              v-for="(image, imageIndex) in displayedReferenceImages"
              :key="`${image.name}:${image.url}`"
              :class="{ 'compatibility-item': multipleReferenceImages }"
            >
              <div class="reference-image-frame">
                <img :src="referenceImageUrl(image)" alt="定位参考图" />
              </div>
              <div class="reference-card-content">
                <div class="reference-card-heading">
                  <strong>{{ multipleReferenceImages ? `定位参考图 ${imageIndex + 1}` : '定位参考图' }}</strong>
                  <span class="reference-state" :class="{ bound: referenceImagesBound }">
                    {{ referenceBindingStatus }}
                  </span>
                </div>
                <template v-if="multipleReferenceImages">
                  <code :title="image.name">{{ image.name }}</code>
                  <code :title="image.url">{{ image.url }}</code>
                </template>
                <p v-if="imageIndex === 0">
                  定位参考图帮助 Midscene 识别目标外观；执行时仍会结合当前页面和目标描述判断位置，不代表固定点击坐标。
                </p>
                <div v-if="imageIndex === 0" class="reference-actions">
                  <button
                    v-if="referenceImagesBound"
                    class="reference-action secondary"
                    :disabled="Boolean(referenceBindingDisabledReason)"
                    :title="referenceBindingDisabledReason"
                    @click="unbindReferenceImage"
                  >取消使用</button>
                  <button
                    v-else
                    class="reference-action primary"
                    :disabled="Boolean(referenceBindingDisabledReason)"
                    :title="referenceBindingDisabledReason"
                    @click="bindReferenceImage"
                  >用于定位</button>
                </div>
                <small v-if="imageIndex === 0 && referenceBindingDisabledReason" class="reference-disabled-reason">
                  {{ referenceBindingDisabledReason }}
                </small>
              </div>
            </article>
          </div>
          <EvidencePlaceholder v-else-if="evidenceMode === 'placeholder'" />
          <template v-else>
            <img
              v-if="evidencePath(current)"
              :src="api.evidenceUrl(scene, task, evidencePath(current)!)"
              :alt="`${current.name} 录制证据`"
            />
          </template>
        </div>
        <div v-else class="evidence-viewer placeholder-only">
          <EvidencePlaceholder />
        </div>

        <div class="form-grid" v-if="current">
          <label>动作类型
            <ReviewSelect
              :model-value="editor.operation"
              aria-label="动作类型"
              :options="operationOptions"
              :disabled="!writable || advancedEditing"
              @change="changeOperation"
            />
          </label>
          <label>动作前等待（毫秒）
            <input v-model.number="editor.delayMs" type="number" min="0" step="100" :readonly="!writable || advancedEditing" />
          </label>

          <div v-if="editor.custom" class="custom-flow-note wide">
            当前 Flow 不是标准动作模板，已完整保留。可在“高级 JSON”中继续维护，或切换动作类型重建为标准表单。
          </div>

          <template v-else-if="editor.operation === 'click' || editor.operation === 'doubleClick'">
            <label class="wide">目标描述
              <textarea v-model="editor.target" rows="3" :readonly="!writable || advancedEditing" placeholder="结合上方截图描述要点击的目标"></textarea>
            </label>
          </template>

          <template v-else-if="editor.operation === 'input'">
            <label class="wide">输入框位置
              <textarea v-model="editor.target" rows="3" :readonly="!writable || advancedEditing" placeholder="结合上方截图描述输入框位置"></textarea>
            </label>
            <label>输入方式
              <ReviewSelect
                v-model="editor.inputMode"
                aria-label="输入方式"
                :options="inputModeOptions"
                :disabled="!writable || advancedEditing"
              />
            </label>
            <fieldset class="input-options wide">
              <label class="checkbox">
                <input v-model="editor.parameterized" type="checkbox" :disabled="!writable || advancedEditing" />
                <span>暴露为运行时参数</span>
              </label>
              <div v-if="editor.parameterized" class="input-fields">
                <label>输入标签<input v-model="editor.inputLabel" :readonly="!writable || advancedEditing" /></label>
                <label>录制默认值<input v-model="editor.inputDefault" :readonly="!writable || advancedEditing" /></label>
                <label class="wide">参数说明（可选）<input v-model="editor.inputDescription" :readonly="!writable || advancedEditing" /></label>
              </div>
              <div v-else class="input-fields single-field">
                <label>固定输入值<input v-model="editor.inputValue" :readonly="!writable || advancedEditing" /></label>
              </div>
            </fieldset>
          </template>

          <template v-else-if="editor.operation === 'keyboard'">
            <label class="wide">按键名称
              <input v-model="editor.keyName" :readonly="!writable || advancedEditing" placeholder="例如 Enter、Escape、Control+A" />
            </label>
          </template>

          <template v-else-if="editor.operation === 'wait'">
            <label class="wide">等待条件
              <textarea v-model="editor.waitCondition" rows="3" :readonly="!writable || advancedEditing" placeholder="描述页面需要出现的状态"></textarea>
            </label>
            <label>超时时间（毫秒）
              <input v-model.number="editor.timeoutMs" type="number" min="1" step="1000" :readonly="!writable || advancedEditing" />
            </label>
          </template>

          <details class="advanced wide" :open="advancedEditing">
            <summary>
              <span><strong>高级 JSON</strong><small>由上方表单实时生成；需要时可显式编辑</small></span>
              <button v-if="!advancedEditing" type="button" class="text-button" :disabled="!writable" @click.prevent="enableAdvancedEditing">启用编辑</button>
            </summary>
            <div class="advanced-grid">
              <label>Flow（task.yaml）
                <textarea
                  :value="advancedEditing ? advancedFlowText : flowPreview"
                  rows="10" spellcheck="false" :readonly="!advancedEditing"
                  @input="advancedFlowText = ($event.target as HTMLTextAreaElement).value"
                ></textarea>
              </label>
              <label>当前步骤参数（task.json.inputs）
                <textarea
                  :value="advancedEditing ? advancedInputText : parameterPreview"
                  rows="10" spellcheck="false" :readonly="!advancedEditing"
                  @input="advancedInputText = ($event.target as HTMLTextAreaElement).value"
                ></textarea>
              </label>
            </div>
            <div v-if="advancedEditing" class="advanced-actions">
              <span>编辑期间普通表单暂停联动。</span>
              <button type="button" class="secondary" @click="cancelAdvancedEditing">取消</button>
              <button type="button" class="primary" :disabled="!writable" @click="applyAdvancedEditor">校验并应用</button>
            </div>
          </details>
        </div>

        <div class="changes">
          <div class="panel-heading compact"><h3>变更对比</h3><span>{{ changes.length }}</span></div>
          <p v-if="!changes.length" class="muted">尚未修改 canonical 资产。</p>
          <article v-for="(change, index) in changes" :key="index">
            <strong>{{ change.summary }}</strong><span>{{ change.kind }}</span>
            <small>{{ change.details.join(' · ') }}</small>
          </article>
        </div>
      </section>
    </main>

    <main v-else-if="mode === 'recordings'" class="workspace recording-layout">
      <RecordingWorkspace :scenes="scenes" @created="openCreatedTask" />
    </main>

    <main v-else class="workspace execution-layout">
      <ExecutionWorkspace
        :scenes="scenes"
        :initial-scene="executionScene || scene"
        :initial-task="executionTask || task"
        :target-version="executionTargetVersion"
      />
    </main>

    <footer v-if="mode === 'review'"><span :class="{ error: conflict }">{{ status }}</span><code>{{ view?.revision }}</code></footer>
  </div>
</template>
