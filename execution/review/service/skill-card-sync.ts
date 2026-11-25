import { listSkills, readSkill } from '../../cua/skills/assets.js';
import type { RecordingCardInput, RecordingCardSyncResult } from '../shared/recording-cards.js';
import type { RecordingCatalog, RecordingEntry } from '../../cua/recording/recording-catalog.js';

export async function synchronizeSkillCards(options: {
  skillsRoot?: string;
  recordings: () => Promise<RecordingCatalog>;
  linkedRecordings: (names: Set<string>) => Set<string>;
  importSkill: (input: RecordingCardInput, recordings: Set<string>) => { created: boolean; warnings: string[] };
  importRecordings: (entries: RecordingEntry[]) => void;
}): Promise<RecordingCardSyncResult> {
  const result: RecordingCardSyncResult = { synced: true, importedSkills: 0, warnings: [] };
  const catalog = options.skillsRoot ? await listSkills(options.skillsRoot) : [];
  let entries: RecordingEntry[] = [];
  try { entries = (await options.recordings()).recordings; }
  catch (error) {
    result.warnings.push(`录制目录扫描失败：${error instanceof Error ? error.message : String(error)}`);
  }
  const recordingIds = new Set(entries.map(entry => entry.id));
  const names = new Set(catalog.filter(item => item.status === 'ready').map(item => item.skillName));
  for (const item of catalog) {
    if (item.status === 'error') {
      result.warnings.push(`${item.skillName}：${item.error}`);
      continue;
    }
    try {
      // 扫描与建卡之间目录可能被删除或替换，只使用当前仍然合法的正式资源。
      const asset = await readSkill(options.skillsRoot!, item.skillName);
      const association = options.importSkill({ name: asset.skill.name, description: asset.skill.description }, recordingIds);
      if (association.created) result.importedSkills += 1;
      result.warnings.push(...association.warnings.map(warning => `${item.skillName}：${warning}`));
    } catch (error) {
      result.warnings.push(`${item.skillName}：${error instanceof Error ? error.message : String(error)}`);
    }
  }
  const linked = options.linkedRecordings(names);
  options.importRecordings(entries.filter(entry => !linked.has(entry.id)));
  return result;
}
