import type { ReviewReferenceImage, ReviewTaskDraft } from '../../shared/types.js';
import type { SkillTaskManifest } from '../../../cua/contracts/types.js';

function visitImages(value: unknown, visit: (image: ReviewReferenceImage) => void): void {
  if (Array.isArray(value)) { value.forEach(item => visitImages(item, visit)); return; }
  if (!value || typeof value !== 'object') return;
  for (const [key, item] of Object.entries(value)) {
    if (key === 'images' && Array.isArray(item)) {
      item.forEach(image => { if (image && typeof image.url === 'string') visit(image); });
    } else visitImages(item, visit);
  }
}

export class MemoryReferenceImages {
  private readonly files = new Map<string, File>();

  add(file: File): ReviewReferenceImage {
    const url = URL.createObjectURL(file);
    this.files.set(url, file);
    return { name: file.name, url };
  }

  async materialize(draft: ReviewTaskDraft<SkillTaskManifest>, upload: (file: File) => Promise<{ image: ReviewReferenceImage }>) {
    const result = JSON.parse(JSON.stringify(draft)) as ReviewTaskDraft<SkillTaskManifest>;
    const pending = new Set<string>();
    visitImages(result, image => { if (this.files.has(image.url)) pending.add(image.url); });
    const replacements = new Map<string, ReviewReferenceImage>();
    for (const url of pending) replacements.set(url, (await upload(this.files.get(url)!)).image);
    visitImages(result, image => { const replacement = replacements.get(image.url); if (replacement) image.url = replacement.url; });
    return result;
  }

  clear(): void {
    for (const url of this.files.keys()) URL.revokeObjectURL(url);
    this.files.clear();
  }
}
