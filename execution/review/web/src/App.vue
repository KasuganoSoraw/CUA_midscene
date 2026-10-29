<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue';
import type { JsonObject, SkillCatalogItem, SkillTaskManifest } from '../../../cua/contracts/types';
import type {
  ReviewChange,
  ReviewEvidence,
  ReviewMutation,
  ReviewOperation,
  ReviewReferenceImage,
  ReviewStep,
  ReviewTaskDraft,
  ReviewSkillView,
} from '../../shared/types';
import {
  buildStepContent,
  defaultStepEditor,
  inputPreview,
  parseInputPreview,
  parseStepEditor,
  referenceImagesFromFlow,
  type StepEditorModel,
} from '../../shared/step-editor';
import { sourceStepsForBinding } from '../../shared/step-bindings';
import { ApiError, api } from './api';
import { ReviewDraftStorage } from './draft-storage';
import { resolveEvidenceMode, type EvidenceMode } from './evidence-mode';
import { referenceImageMaxBytes, referenceImageMimeTypes } from '../../shared/reference-upload';
import { useI18n, type MessageKey } from './i18n';
import AgentWorkspace from './components/AgentWorkspace.vue';
import EvidencePlaceholder from './components/EvidencePlaceholder.vue';
import ExecutionWorkspace from './components/ExecutionWorkspace.vue';
import RecordingWorkspace from './components/RecordingWorkspace.vue';
import ReviewSelect, { type ReviewSelectOption } from './components/ReviewSelect.vue';
import ReviewSwitch from './components/ReviewSwitch.vue';
import ConfirmDialog from './components/ConfirmDialog.vue';
import TaskCatalog from './components/TaskCatalog.vue';
import WorkbenchIcon from './components/WorkbenchIcon.vue';
import uploadPlaceholder from './assets/ucd/IllHdEmptyNoRecord.svg';
import actionInfoIcon from './assets/ucd/action-info.svg';
import waitInfoIcon from './assets/ucd/wait-info.svg';

const { locale, t, setLocale } = useI18n();

const initialParams = new URLSearchParams(window.location.search);
const requestedMode = initialParams.get('mode');
const requestedDevMode = initialParams.get('dev') === '1';
let initialMode: 'review' | 'recordings' | 'execution' = 'review';
if (requestedMode === 'recording') initialMode = 'recordings';
else if (requestedMode === 'execution') initialMode = 'execution';
const initialSkillName = initialParams.get('skillName')?.trim() ?? '';

const mode = ref<'review' | 'recordings' | 'execution' | 'agent'>(initialMode);
const devMode = ref(false);
const skills = ref<SkillCatalogItem[]>([]);
const skillsConfigured = ref(false);
const catalogError = ref('');
const skillName = ref(initialSkillName);
const executionSkillName = ref(initialMode === 'execution' ? initialSkillName : '');
const executionTargetVersion = ref(0);
function operationLabel(operation: ReviewOperation): string {
  return t(`review.operation.${operation}` as MessageKey);
}

const operationOptions = computed<ReviewSelectOption[]>(() => [
  { value: 'click', label: operationLabel('click') },
  { value: 'doubleClick', label: operationLabel('doubleClick') },
  { value: 'rightClick', label: operationLabel('rightClick') },
  { value: 'input', label: operationLabel('input') },
  { value: 'keyboard', label: operationLabel('keyboard') },
  { value: 'wait', label: operationLabel('wait') },
  { value: 'aiAct', label: operationLabel('aiAct') },
]);
const inputModeOptions = computed<ReviewSelectOption[]>(() => [
  { value: 'replace', label: t('review.inputReplace') },
  { value: 'append', label: t('review.inputAppend') },
]);
const view = ref<ReviewSkillView>();
const draft = ref<ReviewTaskDraft<SkillTaskManifest>>();
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
const taskDeleteOpen = ref(false);
const draftDiscardOpen = ref(false);
const dragIndex = ref<number>();
const referenceFileInput = ref<HTMLInputElement>();
const referenceUploading = ref(false);
const referenceUploadError = ref('');
const requestedEvidenceMode = ref<EvidenceMode>('full');
const selectedEvidenceSource = ref<number>();
const evidenceBySource = new Map<number, ReviewEvidence>();
let hydratingEditor = false;
let draftStorage: ReviewDraftStorage<SkillTaskManifest> | undefined;
let loadingDraft = false;
let editorDrafts: Record<string, StepEditorModel> = {};
const draftStorageState = ref<'idle' | 'saved' | 'error'>('idle');
const draftStorageError = ref('');
const baseRevision = ref('');

function persistDraft(): void {
  if (!draft.value || !view.value?.writable || !dirty.value || hydratingEditor || loadingDraft) return;
  try {
    if (!draftStorage) throw new Error(t('review.autoSaveUnavailable'));
    draftStorage.write('skill', view.value.skillName, {
      version: 1, revision: baseRevision.value, draft: clone(draft.value),
      changes: clone(changes.value), selected: selected.value, editor: clone(editor),
      editors: clone(editorDrafts),
    });
    draftStorageState.value = 'saved';
    draftStorageError.value = '';
  } catch (error) {
    draftStorageState.value = 'error';
    draftStorageError.value = error instanceof Error ? error.message : String(error);
  }
}

watch(mode, (next) => {
  const url = new URL(window.location.href);
  url.searchParams.set('mode', next === 'recordings' ? 'recording' : next);
  window.history.replaceState(null, '', url);
});

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

const current = computed(() => steps.value[selected.value]);
const currentEvidence = computed(() => devMode.value
  ? current.value?.evidences?.find(item => item.sourceStep === selectedEvidenceSource.value) ?? current.value?.evidence
  : current.value?.evidence);
const evidenceMode = computed({
  get: () => resolveEvidenceMode(requestedEvidenceMode.value, editor.operation, currentEvidence.value),
  set: (value: EvidenceMode) => { requestedEvidenceMode.value = value; },
});
const currentTitle = computed(() => current.value
  ? t('review.stepTitle', { index: selected.value + 1, operation: operationLabel(current.value.operation) })
  : t('review.noStep'));
const writable = computed(() => Boolean(view.value?.writable));
const referenceImageCandidate = computed<ReviewReferenceImage | undefined>(() => {
  if (editor.referenceCandidate) return editor.referenceCandidate;
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
const referenceCapable = computed(() => ['click', 'doubleClick', 'rightClick', 'aiAct'].includes(editor.operation));
const referenceBindingStatus = computed(() => {
  if (multipleReferenceImages.value) return t('review.referenceMultiple', { count: editor.referenceImages.length });
  return referenceImagesBound.value ? t('review.referenceBound') : t('review.referenceAvailableStatus');
});
const referenceBindingDisabledReason = computed<string | undefined>(() => {
  if (conflict.value) return t('review.referenceConflict');
  if (!writable.value) return t('review.referenceReadonly');
  if (busy.value) return t('review.referenceBusy');
  if (advancedEditing.value) return t('review.referenceAdvanced');
  if (editor.custom) return t('review.referenceCustom');
  if (!referenceCapable.value) {
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
const referenceUploadDisabled = computed(() => !writable.value || busy.value || conflict.value || advancedEditing.value
  || editor.custom || multipleReferenceImages.value || !referenceCapable.value);
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
    const match = /^(step-\d{3,}) \| (click|doubleClick|rightClick|input|keyboard|wait|aiAct)$/.exec(name);
    const id = match?.[1] ?? `step-${String(index + 1).padStart(3, '0')}`;
    const operation = (match?.[2] ?? 'click') as ReviewOperation;
    const flow = clone(item.flow as JsonObject[]);
    const referenceImages = referenceImagesFromFlow(flow, operation);
    const sourceSteps = sourceStepsForBinding(bindings[id]);
    const evidences = sourceSteps.flatMap(sourceStep => {
      const evidence = evidenceBySource.get(sourceStep);
      return evidence ? [evidence] : [];
    });
    const evidence = evidences.at(-1);
    return {
      id,
      name,
      operation,
      flow,
      ...(draft.value!.manifest.inputs[`${id}-input`] ? { input: clone(draft.value!.manifest.inputs[`${id}-input`]) } : {}),
      ...(evidence ? { evidence } : {}),
      ...(evidences.length ? { evidences } : {}),
      ...(referenceImages.length ? { referenceImages } : {}),
    };
  });
  if (selected.value >= steps.value.length) selected.value = steps.value.length - 1;
}

function populateEditor(): void {
  const step = current.value;
  if (!step) return;
  selectedEvidenceSource.value = undefined;
  referenceUploadError.value = '';
  hydratingEditor = true;
  delete editor.referenceCandidate;
  Object.assign(editor, parseStepEditor(step));
  if (editorDrafts[step.id]) Object.assign(editor, clone(editorDrafts[step.id]));
  advancedEditing.value = false;
  advancedFlowText.value = JSON.stringify(step.flow, null, 2);
  advancedInputText.value = JSON.stringify(inputPreview(step.id, step.input), null, 2);
  evidenceMode.value = resolveEvidenceMode('crop', editor.operation, step.evidence);
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

watch(selected, () => { populateEditor(); persistDraft(); }, { flush: 'sync' });
watch(editor, () => {
  if (!hydratingEditor && !advancedEditing.value) syncSemanticDraft();
}, { deep: true, flush: 'sync' });

async function loadSkills(): Promise<void> {
  busy.value = true;
  try {
    const result = await api.skills();
    skills.value = result.skills;
    skillsConfigured.value = result.configured;
    catalogError.value = result.error ?? '';
    const ready = skills.value.filter(item => item.status === 'ready');
    if (!ready.some(item => item.skillName === skillName.value)) skillName.value = ready[0]?.skillName ?? '';
    if (skillName.value) await loadTask();
    else {
      clearTaskView();
      status.value = () => result.error ?? '';
    }
  } catch (error) {
    skills.value = [];
    skillName.value = '';
    clearTaskView();
    const text = error instanceof Error ? error.message : String(error);
    catalogError.value = text;
    status.value = () => text;
  } finally { busy.value = false; }
}

async function openCreatedTask(result: { skillName: string }): Promise<void> {
  skillName.value = result.skillName;
  mode.value = 'review';
  await loadSkills();
}

async function openCatalogTask(name: string): Promise<void> {
  if (busy.value) return;
  skillName.value = name;
  await loadTask();
}

function restoreStoredDraft(loaded: ReviewSkillView): void {
  try {
    const stored = draftStorage?.read('skill', loaded.skillName);
    if (stored) {
      if (stored.draft.manifest.skillName !== loaded.skillName) throw new Error(t('review.autoSaveUnavailable'));
      editorDrafts = stored.editors ?? {};
      draft.value = stored.draft;
      changes.value = stored.changes;
      baseRevision.value = stored.revision;
      selected.value = Math.max(0, Math.min(stored.selected, (stored.draft.document.tasks as JsonObject[]).length - 1));
      rebuildSteps();
      populateEditor();
      hydratingEditor = true;
      Object.assign(editor, stored.editor);
      hydratingEditor = false;
      draftStorageState.value = 'saved';
      conflict.value = stored.revision !== loaded.revision;
    }
  } catch (error) {
    draftStorageState.value = 'error';
    draftStorageError.value = error instanceof Error ? error.message : String(error);
  }
}

async function loadTask(restoreDraft = true): Promise<void> {
  if (!skillName.value) return;
  busy.value = true;
  loadingDraft = true;
  conflict.value = false;
  try {
    const loaded = await api.skill(skillName.value);
    view.value = loaded;
    editorDrafts = {};
    baseRevision.value = loaded.revision;
    draft.value = { manifest: clone(loaded.manifest), document: clone(loaded.document) };
    evidenceBySource.clear();
    loaded.steps.forEach((item) => {
      for (const evidence of item.evidences ?? (item.evidence ? [item.evidence] : [])) {
        evidenceBySource.set(evidence.sourceStep, evidence);
      }
    });
    changes.value = [];
    selected.value = 0;
    rebuildSteps();
    populateEditor();
    draftStorageState.value = 'idle';
    draftStorageError.value = '';
    if (loaded.writable && restoreDraft) restoreStoredDraft(loaded);
    if (mode.value === 'review') {
      const url = new URL(window.location.href);
      url.searchParams.delete('scene');
      url.searchParams.delete('task');
      url.searchParams.set('skillName', loaded.skillName);
      window.history.replaceState(null, '', url);
    }
    status.value = loaded.writable ? () => t('review.ready') : () => t('review.readonlyStatus');
  } catch (error) {
    clearTaskView();
    const text = error instanceof Error ? error.message : String(error);
    status.value = () => text;
  } finally { loadingDraft = false; busy.value = false; }
}

async function mutate(mutation: ReviewMutation): Promise<boolean> {
  if (!draft.value || !writable.value || busy.value) return false;
  const candidates = steps.value.map(item => editorDrafts[item.id]?.referenceCandidate);
  if (current.value) candidates[selected.value] = editor.referenceCandidate;
  if (mutation.type === 'insert') candidates.splice(mutation.index, 0, undefined);
  else if (mutation.type === 'remove') candidates.splice(mutation.index, 1);
  else if (mutation.type === 'move') candidates.splice(mutation.to, 0, ...candidates.splice(mutation.from, 1));
  busy.value = true;
  try {
    const result = await api.mutateSkill(skillName.value, draft.value, mutation);
    editorDrafts = {};
    draft.value = result.draft;
    changes.value.push(result.change);
    rebuildSteps();
    steps.value.forEach((item, index) => {
      if (candidates[index]) editorDrafts[item.id] = { ...parseStepEditor(item), referenceCandidate: clone(candidates[index]) };
    });
    populateEditor();
    persistDraft();
    status.value = () => t('review.draftValidated');
    return true;
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    status.value = () => text;
    return false;
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
  editorDrafts[step.id] = clone(editor);
  persistDraft();
}

function changeOperation(value: string): void {
  const next = value as ReviewOperation;
  if (next === editor.operation) return;
  const nextEditor = defaultStepEditor(next, editor.delayMs);
  hydratingEditor = true;
  delete editor.referenceCandidate;
  Object.assign(editor, nextEditor);
  hydratingEditor = false;
  syncSemanticDraft();
  evidenceMode.value = resolveEvidenceMode('crop', next, current.value?.evidence);
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
  if (await mutate({ type: 'insert', index, step: { operation: 'click', flow: [{ aiTap: t('review.defaultClickTarget') }] } })) {
    selected.value = index;
    populateEditor();
  }
}

async function removeStep(index: number): Promise<void> {
  if (await mutate({ type: 'remove', index })) selected.value = Math.min(index, steps.value.length - 1);
}

async function dropStep(index: number): Promise<void> {
  const from = dragIndex.value;
  dragIndex.value = undefined;
  if (from === undefined || from === index || busy.value || !writable.value) return;
  if (await mutate({ type: 'move', from, to: index })) selected.value = index;
}

function startStepDrag(event: DragEvent, index: number): void {
  if (busy.value || !writable.value || advancedEditing.value) { event.preventDefault(); return; }
  dragIndex.value = index;
  if (event.dataTransfer) {
    event.dataTransfer.effectAllowed = 'move';
    event.dataTransfer.setData('text/plain', String(index));
  }
}

async function save(): Promise<boolean> {
  if (!draft.value || !view.value) return false;
  if (!dirty.value) return true;
  const selectedIndex = selected.value;
  busy.value = true;
  try {
    const result = await api.saveSkill(skillName.value, baseRevision.value, clone(draft.value));
    try { draftStorage?.remove('skill', view.value.skillName); } catch { /* Saved task files remain authoritative. */ }
    changes.value = [];
    await loadTask(false);
    skills.value = skills.value.map(item => item.status === 'ready' && item.skillName === skillName.value
      ? { ...item, taskCount: steps.value.length, actionCount: steps.value.reduce((count, step) => count + step.flow.length, 0) }
      : item);
    selected.value = Math.min(selectedIndex, steps.value.length - 1);
    populateEditor();
    status.value = () => t('review.saved', { files: result.changed.join(', ') || t('review.noChanges') });
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
  executionSkillName.value = skillName.value;
  executionTargetVersion.value += 1;
  mode.value = 'execution';
}

async function reloadTask(): Promise<void> {
  if (!view.value) return;
  try {
    draftStorage?.remove('skill', view.value.skillName);
    await loadTask();
  } catch (error) {
    const text = error instanceof Error ? error.message : String(error);
    status.value = () => text;
  } finally {
    draftDiscardOpen.value = false;
  }
}

function requestTaskDeletion(): void {
  if (!view.value?.writable || busy.value) return;
  taskDeleteOpen.value = true;
}

async function confirmTaskDeletion(): Promise<void> {
  if (!view.value?.writable || busy.value) return;
  const deletedSkill = skillName.value;
  busy.value = true;
  conflict.value = false;
  try {
    await api.deleteSkill(deletedSkill);
    try { draftStorage?.remove('skill', deletedSkill); } catch { /* Deleted task drafts are not restored without a task. */ }
    taskDeleteOpen.value = false;
    skillName.value = '';
    clearTaskView();
    await loadSkills();
    status.value = () => t('review.skillDeleted', { name: deletedSkill });
  } catch (error) {
    taskDeleteOpen.value = false;
    const text = error instanceof Error ? error.message : String(error);
    status.value = () => text;
  } finally {
    busy.value = false;
  }
}

function evidencePath(step: ReviewStep | undefined): string | undefined {
  const evidence = step === current.value ? currentEvidence.value : step?.evidence;
  return evidenceMode.value === 'crop' ? evidence?.crop ?? evidence?.full : evidence?.full ?? evidence?.crop;
}

function referenceImageUrl(image: ReviewReferenceImage): string {
  return /^(?:https?:|data:)/i.test(image.url)
    ? image.url
    : api.skillEvidenceUrl(skillName.value, image.url);
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
  editor.referenceCandidate = clone(editor.referenceImages[0]);
  editor.referenceImages = [];
  editor.convertHttpImage2Base64 = false;
}

async function uploadReference(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement;
  const file = input.files?.[0];
  input.value = '';
  referenceUploadError.value = '';
  if (!file || referenceUploadDisabled.value) return;
  if (!referenceImageMimeTypes.includes(file.type as typeof referenceImageMimeTypes[number])) {
    referenceUploadError.value = t('review.referenceFormatError');
    return;
  }
  if (!file.size || file.size > referenceImageMaxBytes) {
    referenceUploadError.value = t('review.referenceSizeError');
    return;
  }
  const targetSkill = skillName.value;
  const targetStep = current.value?.id;
  if (!targetStep) return;
  busy.value = true;
  referenceUploading.value = true;
  try {
    const result = await api.uploadSkillReferenceImage(targetSkill, baseRevision.value, file);
    if (skillName.value !== targetSkill || current.value?.id !== targetStep) {
      throw new Error(t('review.referenceTargetChanged'));
    }
    hydratingEditor = true;
    editor.referenceCandidate = clone(result.image);
    editor.referenceImages = [clone(result.image)];
    editor.convertHttpImage2Base64 = false;
    hydratingEditor = false;
    syncSemanticDraft();
    evidenceMode.value = 'reference';
    status.value = () => t('review.referenceUploaded');
  } catch (error) {
    conflict.value = error instanceof ApiError && error.status === 409;
    referenceUploadError.value = error instanceof Error ? error.message : String(error);
  } finally {
    hydratingEditor = false;
    referenceUploading.value = false;
    busy.value = false;
  }
}

onMounted(async () => {
  try {
    const identity = await api.reviewIdentity();
    devMode.value = requestedDevMode && identity.devMode;
    draftStorage = new ReviewDraftStorage<SkillTaskManifest>(window.localStorage, `${identity.dataRootKey}:${identity.skillsRootKey ?? 'unconfigured'}`);
  } catch (error) {
    draftStorageState.value = 'error';
    draftStorageError.value = error instanceof Error ? error.message : String(error);
  }
  await loadSkills();
  if (devMode.value && requestedMode === 'agent') mode.value = 'agent';
});
</script>

<template>
  <div class="shell">
    <header class="topbar">
      <h1 class="sr-only">{{ t('app.title') }}</h1>
    <nav class="mode-tabs" :aria-label="t('app.navLabel')">
      <button :class="{ active: mode === 'recordings' }" @click="mode = 'recordings'">{{ t('app.mode.recordings') }}</button>
      <button :class="{ active: mode === 'review' }" @click="mode = 'review'">{{ t('app.mode.review') }}</button>
      <button :class="{ active: mode === 'execution' }" @click="mode = 'execution'">{{ t('app.mode.execution') }}</button>
      <button v-if="devMode" :class="{ active: mode === 'agent' }" @click="mode = 'agent'">{{ t('app.mode.agent') }}</button>
    </nav>
      <div class="topbar-right">
        <div class="language-switch" role="group" :aria-label="t('app.language')">
          <button :class="{ active: locale === 'zh-CN' }" @click="setLocale('zh-CN')">中文</button>
          <button :class="{ active: locale === 'en-US' }" @click="setLocale('en-US')">EN</button>
        </div>
        <div v-if="mode === 'review'" class="top-actions">
          <span v-if="view" class="status-chip" :class="{ readonly: !writable }">{{ writable ? t('review.writable') : t('review.readonly') }}</span>
          <button class="secondary" :disabled="busy || !view" @click="runCurrentTask">{{ dirty && writable ? t('review.saveAndRun') : t('review.runTask') }}</button>
          <button v-if="view?.writable" class="destructive" :disabled="busy" @click="requestTaskDeletion">{{ t('review.deleteTask') }}</button>
          <button class="primary" :disabled="busy || !dirty || !writable || conflict || advancedEditing" @click="save">{{ t('review.save') }}</button>
        </div>
        <div v-else-if="mode === 'recordings'" class="top-actions">
          <span class="status-chip">{{ t('recording.modeStatus') }}</span>
        </div>
        <div v-else-if="mode === 'execution'" class="top-actions"><span class="status-chip">{{ t('execution.modeStatus') }}</span></div>
        <div v-else class="top-actions"><span class="status-chip">{{ t('agent.modeStatus') }}</span></div>
      </div>
    </header>


    <div v-if="mode === 'review' && conflict" class="conflict">
      {{ t('review.conflict') }}
      <button @click="draftDiscardOpen = true">{{ t('review.reload') }}</button>
    </div>

    <main v-if="mode === 'review' && !busy && !skills.length" class="panel review-empty" aria-live="polite">
      <h2>{{ t('review.emptyTitle') }}</h2>
      <p>{{ catalogError || t('review.emptyHelp') }}</p>
      <button class="primary" @click="mode = 'recordings'">{{ t('review.createFromRecording') }}</button>
    </main>

    <main v-else-if="mode === 'review'" class="workspace review-layout">
      <TaskCatalog :skills="skills" :skill-name="skillName" :busy="busy" :current-step-count="steps.length" @select="openCatalogTask" @create="mode = 'recordings'" />
      <section class="steps panel">
        <div class="review-steps-heading"><h2>{{ t('review.workflow') }}</h2><div><span>{{ view?.title ?? t('review.selectTask') }}</span><small>{{ t('common.steps', { count: steps.length }) }}</small></div></div>
        <button class="secondary add-step" :disabled="!writable || busy" @click="insertStep"><WorkbenchIcon name="add" />{{ t('review.insert') }}</button>
        <div class="step-list">
          <div v-for="(item, index) in steps" :key="item.id" class="step-row"
            :class="{ active: selected === index, dragging: dragIndex === index }"
            :draggable="writable && !busy && !advancedEditing" @dragstart="startStepDrag($event, index)" @dragend="dragIndex = undefined" @dragover.prevent @drop.prevent="dropStep(index)">
            <span class="drag-handle" :title="t('review.dragStep')"><WorkbenchIcon name="grip" /></span>
            <button class="step-select" :disabled="busy" @click="selected = index">
              <span class="step-index">{{ index + 1 }}</span><span class="step-label">{{ operationLabel(item.operation) }}</span>
              <span v-if="item.evidence" class="evidence-dot" :title="t('review.hasEvidence')"></span>
              <WorkbenchIcon v-if="item.referenceImages?.length" name="image" class="reference-mark" :title="t('review.referenceUsed')" />
            </button>
            <button class="step-delete" :disabled="!writable || busy || steps.length <= 1" :aria-label="t('review.deleteStep', { index: index + 1 })" @click="removeStep(index)"><WorkbenchIcon name="trash" /></button>
          </div>
        </div>
      </section>

      <section class="editor panel">
        <header class="review-editor-heading">
          <h2>{{ currentTitle }}</h2>
          <div v-if="current" class="step-provenance"><span><i class="evidence-dot" :class="{ manual: !current.evidence }"></i>{{ current.evidence ? t('review.recordedStep') : t('review.manualStep') }}</span><span v-if="referenceCapable"><WorkbenchIcon name="image" />{{ referenceImagesBound ? t('review.referenceEnabled') : t('review.referenceDisabled') }}</span></div>
        </header>
        <section v-if="current" class="step-evidence">
          <input ref="referenceFileInput" hidden type="file" tabindex="-1" accept="image/png,image/jpeg,image/webp" :disabled="referenceUploadDisabled" @change="uploadReference" />
          <div v-if="devMode && current.evidences && current.evidences.length > 1" class="evidence-tabs" :aria-label="t('review.sourceEvidence')">
            <button v-for="evidence in current.evidences" :key="evidence.sourceStep" :class="{ active: currentEvidence?.sourceStep === evidence.sourceStep }" @click="selectedEvidenceSource = evidence.sourceStep">{{ t('review.recordedSourceStep', { index: evidence.sourceStep }) }}</button>
          </div>
          <div class="evidence-tabs">
            <button v-if="currentEvidence?.full" :class="{ active: evidenceMode === 'full' }" @click="evidenceMode = 'full'">{{ t('review.globalImage') }}</button>
            <button v-if="currentEvidence?.crop" :class="{ active: evidenceMode === 'crop' }" @click="evidenceMode = 'crop'">{{ t('review.cropImage') }}</button>
            <button v-if="referenceCapable && displayedReferenceImages.length" :class="{ active: evidenceMode === 'reference' }" @click="evidenceMode = 'reference'">{{ t('review.referenceImage') }}</button>
            <span>{{ evidenceMode === 'reference' ? t('review.referenceImage') : t('review.recordedImage') }}</span>
          </div>
          <div v-if="evidenceMode === 'reference'" class="reference-gallery">
            <article v-for="(image, imageIndex) in displayedReferenceImages" :key="`${image.name}:${image.url}`">
              <div class="reference-image-frame"><img :src="referenceImageUrl(image)" :alt="t('review.referenceImage')" />
                <button v-if="imageIndex === 0" class="secondary reference-replace" :disabled="referenceUploadDisabled" @click="referenceFileInput?.click()"><WorkbenchIcon name="add" />{{ referenceUploading ? t('review.referenceUploading') : t('review.replaceReference') }}</button>
              </div>
              <div class="reference-card-content">
                <label v-if="imageIndex === 0" class="reference-switch-label">{{ t('review.enableReference') }}
                  <button type="button" class="reference-switch" role="switch" :aria-label="t('review.enableReference')" :aria-checked="referenceImagesBound" :disabled="Boolean(referenceBindingDisabledReason)" :title="referenceBindingDisabledReason" @click="referenceImagesBound ? unbindReferenceImage() : bindReferenceImage()"><span></span></button>
                </label>
                <p v-if="imageIndex === 0">{{ t('review.referenceHelp') }}</p>
                <small v-if="imageIndex === 0 && referenceBindingDisabledReason && !conflict" class="reference-disabled-reason">{{ referenceBindingDisabledReason }}</small>
                <code v-if="multipleReferenceImages && devMode">{{ image.name }}</code>
              </div>
            </article>
            <article v-if="!displayedReferenceImages.length">
              <button class="reference-image-frame reference-empty reference-upload" :disabled="referenceUploadDisabled" @click="referenceFileInput?.click()"><img class="upload-placeholder" :src="uploadPlaceholder" alt="" aria-hidden="true" /><span>{{ referenceUploading ? t('review.referenceUploading') : t('review.uploadReference') }}</span></button>
              <div class="reference-card-content"><label class="reference-switch-label">{{ t('review.enableReference') }}<button class="reference-switch" role="switch" :aria-label="t('review.enableReference')" :aria-checked="false" disabled><span></span></button></label><p>{{ t('review.referenceHelp') }}</p></div>
            </article>
          </div>
          <div v-else class="recorded-image-frame" :class="{ 'is-placeholder': !evidencePath(current) }">
            <img v-if="evidencePath(current)" :src="api.skillEvidenceUrl(skillName, evidencePath(current)!)" :alt="t('review.evidenceAlt', { name: current.name })" />
            <EvidencePlaceholder v-else />
          </div>
          <p v-if="referenceUploadError" class="inline-error" role="alert">{{ referenceUploadError }}</p>
          <p v-if="conflict && (editor.operation === 'click' || editor.operation === 'doubleClick' || editor.operation === 'rightClick')" class="inline-error" role="alert">
            {{ t('review.referenceConflict') }}
            <button type="button" class="text-button" @click="draftDiscardOpen = true">{{ t('review.reload') }}</button>
          </p>
        </section>
        <h3 v-if="current" class="action-config-title">{{ t('review.actionConfig') }}</h3>

        <div class="form-grid" v-if="current">
          <label><span class="field-label">{{ t('review.operation') }}<img :src="actionInfoIcon" :title="t('review.operationHelp')" alt="" /></span>
            <ReviewSelect
              :model-value="editor.operation"
              :aria-label="t('review.operation')"
              :options="operationOptions"
              :disabled="busy || !writable || advancedEditing"
              @change="changeOperation"
            />
          </label>
          <label>{{ t('review.delay') }}
            <input v-model.number="editor.delayMs" type="number" min="0" step="100" :readonly="busy || !writable || advancedEditing" />
          </label>

          <div v-if="editor.custom" class="custom-flow-note wide">
            {{ t('review.customFlow') }}
          </div>

          <template v-else-if="editor.operation === 'click' || editor.operation === 'doubleClick' || editor.operation === 'rightClick' || editor.operation === 'aiAct'">
            <label class="wide">{{ editor.operation === 'aiAct' ? t('review.actionPrompt') : t('review.target') }}
              <textarea v-model="editor.target" rows="3" :readonly="busy || !writable || advancedEditing" :placeholder="t('review.targetPlaceholder')"></textarea>
            </label>
          </template>

          <template v-else-if="editor.operation === 'input'">
            <label class="wide">{{ t('review.inputTarget') }}
              <textarea v-model="editor.target" rows="3" :readonly="busy || !writable || advancedEditing" :placeholder="t('review.inputTargetPlaceholder')"></textarea>
            </label>
            <label>{{ t('review.inputMode') }}
              <ReviewSelect
                v-model="editor.inputMode"
                :aria-label="t('review.inputMode')"
                :options="inputModeOptions"
                :disabled="busy || !writable || advancedEditing"
              />
            </label>
            <fieldset class="input-options wide">
              <div class="runtime-input-toggle">
                <span>{{ t('review.parameterized') }}</span>
                <ReviewSwitch
                  v-model="editor.parameterized"
                  :label="t('review.parameterized')"
                  :disabled="busy || !writable || advancedEditing"
                />
              </div>
              <div v-if="editor.parameterized" class="input-fields">
                <label>{{ t('review.inputLabel') }}<input v-model="editor.inputLabel" :readonly="busy || !writable || advancedEditing" /></label>
                <label>{{ t('review.inputDefault') }}<input v-model="editor.inputDefault" :readonly="busy || !writable || advancedEditing" /></label>
                <label class="wide">{{ t('review.inputDescription') }}<input v-model="editor.inputDescription" :readonly="busy || !writable || advancedEditing" /></label>
              </div>
              <div v-else class="input-fields single-field">
                <label>{{ t('review.inputFixed') }}<input v-model="editor.inputValue" :readonly="busy || !writable || advancedEditing" /></label>
              </div>
            </fieldset>
          </template>

          <template v-else-if="editor.operation === 'keyboard'">
            <label class="wide">{{ t('review.keyName') }}
              <input v-model="editor.keyName" :readonly="busy || !writable || advancedEditing" :placeholder="t('review.keyPlaceholder')" />
            </label>
          </template>

          <div v-else-if="editor.operation === 'wait'" class="wait-fields wide">
            <label><span class="field-label">{{ t('review.waitCondition') }}<img :src="waitInfoIcon" :title="t('review.waitConditionHelp')" alt="" /></span>
              <textarea v-model="editor.waitCondition" rows="3" :readonly="busy || !writable || advancedEditing" :placeholder="t('review.waitPlaceholder')" :aria-description="t('review.waitConditionHelp')"></textarea>
            </label>
            <label :title="t('review.timeoutHelp')">{{ t('review.timeout') }}
              <input v-model.number="editor.timeoutMs" type="number" min="1" step="1000" :readonly="busy || !writable || advancedEditing" :aria-description="t('review.timeoutHelp')" />
            </label>
          </div>

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
          <p v-if="draftStorageState === 'saved' && dirty" class="draft-storage-status" role="status">{{ t('review.autoSaved') }}</p>
          <p v-if="draftStorageState === 'error'" class="inline-error" role="alert">{{ t('review.autoSaveFailed', { error: draftStorageError }) }}</p>
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
      <RecordingWorkspace :skills-configured="skillsConfigured" @created="openCreatedTask" />
    </main>

    <main v-else-if="mode === 'execution'" class="workspace execution-layout">
      <ExecutionWorkspace
        :skills="skills"
        :initial-skill-name="executionSkillName || skillName"
        :target-version="executionTargetVersion"
        :developer-mode="devMode"
        @create="mode = 'recordings'"
      />
    </main>

    <main v-else-if="mode === 'agent' && devMode" class="workspace agent-layout">
      <AgentWorkspace />
    </main>

    <ConfirmDialog
      :open="draftDiscardOpen"
      :title="t('review.discardTitle')"
      :message="t('review.discardDraft')"
      :target="skillName"
      :confirm-label="t('review.reload')"
      :cancel-label="t('common.cancel')"
      :busy="busy"
      @confirm="reloadTask"
      @cancel="draftDiscardOpen = false"
    />

    <ConfirmDialog
      :open="taskDeleteOpen"
      :title="t('review.deleteTaskTitle')"
      :message="t('review.deleteTaskMessage')"
      :target="skillName"
      :confirm-label="t('review.deleteTask')"
      :cancel-label="t('common.cancel')"
      :busy="busy"
      @confirm="confirmTaskDeletion"
      @cancel="taskDeleteOpen = false"
    />

    <footer v-if="mode === 'review' && skills.length"><span :class="{ error: conflict }">{{ status() }}</span><code v-if="devMode">{{ view?.revision }}</code></footer>
  </div>
</template>
