import { SkillDeleteError } from '../../cua/skills/host-delete.js';
import { SkillImportError } from '../../cua/skills/host-import.js';

export function workflowFailure(error: unknown, synchronizing: boolean): { message: string; diagnostics: string } {
  if (error instanceof SkillImportError || error instanceof SkillDeleteError) return { message: error.userMessage, diagnostics: error.diagnostics };
  const text = error instanceof Error ? error.message : String(error);
  let message = text.split(/\r?\n/)[0].slice(0, 1000);
  if (synchronizing) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (code === 'EACCES' || code === 'EPERM') message = '无法写入 GDE 技能目录，请检查目录权限或文件占用情况。';
    if (code === 'EBUSY') message = 'GDE 技能目录或文件正在被占用，请关闭占用程序后再试。';
    if (code === 'ENOSPC') message = '磁盘空间不足，无法同步技能，请释放磁盘空间后再试。';
    if (code === 'ENOENT') message = '技能同步所需的目录或文件不存在，请检查目录配置并查看详细日志。';
    message += '生成草稿已保留。';
  }
  const diagnostics = error instanceof Error ? error.stack ?? text : text;
  return { message, diagnostics };
}
