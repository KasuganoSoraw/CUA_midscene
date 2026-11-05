import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { injectShrinkBannerIntoReport } from '../../executors/midscene-report.js';

test('报告后处理隐藏 Playground 且不影响其他操作，并可重复处理', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'cua-report-'));
  const reportPath = path.join(directory, 'report.html');
  await writeFile(reportPath, '<html><body><div id="root"></div></body></html>');

  await injectShrinkBannerIntoReport(reportPath, 1);
  const unscaled = await readFile(reportPath, 'utf8');
  assert.match(unscaled, /id="midscene-hide-playground"/);
  assert.match(unscaled, /\.view-switcher-actions > button:has\(\.anticon-play-circle\)/);
  assert.match(unscaled, /\.ant-tooltip-disabled-compatible-wrapper:has\(\.anticon-play-circle\)/);
  assert.doesNotMatch(unscaled, /id="midscene-shrink-banner"/);
  assert.doesNotMatch(unscaled, /\.download-zip-link|\.copy-json-link/);

  await injectShrinkBannerIntoReport(reportPath, 2);
  const scaled = await readFile(reportPath, 'utf8');
  assert.equal(scaled.match(/id="midscene-hide-playground"/g)?.length, 1);
  assert.equal(scaled.match(/id="midscene-shrink-banner"/g)?.length, 1);
  await injectShrinkBannerIntoReport(reportPath, 2);
  assert.equal(await readFile(reportPath, 'utf8'), scaled);
});
