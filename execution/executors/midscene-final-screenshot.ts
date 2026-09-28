import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { ExecutionDump, ScreenshotItem } from '@midscene/core';
import {
  createMidsceneProgressListener,
  type ExecutionProgressSink,
} from './midscene-progress.js';

type MidsceneDumpListener = (dump: string, executionDump?: ExecutionDump) => void;

function finalAfterCallingScreenshot(executionDump?: ExecutionDump): ScreenshotItem | undefined {
  const tasks = executionDump?.tasks;
  const finalTask = tasks?.[tasks.length - 1];
  const recorder = finalTask?.recorder;
  if (!recorder) return undefined;
  for (let index = recorder.length - 1; index >= 0; index -= 1) {
    const item = recorder[index];
    if (item.timing === 'after-calling' && item.screenshot) return item.screenshot;
  }
  return undefined;
}

export function createMidsceneExecutionObserver(onProgress?: ExecutionProgressSink): {
  listener: MidsceneDumpListener;
  persistFinalScreenshot(runDirectory: string): Promise<string | undefined>;
} {
  const progressListener = onProgress ? createMidsceneProgressListener(onProgress) : undefined;
  let latestExecutionDump: ExecutionDump | undefined;

  return {
    listener: (dump, executionDump) => {
      progressListener?.(dump, executionDump);
      if (executionDump) latestExecutionDump = executionDump;
    },
    persistFinalScreenshot: async (runDirectory) => {
      const finalScreenshot = finalAfterCallingScreenshot(latestExecutionDump);
      if (!finalScreenshot) return undefined;
      const screenshotPath = path.join(
        path.resolve(runDirectory),
        `final-screenshot.${finalScreenshot.format}`,
      );
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await writeFile(screenshotPath, Buffer.from(finalScreenshot.rawBase64, 'base64'));
      return screenshotPath;
    },
  };
}
