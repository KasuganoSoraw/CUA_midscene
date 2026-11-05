import { open, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

export const midsceneReportFileName = 'execution-report';

const hidePlaygroundStyle = [
  '<style id="midscene-hide-playground">',
  '.detail-panel .view-switcher-actions > button:has(.anticon-play-circle),',
  '.detail-panel .view-switcher-actions > .ant-tooltip-disabled-compatible-wrapper:has(.anticon-play-circle)',
  '{ display: none !important; }',
  '</style>',
].join('\n');

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

/** 从 report HTML 的 dump script 中流式提取第一个 shotSize（缩放后截图尺寸）。 */
export async function extractShotSizeFromReport(
  reportPath: string,
): Promise<{ width: number; height: number } | undefined> {
  let handle;
  try {
    handle = await open(reportPath, 'r');
    let buffer = Buffer.alloc(0);
    const chunk = Buffer.alloc(65536);
    const marker = 'shotSize';
    let position = 0;
    for (;;) {
      const { bytesRead } = await handle.read(chunk, 0, chunk.length, position);
      if (bytesRead === 0) break;
      position += bytesRead;
      buffer = Buffer.concat([buffer, chunk.subarray(0, bytesRead)]);
      if (buffer.length > 4 * 1024 * 1024) {
        // 保留尾部 1MB 继续匹配，避免跨越块边界截断关键字段
        buffer = buffer.subarray(buffer.length - 1024 * 1024);
      }
      const text = buffer.toString('utf8');
      const idx = text.lastIndexOf(marker);
      if (idx >= 0) {
        // shotSize 附近形如 {"width":N,"height":N}
        const snippet = text.slice(idx, idx + 400);
        const widthMatch = snippet.match(/"width":\s*(\d+)/);
        const heightMatch = snippet.match(/"height":\s*(\d+)/);
        if (widthMatch && heightMatch) {
          const width = Number(widthMatch[1]);
          const height = Number(heightMatch[1]);
          if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
            return { width, height };
          }
        }
      }
    }
    return undefined;
  } catch {
    return undefined;
  } finally {
    await handle?.close().catch(() => undefined);
  }
}

/**
 * 向 report HTML 注入报告展示样式及截图缩放信息 banner（放在 React 挂载点 #root 之外）。
 *
 * shrinkFactor > 1 时展示：缩放倍数 + 缩放前(原始)尺寸 → 缩放后(实际发送)尺寸。
 * 原始尺寸 = 缩放后尺寸 × shrinkFactor（截图是等比缩小的）。
 */
export async function injectShrinkBannerIntoReport(
  reportPath: string,
  shrinkFactor: number,
): Promise<void> {
  let content: string;
  try {
    content = await readFile(reportPath, 'utf8');
  } catch {
    return;
  }
  const injectPlaygroundStyle = !content.includes('id="midscene-hide-playground"');
  const showBanner = shrinkFactor > 1 && !content.includes('id="midscene-shrink-banner"');
  if (!injectPlaygroundStyle && !showBanner) return;

  const shotSize = showBanner ? await extractShotSizeFromReport(reportPath) : undefined;
  const original = shotSize
    ? { width: Math.round(shotSize.width * shrinkFactor), height: Math.round(shotSize.height * shrinkFactor) }
    : undefined;

  const bannerHtml = showBanner ? [
    '<div id="midscene-shrink-banner" style="position:fixed;top:12px;right:12px;z-index:99999;padding:10px 14px;border-radius:8px;background:rgba(24,30,50,0.92);color:#fff;font-family:system-ui,sans-serif;font-size:12px;line-height:18px;box-shadow:0 2px 12px rgba(0,0,0,0.25);max-width:340px;pointer-events:none;">',
    `  <div style="font-weight:600;margin-bottom:4px;">Screenshot scaling: &times;${shrinkFactor.toFixed(2)}</div>`,
    original
      ? `  <div>${original.width} &times; ${original.height} &rarr; ${shotSize!.width} &times; ${shotSize!.height} (sent to model)</div>`
      : `  <div>Original size unknown; shot size from dump only.</div>`,
    '</div>',
  ].join('\n') : '';

  const rootMarker = '<div id="root"';
  const rootIndex = content.indexOf(rootMarker);
  const insertAt = rootIndex >= 0 ? rootIndex : content.indexOf('<body>');
  if (insertAt < 0) return;
  const newContent = content.slice(0, insertAt)
    + [injectPlaygroundStyle ? hidePlaygroundStyle : '', bannerHtml].filter(Boolean).join('\n')
    + '\n' + content.slice(insertAt);
  try {
    await writeFile(reportPath, newContent, 'utf8');
  } catch {
    // 写入失败不影响主流程
  }
}
