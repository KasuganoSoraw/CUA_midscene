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
import { useI18n, type MessageKey } from './i18n';
import AgentWorkspace from './components/AgentWorkspace.vue';
import EvidencePlaceholder from './components/EvidencePlaceholder.vue';
import ExecutionWorkspace from './components/ExecutionWorkspace.vue';
import RecordingWorkspace from './components/RecordingWorkspace.vue';
import ReviewSelect, { type ReviewSelectOption } from './components/ReviewSelect.vue';

const { locale, t, setLocale } = useI18n();

const initialParams = new URLSearchParams(window.location.search);
const requestedMode = initialParams.get('mode');
const requestedDevMode = initialParams.get('dev') === '1';
const initialMode = requestedMode === 'recording'
  ? 'recordings'
  : requestedMode === 'execution' ? 'execution' : 'review';
const initialScene = initialParams.get('scene')?.trim() ?? '';
const initialTask = initialParams.get('task')?.trim() ?? '';

const mode = ref<'review' | 'recordings' | 'execution' | 'agent'>(initialMode);
const devMode = ref(false);
const scenes = ref<SceneCatalogItem[]>([]);
const tasks = ref<TaskCatalogItem[]>([]);
const scene = ref(initialScene);
const task = ref(initialTask);
const executionScene = ref(initialMode === 'execution' ? initialScene : '');
const executionTask = ref(initialMode === 'execution' ? initialTask : '');
const executionTargetVersion = ref(0);
const sceneSelectOptions = computed<ReviewSelectOption[]>(() =>
  scenes.value.map((item) => ({
    value: item.scene,
    label: item.status === 'error' ? `${item.title} (${t('common.unavailable')})` : item.title,
    description: item.status === 'error' ? item.error : item.description,
    disabled: item.status === 'error',
  })),
);
function operationLabel(operation: ReviewOperation): string {
  return t(`review.operation.${operation}` as MessageKey);
}

const operationOptions = computed<ReviewSelectOption[]>(() => [
  { value: 'click', label: operationLabel('click') },
  { value: 'doubleClick', label: operationLabel('doubleClick') },
  { value: 'input', label: operationLabel('input') },
  { value: 'keyboard', label: operationLabel('keyboard') },
  { value: 'wait', label: operationLabel('wait') },
]);
const inputModeOptions = computed<ReviewSelectOption[]>(() => [
  { value: 'replace', label: t('review.inputReplace') },
  { value: 'append', label: t('review.inputAppend') },
]);
const view = ref<ReviewTaskView>();
const draft = ref<ReviewTaskDraft>();
const steps = ref<ReviewStep[]>([]);
const selected = ref(0);
const editor = reactive(defaultStepEditor('click'));
const advancedEditing = ref(false);
const advancedFlowText = ref('[]');
const advancedInputText = ref('{}');
const changes = ref<ReviewChange[]>([]);
const status = ref(() => t('review.loading'));
const busy = ref(false);
const conflict = ref(false);
const evidenceMode = ref<'full' | 'crop' | 'reference' | 'placeholder'>('full');
const evidenceBySource = new Map<number, ReviewEvidence>();
let hydratingEditor = false;

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const current = computed(() => steps.value[selected.value]);
const currentTitle = computed(() => current.value
  ? t('review.stepTitle', { index: selected.value + 1, operation: operationLabel(current.value.operation) })
  : t('review.noStep'));
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
  if (multipleReferenceImages.value) return t('review.referenceMultiple', { count: editor.referenceImages.length });
  return referenceImagesBound.value ? t('review.referenceBound') : t('review.referenceAvailableStatus');
});
const referenceBindingDisabledReason = computed<string | undefined>(() => {
  if (!writable.value) return t('review.referenceReadonly');
  if (busy.value) return t('review.referenceBusy');
  if (advancedEditing.value) return t('review.referenceAdvanced');
  if (editor.custom) return t('review.referenceCustom');
  if (editor.operation !== 'click' && editor.operation !== 'doubleClick') {
    return t('review.referenceOperation');
  }
  if (multipleReferenceImages.value) {
    return t('review.referenceMany');
  }
  if (!referenceImagesBound.value && !referenceImageCandidate.value) {
    return t('review.referenceMissing');
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
      status.value = scenes.value.length ? () => t('review.noHealthyScenes') : () => t('review.noScenes');
    }
  } catch (error) {
    scenes.value = [];
    tasks.value = [];
    scene.value = '';
    task.value = '';
    clearTaskView();
    const text = error instanceof Error ? error.message : String(error);
    status.value = () => text;
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
      status.value = tasks.value.length ? () => t('review.noHealthyTasks') : () => t('review.noTasks');
    }
  } catch (error) {
    tasks.value = [];
    task.value = '';
    clearTaskView();
    const text = error instanceof Error ? error.message : String(error);
    status.value = () => text;
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
    status.value = loaded.writable ? () => t('review.ready') : () => t('review.readonlyStatus');
  } catch (error) {
    clearTaskView();
    const text = error instanceof Error ? error.message : String(error);
    status.value = () => text;
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
    status.value = () => t('review.draftValidated');
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    status.value = () => text;
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
  const summary = t('review.updateStep', { index: selected.value + 1 });
  const existing = changes.value.find((item) => item.kind === 'update' && item.summary === summary);
  if (!existing) changes.value.push({ kind: 'update', summary, details: [t('review.stepUpdated')] });
  status.value = () => t('review.draftUpdated');
}

function changeOperation(value: string): void {
  const next = value as ReviewOperation;
  if (next === editor.operation) return;
  if (!confirm(t('review.confirmOperation', { from: operationLabel(editor.operation), to: operationLabel(next) }))) {
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
      throw new Error(t('review.flowJsonError'));
    }
    const input = parseInputPreview(JSON.parse(advancedInputText.value) as unknown, step.id);
    if (input && editor.operation !== 'input') throw new Error(t('review.inputOnlyError'));
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
      ? () => t('review.advancedCustomApplied')
      : () => t('review.advancedApplied');
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    status.value = () => text;
  }
}

async function insertStep(): Promise<void> {
  const index = selected.value + 1;
  await mutate({ type: 'insert', index, step: { operation: 'click', flow: [{ aiTap: t('review.defaultClickTarget') }] } });
  selected.value = index;
  populateEditor();
}

async function removeStep(): Promise<void> {
  if (!confirm(t('review.confirmRemove', { name: current.value?.name ?? '' }))) return;
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
    status.value = () => t('review.valid');
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    status.value = () => text;
  }
}

async function save(): Promise<boolean> {
  if (!draft.value || !view.value) return false;
  if (!dirty.value) return true;
  busy.value = true;
  try {
    const result = await api.save(scene.value, task.value, view.value.revision, draft.value);
    status.value = () => t('review.saved', { files: result.changed.join(', ') || t('review.noChanges') });
    await loadTask();
    return true;
  } catch (error) {
    conflict.value = error instanceof ApiError && error.status === 409;
    const text = error instanceof Error ? error.message : String(error);
    status.value = () => text;
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

onMounted(async () => {
  const [, identity] = await Promise.all([loadScenes(), api.reviewIdentity()]);
  devMode.value = requestedDevMode && identity.devMode;
  if (devMode.value && requestedMode === 'agent') mode.value = 'agent';
});
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">{{ t('app.subtitle') }}</p>
        <h1>{{ t('app.title') }}</h1>
      </div>
      <div class="topbar-right">
        <div class="language-switch" role="group" :aria-label="t('app.language')">
          <button :class="{ active: locale === 'zh-CN' }" @click="setLocale('zh-CN')">中文</button>
          <button :class="{ active: locale === 'en-US' }" @click="setLocale('en-US')">EN</button>
        </div>
        <div v-if="mode === 'review'" class="top-actions">
          <span class="status-chip" :class="{ readonly: !writable }">{{ writable ? t('review.writable') : t('review.readonly') }}</span>
          <button class="secondary" :disabled="busy || !view" @click="runCurrentTask">{{ dirty && writable ? t('review.saveAndRun') : t('review.runTask') }}</button>
          <button class="secondary" :disabled="busy || !draft" @click="validate">{{ t('review.validate') }}</button>
          <button class="primary" :disabled="busy || !dirty || !writable" @click="save">{{ t('review.save') }}</button>
        </div>
        <div v-else-if="mode === 'recordings'" class="top-actions">
          <span class="status-chip">{{ t('recording.modeStatus') }}</span>
        </div>
        <div v-else-if="mode === 'execution'" class="top-actions"><span class="status-chip">{{ t('execution.modeStatus') }}</span></div>
        <div v-else class="top-actions"><span class="status-chip">{{ t('agent.modeStatus') }}</span></div>
      </div>
    </header>

    <nav class="mode-tabs" :aria-label="t('app.navLabel')">
      <button :class="{ active: mode === 'review' }" @click="mode = 'review'">{{ t('app.mode.review') }}</button>
      <button :class="{ active: mode === 'recordings' }" @click="mode = 'recordings'">{{ t('app.mode.recordings') }}</button>
      <button :class="{ active: mode === 'execution' }" @click="mode = 'execution'">{{ t('app.mode.execution') }}</button>
      <button v-if="devMode" :class="{ active: mode === 'agent' }" @click="mode = 'agent'">{{ t('app.mode.agent') }}</button>
    </nav>

    <div v-if="mode === 'review' && conflict" class="conflict">
      {{ t('review.conflict') }}
      <button @click="loadTask">{{ t('review.reload') }}</button>
    </div>

    <main v-if="mode === 'review'" class="workspace">
      <aside class="catalog panel">
        <label>{{ t('review.scene') }}</label>
        <ReviewSelect
          v-model="scene"
          class="catalog-select"
          :aria-label="t('review.scene')"
          :options="sceneSelectOptions"
          @change="loadTasks"
        />
        <label>{{ t('review.task') }}</label>
        <button
          v-for="item in tasks" :key="String(item.task)"
          class="task-row"
          :class="{ active: task === item.task, error: item.status === 'error' }"
          :disabled="item.status === 'error'"
          @click="openTask(item)"
        >
          <strong>{{ item.title }}</strong>
          <small v-if="devMode">{{ item.task }}</small>
          <span v-if="item.status === 'error'" class="task-error">{{ item.error }}</span>
        </button>
      </aside>

      <section class="steps panel">
        <div class="panel-heading">
          <div><p class="eyebrow">{{ t('review.workflow') }}</p><h2>{{ view?.title ?? t('review.selectTask') }}</h2></div>
          <span>{{ t('common.steps', { count: steps.length }) }}</span>
        </div>
        <div class="step-list">
          <button
            v-for="(item, index) in steps" :key="item.id"
            class="step-row" :class="{ active: selected === index }" @click="selected = index"
          >
            <span class="step-index">{{ String(index + 1).padStart(2, '0') }}</span>
            <span><strong>{{ operationLabel(item.operation) }}</strong><small v-if="devMode">{{ item.id }}</small></span>
            <span class="step-markers">
              <span v-if="item.evidence" class="evidence-dot" :title="t('review.hasEvidence')"></span>
              <span
                v-if="item.referenceImages?.length"
                class="reference-mark"
                :title="t('review.referenceUsed')"
              >▣</span>
              <span
                v-else-if="item.evidence?.reference"
                class="reference-mark available"
                :title="t('review.referenceAvailable')"
              >▢</span>
            </span>
          </button>
        </div>
        <div class="structure-actions">
          <button :disabled="!writable || busy" @click="insertStep">{{ t('review.insert') }}</button>
          <button :disabled="!writable || busy || selected === 0" :title="t('review.moveUp')" @click="move(-1)">↑</button>
          <button :disabled="!writable || busy || selected === steps.length - 1" :title="t('review.moveDown')" @click="move(1)">↓</button>
          <button class="danger" :disabled="!writable || busy || steps.length <= 1" @click="removeStep">{{ t('common.delete') }}</button>
        </div>
      </section>

      <section class="editor panel">
        <div class="panel-heading">
          <div><p class="eyebrow">{{ t('review.stepConfig') }}</p><h2>{{ currentTitle }}</h2></div>
        </div>

        <div class="evidence-viewer" v-if="current?.evidence || displayedReferenceImages.length">
          <div class="evidence-tabs">
            <button
              v-if="current.evidence?.full"
              :class="{ active: evidenceMode === 'full' }"
              @click="evidenceMode = 'full'"
            >{{ t('review.globalImage') }}</button>
            <button
              v-if="current.evidence?.crop"
              :class="{ active: evidenceMode === 'crop' }"
              @click="evidenceMode = 'crop'"
            >{{ t('review.cropImage') }}</button>
            <button
              v-if="!current.evidence?.full && !current.evidence?.crop"
              :class="{ active: evidenceMode === 'placeholder' }"
              @click="evidenceMode = 'placeholder'"
            >{{ t('review.noRecordedImage') }}</button>
            <button
              v-if="displayedReferenceImages.length"
              :class="{ active: evidenceMode === 'reference' }"
              @click="evidenceMode = 'reference'"
            >{{ t('review.referenceImage') }}</button>
            <small v-if="evidenceMode === 'reference'">{{ referenceBindingStatus }}</small>
            <small v-else-if="current.evidence">{{ devMode ? t('review.sourceStep', { step: current.evidence.sourceStep }) : t('review.hasEvidence') }}</small>
            <small v-else>{{ t('review.noIndependentEvidence') }}</small>
          </div>
          <div v-if="evidenceMode === 'reference'" class="reference-gallery">
            <article
              v-for="(image, imageIndex) in displayedReferenceImages"
              :key="`${image.name}:${image.url}`"
              :class="{ 'compatibility-item': multipleReferenceImages }"
            >
              <div class="reference-image-frame">
                <img :src="referenceImageUrl(image)" :alt="t('review.referenceImage')" />
              </div>
              <div class="reference-card-content">
                <div class="reference-card-heading">
                  <strong>{{ multipleReferenceImages ? t('review.referenceImageNumber', { index: imageIndex + 1 }) : t('review.referenceImage') }}</strong>
                  <span class="reference-state" :class="{ bound: referenceImagesBound }">
                    {{ referenceBindingStatus }}
                  </span>
                </div>
                <template v-if="multipleReferenceImages && devMode">
                  <code :title="image.name">{{ image.name }}</code>
                  <code :title="image.url">{{ image.url }}</code>
                </template>
                <p v-if="imageIndex === 0">
                  {{ t('review.referenceHelp') }}
                </p>
                <div v-if="imageIndex === 0" class="reference-actions">
                  <button
                    v-if="referenceImagesBound"
                    class="reference-action secondary"
                    :disabled="Boolean(referenceBindingDisabledReason)"
                    :title="referenceBindingDisabledReason"
                    @click="unbindReferenceImage"
                  >{{ t('review.referenceUnbind') }}</button>
                  <button
                    v-else
                    class="reference-action primary"
                    :disabled="Boolean(referenceBindingDisabledReason)"
                    :title="referenceBindingDisabledReason"
                    @click="bindReferenceImage"
                  >{{ t('review.referenceBind') }}</button>
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
              :alt="t('review.evidenceAlt', { name: current.name })"
            />
          </template>
        </div>
        <div v-else class="evidence-viewer placeholder-only">
          <EvidencePlaceholder />
        </div>

        <div class="form-grid" v-if="current">
          <label>{{ t('review.operation') }}
            <ReviewSelect
              :model-value="editor.operation"
              :aria-label="t('review.operation')"
              :options="operationOptions"
              :disabled="!writable || advancedEditing"
              @change="changeOperation"
            />
          </label>
          <label>{{ t('review.delay') }}
            <input v-model.number="editor.delayMs" type="number" min="0" step="100" :readonly="!writable || advancedEditing" />
          </label>

          <div v-if="editor.custom" class="custom-flow-note wide">
            {{ t('review.customFlow') }}
          </div>

          <template v-else-if="editor.operation === 'click' || editor.operation === 'doubleClick'">
            <label class="wide">{{ t('review.target') }}
              <textarea v-model="editor.target" rows="3" :readonly="!writable || advancedEditing" :placeholder="t('review.targetPlaceholder')"></textarea>
            </label>
          </template>

          <template v-else-if="editor.operation === 'input'">
            <label class="wide">{{ t('review.inputTarget') }}
              <textarea v-model="editor.target" rows="3" :readonly="!writable || advancedEditing" :placeholder="t('review.inputTargetPlaceholder')"></textarea>
            </label>
            <label>{{ t('review.inputMode') }}
              <ReviewSelect
                v-model="editor.inputMode"
                :aria-label="t('review.inputMode')"
                :options="inputModeOptions"
                :disabled="!writable || advancedEditing"
              />
            </label>
            <fieldset class="input-options wide">
              <label class="checkbox">
                <input v-model="editor.parameterized" type="checkbox" :disabled="!writable || advancedEditing" />
                <span>{{ t('review.parameterized') }}</span>
              </label>
              <div v-if="editor.parameterized" class="input-fields">
                <label>{{ t('review.inputLabel') }}<input v-model="editor.inputLabel" :readonly="!writable || advancedEditing" /></label>
                <label>{{ t('review.inputDefault') }}<input v-model="editor.inputDefault" :readonly="!writable || advancedEditing" /></label>
                <label class="wide">{{ t('review.inputDescription') }}<input v-model="editor.inputDescription" :readonly="!writable || advancedEditing" /></label>
              </div>
              <div v-else class="input-fields single-field">
                <label>{{ t('review.inputFixed') }}<input v-model="editor.inputValue" :readonly="!writable || advancedEditing" /></label>
              </div>
            </fieldset>
          </template>

          <template v-else-if="editor.operation === 'keyboard'">
            <label class="wide">{{ t('review.keyName') }}
              <input v-model="editor.keyName" :readonly="!writable || advancedEditing" :placeholder="t('review.keyPlaceholder')" />
            </label>
          </template>

          <template v-else-if="editor.operation === 'wait'">
            <label class="wide">{{ t('review.waitCondition') }}
              <textarea v-model="editor.waitCondition" rows="3" :readonly="!writable || advancedEditing" :placeholder="t('review.waitPlaceholder')"></textarea>
            </label>
            <label>{{ t('review.timeout') }}
              <input v-model.number="editor.timeoutMs" type="number" min="1" step="1000" :readonly="!writable || advancedEditing" />
            </label>
          </template>

          <details v-if="devMode" class="advanced wide" :open="advancedEditing">
            <summary>
              <span><strong>{{ t('review.advanced') }}</strong><small>{{ t('review.advancedHelp') }}</small></span>
              <button v-if="!advancedEditing" type="button" class="text-button" :disabled="!writable" @click.prevent="enableAdvancedEditing">{{ t('review.enableAdvanced') }}</button>
            </summary>
            <div class="advanced-grid">
              <label>{{ t('review.flow') }}
                <textarea
                  :value="advancedEditing ? advancedFlowText : flowPreview"
                  rows="10" spellcheck="false" :readonly="!advancedEditing"
                  @input="advancedFlowText = ($event.target as HTMLTextAreaElement).value"
                ></textarea>
              </label>
              <label>{{ t('review.stepInput') }}
                <textarea
                  :value="advancedEditing ? advancedInputText : parameterPreview"
                  rows="10" spellcheck="false" :readonly="!advancedEditing"
                  @input="advancedInputText = ($event.target as HTMLTextAreaElement).value"
                ></textarea>
              </label>
            </div>
            <div v-if="advancedEditing" class="advanced-actions">
              <span>{{ t('review.advancedPaused') }}</span>
              <button type="button" class="secondary" @click="cancelAdvancedEditing">{{ t('common.cancel') }}</button>
              <button type="button" class="primary" :disabled="!writable" @click="applyAdvancedEditor">{{ t('review.applyAdvanced') }}</button>
            </div>
          </details>
        </div>

        <div class="changes">
          <div class="panel-heading compact"><h3>{{ t('review.changes') }}</h3><span>{{ changes.length }}</span></div>
          <p v-if="!changes.length" class="muted">{{ t('review.noPendingChanges') }}</p>
          <article v-for="(change, index) in changes" :key="index">
            <strong>{{ change.summary }}</strong><span v-if="devMode">{{ change.kind }}</span>
            <small v-if="devMode">{{ change.details.join(' · ') }}</small>
          </article>
        </div>
      </section>
    </main>

    <main v-else-if="mode === 'recordings'" class="workspace recording-layout">
      <RecordingWorkspace :scenes="scenes" @created="openCreatedTask" />
    </main>

    <main v-else-if="mode === 'execution'" class="workspace execution-layout">
      <ExecutionWorkspace
        :scenes="scenes"
        :initial-scene="executionScene || scene"
        :initial-task="executionTask || task"
        :target-version="executionTargetVersion"
        :developer-mode="devMode"
      />
    </main>

    <main v-else-if="mode === 'agent' && devMode" class="workspace agent-layout">
      <AgentWorkspace />
    </main>

    <footer v-if="mode === 'review'"><span :class="{ error: conflict }">{{ status() }}</span><code v-if="devMode">{{ view?.revision }}</code></footer>
  </div>
</template>
