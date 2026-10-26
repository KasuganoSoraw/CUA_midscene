import assert from 'node:assert/strict';
import test from 'node:test';
import { computed, reactive } from 'vue';
import type { ReviewEvidence, ReviewOperation } from '../../review/shared/types.js';
import { resolveEvidenceMode, type EvidenceMode } from '../../review/web/src/evidence-mode.js';

test('手动点击步骤切换为输入文本时立即停止显示定位图', () => {
  const state = reactive<{ operation: ReviewOperation; requested: EvidenceMode }>({ operation: 'click', requested: 'reference' });
  const mode = computed(() => resolveEvidenceMode(state.requested, state.operation));
  assert.equal(mode.value, 'reference');
  state.operation = 'input';
  assert.equal(mode.value, 'placeholder');
  state.operation = 'keyboard';
  assert.equal(mode.value, 'placeholder');
  state.operation = 'wait';
  assert.equal(mode.value, 'placeholder');
  state.operation = 'doubleClick';
  assert.equal(mode.value, 'reference');
});

test('截图视图仅选择当前步骤可用的录制图片', () => {
  const evidence: ReviewEvidence = { sourceStep: 1, timestamp: 0, full: 'full.png', crop: 'crop.png' };
  assert.equal(resolveEvidenceMode('reference', 'input', evidence), 'crop');
  assert.equal(resolveEvidenceMode('full', 'input', evidence), 'full');
  assert.equal(resolveEvidenceMode('crop', 'click', evidence), 'crop');
  assert.equal(resolveEvidenceMode('reference', 'click', evidence), 'reference');
  assert.equal(resolveEvidenceMode('crop', 'input', { ...evidence, crop: undefined }), 'full');
  assert.equal(resolveEvidenceMode('full', 'input'), 'placeholder');
  assert.equal(resolveEvidenceMode('crop', 'click'), 'reference');
  assert.equal(resolveEvidenceMode('full', 'aiAct'), 'placeholder');
  assert.equal(resolveEvidenceMode('reference', 'aiAct', evidence), 'reference');
});
