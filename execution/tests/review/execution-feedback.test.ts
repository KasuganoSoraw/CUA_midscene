import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { executionFeedback } from '../../review/web/src/execution-feedback.js';

test('结果提示区分完成、主动停止和有明确信号的失败，不猜测未知原因', () => {
  assert.equal(executionFeedback({ phase: 'succeeded' })?.titleKey, 'execution.succeeded');
  assert.equal(executionFeedback({ phase: 'stopped' })?.titleKey, 'execution.stopped');
  assert.equal(executionFeedback({ phase: 'running' }), undefined);
  assert.equal(executionFeedback({ phase: 'failed', failureKind: 'launch' })?.titleKey, 'execution.failure.launch');
  assert.equal(executionFeedback({ phase: 'failed', error: 'Missing required env vars: MIDSCENE_MODEL_NAME' })?.titleKey, 'execution.failure.configuration');
  assert.equal(executionFeedback({ phase: 'failed', error: 'connect ECONNREFUSED' })?.titleKey, 'execution.failure.connection');
  assert.equal(executionFeedback({ phase: 'failed', error: 'TimeoutError: waiting timed out' })?.titleKey, 'execution.failure.timeout');
  assert.equal(executionFeedback({ phase: 'failed', error: '401 Unauthorized' })?.titleKey, 'execution.failure.authorization');
  assert.equal(executionFeedback({ phase: 'failed', error: '429 Too Many Requests' })?.titleKey, 'execution.failure.rateLimit');
  assert.equal(executionFeedback({ phase: 'failed', error: 'step-401 目标没有响应' })?.titleKey, 'execution.failed');
  assert.equal(executionFeedback({ phase: 'failed', error: '页面与预期不同' })?.titleKey, 'execution.failed');
});

test('结果卡片提供报告入口，原始错误仅在默认折叠的技术详情中展示', async () => {
  const component = await readFile(new URL('../../review/web/src/components/ExecutionWorkspace.vue', import.meta.url), 'utf8');
  assert.ok(/<details[^>]*class="execution-diagnostics"/.test(component));
  assert.ok(!/<details[^>]*\bopen\b/.test(component));
  assert.ok(/<button[^>]*class="execution-report-link"[^>]*@click="openReport"/.test(component));
  assert.ok(/await api.openExecutionReport\(reportUrl\)/.test(component));
  assert.ok(!/<p v-if="status.error"/.test(component));
});
