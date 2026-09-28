import assert from 'node:assert/strict';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import type { ExecutionDump, ScreenshotItem } from '@midscene/core';
import { createMidsceneExecutionObserver } from '../../executors/midscene-final-screenshot.js';

function screenshot(content: string, format: 'png' | 'jpeg'): ScreenshotItem {
  return {
    format,
    rawBase64: Buffer.from(content).toString('base64'),
  } as ScreenshotItem;
}

test('最终截图取最终 task 最后的 after-calling recorder 并保留图片格式', async () => {
  const runDirectory = await mkdtemp(path.join(os.tmpdir(), 'cua-final-screenshot-'));
  const observer = createMidsceneExecutionObserver();
  observer.listener('', {
    tasks: [
      {
        taskId: 'earlier-task',
        recorder: [{
          type: 'screenshot', ts: 1, timing: 'after-calling', screenshot: screenshot('earlier', 'png'),
        }],
      },
      {
        taskId: 'final-task',
        recorder: [
          { type: 'screenshot', ts: 2, timing: 'before-calling', screenshot: screenshot('before', 'png') },
          { type: 'screenshot', ts: 3, timing: 'after-calling', screenshot: screenshot('first-after', 'png') },
          { type: 'screenshot', ts: 4, timing: 'after-calling', screenshot: screenshot('final-after', 'jpeg') },
        ],
      },
    ],
  } as unknown as ExecutionDump);

  const screenshotPath = await observer.persistFinalScreenshot(runDirectory);
  assert.equal(screenshotPath, path.join(runDirectory, 'final-screenshot.jpeg'));
  assert.equal((await readFile(screenshotPath)).toString(), 'final-after');
});

test('没有最终 after-calling 截图时不生成产物', async () => {
  const runDirectory = await mkdtemp(path.join(os.tmpdir(), 'cua-no-final-screenshot-'));
  const observer = createMidsceneExecutionObserver();
  observer.listener('', {
    tasks: [{
      taskId: 'earlier-execution',
      recorder: [{
        type: 'screenshot', ts: 1, timing: 'after-calling', screenshot: screenshot('stale', 'png'),
      }],
    }],
  } as unknown as ExecutionDump);
  observer.listener('', {
    tasks: [{
      taskId: 'final-task',
      recorder: [{
        type: 'screenshot', ts: 1, timing: 'before-calling', screenshot: screenshot('before', 'png'),
      }],
    }],
  } as unknown as ExecutionDump);

  assert.equal(await observer.persistFinalScreenshot(runDirectory), undefined);
  assert.deepEqual(await readdir(runDirectory), []);
});
