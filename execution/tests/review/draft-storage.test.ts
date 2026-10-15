import assert from 'node:assert/strict';
import test from 'node:test';
import { ReviewDraftStorage, type StoredReviewDraft } from '../../review/web/src/draft-storage.js';
import { defaultStepEditor } from '../../review/shared/step-editor.js';

test('编辑草稿跨实例恢复并按项目和任务隔离，保留原始版本号与未完成输入', () => {
  const values = new Map<string, string>();
  const storage = {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => { values.set(key, value); },
    removeItem: (key: string) => { values.delete(key); },
  };
  const editor = defaultStepEditor('input');
  editor.inputLabel = '';
  const draft: StoredReviewDraft = {
    version: 1, revision: 'original-revision', selected: 1, editor,
    draft: { manifest: { inputs: {} } as any, document: { tasks: [{ name: 'step-001 | input', flow: [] }] } },
    changes: [{ kind: 'update', summary: '修改步骤', details: [] }],
  };
  new ReviewDraftStorage(storage, 'project-1').write('scene', 'task', draft);
  const reopened = new ReviewDraftStorage(storage, 'project-1');
  assert.deepEqual(reopened.read('scene', 'task'), draft);
  assert.equal(reopened.read('scene', 'other-task'), undefined);
  assert.equal(new ReviewDraftStorage(storage, 'project-2').read('scene', 'task'), undefined);
  reopened.remove('scene', 'task');
  assert.equal(reopened.read('scene', 'task'), undefined);
});

test('浏览器存储失败和损坏草稿向调用方报告，不宣称保存成功', () => {
  const brokenStorage = {
    getItem: () => '{invalid json',
    setItem: () => { throw new Error('quota exceeded'); },
    removeItem: () => {},
  };
  const store = new ReviewDraftStorage(brokenStorage, 'project');
  assert.throws(() => store.read('scene', 'task'));
  assert.throws(() => store.write('scene', 'task', {} as StoredReviewDraft), /quota exceeded/);
});

test('停用的上传图候选保存在浏览器草稿中，不进入执行 flow', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const editor = defaultStepEditor('click');
  editor.referenceCandidate = { name: 'reference-image', url: 'source/reference-images/test.png' };
  const value: StoredReviewDraft = { version: 1, revision: 'revision', selected: 0, editor,
    draft: { manifest: { inputs: {} } as any, document: { tasks: [{ name: 'step-001 | click', flow: [{ aiTap: editor.target }] }] } },
    changes: [{ kind: 'update', summary: '定位参考图', details: [] }], editors: { 'step-001': editor } };
  const store = new ReviewDraftStorage(storage, 'project');
  store.write('scene', 'task', value);
  const restored = store.read('scene', 'task')!;
  assert.deepEqual(restored.editor.referenceCandidate, editor.referenceCandidate);
  assert.deepEqual(restored.editor.referenceImages, []);
  assert.deepEqual(restored.draft.document, value.draft.document);
});
