import { stat } from 'node:fs/promises';
import path from 'node:path';

export const midsceneReportFileName = 'execution-report';

export async function existingMidsceneHtmlReport(
  reportFile: string | null | undefined,
): Promise<string | undefined> {
  if (typeof reportFile !== 'string' || !reportFile.trim()) return undefined;
  const reportPath = path.resolve(reportFile);
  if (path.extname(reportPath).toLowerCase() !== '.html') return undefined;
  try {
    return (await stat(reportPath)).isFile() ? reportPath : undefined;
  } catch {
    return undefined;
  }
}
