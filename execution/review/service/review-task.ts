import { createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import type { JsonObject, ProcessedLogStep, ShowuiTrace, TaskCatalogRoots, TaskManifest } from '../../cua/contracts/types.js';
import { readProcessedLog, readShowuiTrace, readTaskManifest } from '../../cua/contracts/validation.js';
import { describeTask } from '../../cua/task/tasks.js';
import { readYamlDocument } from '../../cua/task/yaml-task.js';
import type { ReviewEvidence, ReviewOperation, ReviewStep, ReviewTaskView } from '../shared/types.js';

const stepNamePattern = /^(step-(\d{3,})) \| (click|doubleClick|input|keyboard|wait)$/;

export function reviewRevision(taskJson: string | Buffer, taskYaml: string | Buffer): string {
  return `sha256:${createHash('sha256').update(taskJson).update('\0').update(taskYaml).digest('hex')}`;
}

function assertInside(parent: string, target: string, label: string): string {
  const root = path.resolve(parent);
  const absolute = path.resolve(target);
  const relative = path.relative(root, absolute);
  if (relative.startsWith('..') || path.isAbsolute(relative)) throw new Error(`${label} 越出任务 source 目录：${target}`);
  return absolute;
}

function sourceAsset(taskRoot: string, sourceRoot: string, reference: unknown): string | undefined {
  if (typeof reference !== 'string' || !reference.trim()) return undefined;
  const absolute = assertInside(sourceRoot, path.resolve(sourceRoot, reference), '证据路径');
  return path.relative(taskRoot, absolute).replaceAll('\\', '/');
}

function evidenceFor(
  sourceStep: number,
  processedByStep: Map<number, ProcessedLogStep>,
  taskRoot: string,
  sourceRoot: string,
): ReviewEvidence | undefined {
  const item = processedByStep.get(sourceStep);
  if (!item) return undefined;
  return {
    sourceStep,
    timestamp: item.timestamp,
    ...(sourceAsset(taskRoot, sourceRoot, item.screenshot_full) ? { full: sourceAsset(taskRoot, sourceRoot, item.screenshot_full) } : {}),
    ...(sourceAsset(taskRoot, sourceRoot, item.screenshot_crop) ? { crop: sourceAsset(taskRoot, sourceRoot, item.screenshot_crop) } : {}),
  };
}

async function readRecording(taskRoot: string, manifest: TaskManifest): Promise<{
  trace?: ShowuiTrace;
  processed?: ProcessedLogStep[];
  sourceRoot: string;
}> {
  const sourceRoot = path.join(taskRoot, 'source');
  try {
    const tracePath = assertInside(sourceRoot, path.resolve(taskRoot, manifest.source.tracePath), 'tracePath');
    const processedPath = assertInside(sourceRoot, path.resolve(taskRoot, manifest.source.processedLogPath), 'processedLogPath');
    await Promise.all([stat(tracePath), stat(processedPath)]);
    const [trace, processed] = await Promise.all([readShowuiTrace(tracePath), readProcessedLog(processedPath)]);
    return { trace, processed, sourceRoot };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return { sourceRoot };
    throw error;
  }
}

function effectiveBindings(manifest: TaskManifest, tasks: JsonObject[], trace?: ShowuiTrace): Record<string, number | null> {
  if (manifest.source.stepBindings) return { ...manifest.source.stepBindings };
  if (!trace || trace.trajectory.length !== tasks.length) return {};
  return Object.fromEntries(tasks.map((task, index) => {
    const match = stepNamePattern.exec(String(task.name));
    return [match?.[1] ?? `step-${String(index + 1).padStart(3, '0')}`, trace.trajectory[index].step_idx];
  }));
}

export async function loadReviewTask(
  scene: string,
  task: string,
  catalog: TaskCatalogRoots,
): Promise<ReviewTaskView> {
  const description = await describeTask(scene, task, catalog);
  const taskRoot = String(description.taskRoot);
  const taskJsonPath = path.join(taskRoot, 'task.json');
  const taskYamlPath = path.join(taskRoot, 'task.yaml');
  const [taskJson, taskYaml, manifest, document] = await Promise.all([
    readFile(taskJsonPath),
    readFile(taskYamlPath),
    readTaskManifest(taskJsonPath),
    readYamlDocument(taskYamlPath),
  ]);
  const tasks = document.tasks as JsonObject[];
  const recording = await readRecording(taskRoot, manifest);
  const bindings = effectiveBindings(manifest, tasks, recording.trace);
  const processedByStep = new Map<number, ProcessedLogStep>();
  if (recording.trace && recording.processed && recording.trace.trajectory.length === recording.processed.length) {
    recording.trace.trajectory.forEach((item, index) => processedByStep.set(item.step_idx, recording.processed![index]));
  }
  let latestEvidence: ReviewEvidence | undefined;
  let latestStepId: string | undefined;
  const steps: ReviewStep[] = tasks.map((item, index) => {
    const match = stepNamePattern.exec(String(item.name));
    if (!match) throw new Error(`无法构造复核步骤：tasks[${index + 1}].name 非法`);
    const [, id, , operation] = match;
    const sourceStep = bindings[id];
    const evidence = typeof sourceStep === 'number'
      ? evidenceFor(sourceStep, processedByStep, taskRoot, recording.sourceRoot)
      : undefined;
    const contextEvidence = !evidence && latestEvidence
      ? { ...latestEvidence, context: true, fromStepId: latestStepId }
      : undefined;
    if (evidence) {
      latestEvidence = evidence;
      latestStepId = id;
    }
    return {
      id,
      name: String(item.name),
      operation: operation as ReviewOperation,
      flow: structuredClone(item.flow as JsonObject[]),
      ...(manifest.inputs[`${id}-input`] ? { input: structuredClone(manifest.inputs[`${id}-input`]) } : {}),
      ...(evidence ? { evidence } : {}),
      ...(contextEvidence ? { contextEvidence } : {}),
    };
  });
  return {
    scene,
    task,
    title: manifest.title,
    description: manifest.description,
    origin: description.origin as 'builtin' | 'user',
    writable: Boolean(description.writable),
    revision: reviewRevision(taskJson, taskYaml),
    manifest: Object.keys(bindings).length
      ? { ...manifest, source: { ...manifest.source, stepBindings: bindings } }
      : manifest,
    document,
    steps,
  };
}

export async function resolveReviewTaskRoot(scene: string, task: string, catalog: TaskCatalogRoots): Promise<{
  taskRoot: string;
  writable: boolean;
}> {
  const description = await describeTask(scene, task, catalog);
  return { taskRoot: String(description.taskRoot), writable: Boolean(description.writable) };
}
