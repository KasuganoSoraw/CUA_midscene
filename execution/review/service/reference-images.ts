import { createHash } from 'node:crypto';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import type { TaskCatalogRoots } from '../../cua/contracts/types.js';
import { referenceImageMaxBytes, referenceImageMaxPixels } from '../shared/reference-upload.js';
import type { ReviewReferenceImage } from '../shared/types.js';
import { resolveReviewTaskRoot, reviewRevision } from './review-task.js';
import { ReviewConflictError, ReviewReadonlyError } from './task-save.js';

function inside(root: string, target: string): boolean {
  const relative = path.relative(root, target);
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function imageFormat(data: Buffer): 'png' | 'jpeg' | 'webp' {
  if (data.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) return 'png';
  if (data.length >= 3 && data[0] === 255 && data[1] === 216 && data[2] === 255) return 'jpeg';
  if (data.length >= 12 && data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WEBP') return 'webp';
  throw new Error('定位参考图仅支持有效的 PNG、JPEG 或 WebP 图片');
}

async function assertRevision(taskRoot: string, expectedRevision: string): Promise<void> {
  const [manifest, yaml] = await Promise.all([
    readFile(path.join(taskRoot, 'task.json')), readFile(path.join(taskRoot, 'task.yaml')),
  ]);
  if (reviewRevision(manifest, yaml) !== expectedRevision) throw new ReviewConflictError('任务已被外部修改，请重新加载后上传');
}

async function normalizeReferenceImage(
  data: Buffer, contentType: string, format: ReturnType<typeof imageFormat>,
): Promise<Buffer> {
  if (contentType !== `image/${format}`) throw new Error('图片内容与声明格式不一致');
  let normalized: Buffer;
  try {
    const image = sharp(data, { failOn: 'warning', limitInputPixels: referenceImageMaxPixels });
    const metadata = await image.metadata();
    if (metadata.format !== format || (metadata.pages ?? 1) !== 1) throw new Error('只支持单帧图片');
    if (!metadata.width || !metadata.height || metadata.width > 6000 || metadata.height > 6000) {
      throw new Error('图片边长不能超过 6000 像素');
    }
    normalized = await image.rotate().toFormat(format).toBuffer();
  } catch (error) {
    throw new Error(`定位参考图无法读取，最多支持 1600 万像素的单帧图片：${error instanceof Error ? error.message : String(error)}`);
  }
  if (normalized.length > referenceImageMaxBytes) throw new Error('处理后的定位参考图不能超过 5 MB');
  return normalized;
}

async function storeImmutableReferenceImage(
  directory: string, normalized: Buffer, format: ReturnType<typeof imageFormat>,
): Promise<string> {
  const hash = createHash('sha256').update(normalized).digest('hex');
  const filename = `${hash}.${format === 'jpeg' ? 'jpg' : format}`;
  try { await writeFile(path.join(directory, filename), normalized, { flag: 'wx' }); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
    if (!inside(await realpath(directory), await realpath(path.join(directory, filename)))) throw new Error('定位参考图资产越出目录');
    const existing = await readFile(path.join(directory, filename));
    if (!existing.equals(normalized)) throw new Error('定位参考图资产内容冲突');
  }
  return filename;
}

export async function uploadReferenceImage(options: {
  scene: string;
  task: string;
  catalog: TaskCatalogRoots;
  expectedRevision: string;
  contentType: string;
  data: Buffer;
}): Promise<{ image: ReviewReferenceImage }> {
  if (!Buffer.isBuffer(options.data) || !options.data.length) throw new Error('定位参考图不能为空');
  if (options.data.length > referenceImageMaxBytes) {
    throw Object.assign(new Error('定位参考图不能超过 5 MB'), { statusCode: 413 });
  }
  const resolved = await resolveReviewTaskRoot(options.scene, options.task, options.catalog);
  if (!resolved.writable) throw new ReviewReadonlyError('只读任务不能上传定位参考图');
  const taskRoot = await realpath(resolved.taskRoot);
  if (!options.catalog.userProjectsRoot || !inside(await realpath(options.catalog.userProjectsRoot), taskRoot)) {
    throw new Error('任务目录越出用户 projects 目录');
  }
  await assertRevision(taskRoot, options.expectedRevision);
  const format = imageFormat(options.data);
  const normalized = await normalizeReferenceImage(options.data, options.contentType, format);
  const sourceRoot = path.join(taskRoot, 'source');
  await mkdir(sourceRoot, { recursive: true });
  if (!inside(taskRoot, await realpath(sourceRoot))) throw new Error('source 目录越出任务目录');
  const directory = path.join(sourceRoot, 'reference-images');
  await mkdir(directory, { recursive: true });
  if (!inside(await realpath(sourceRoot), await realpath(directory))) throw new Error('定位参考图目录越出 source 目录');
  await assertRevision(taskRoot, options.expectedRevision);
  const filename = await storeImmutableReferenceImage(directory, normalized, format);
  return { image: { name: 'reference-image', url: `source/reference-images/${filename}` } };
}
