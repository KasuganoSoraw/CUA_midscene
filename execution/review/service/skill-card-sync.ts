import { listSkills, readSkill } from '../../cua/skills/assets.js';
import type { RecordingCardInput, RecordingCardSyncResult } from '../shared/recording-cards.js';

export async function synchronizeSkillCards(options: {
  skillsRoot?: string;
  linkedNames: () => Set<string>;
  importSkill: (input: RecordingCardInput) => boolean;
}): Promise<RecordingCardSyncResult> {
  const result: RecordingCardSyncResult = { synced: true, importedSkills: 0, warnings: [] };
  if (!options.skillsRoot) return result;
  const catalog = await listSkills(options.skillsRoot);
  const linkedNames = options.linkedNames();
  for (const item of catalog) {
    if (item.status === 'error') {
      result.warnings.push(`${item.skillName}：${item.error}`);
      continue;
    }
    if (linkedNames.has(item.skillName)) continue;
    try {
      // 扫描与建卡之间目录可能被删除或替换，只使用当前仍然合法的正式资源。
      const asset = await readSkill(options.skillsRoot, item.skillName);
      if (options.importSkill({ name: asset.skill.name, description: asset.skill.description })) {
        result.importedSkills += 1;
        linkedNames.add(item.skillName);
      }
    } catch (error) {
      result.warnings.push(`${item.skillName}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  return result;
}
