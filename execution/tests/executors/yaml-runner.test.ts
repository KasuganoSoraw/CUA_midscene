import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const executionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const runnerPath = path.join(executionRoot, 'executors', 'run-midscene-yaml.ts');
const tsxPath = path.join(executionRoot, 'node_modules', 'tsx', 'dist', 'cli.mjs');

function run(yamlContent: string) {
  const root = mkdtempSync(path.join(os.tmpdir(), 'cua-yaml-runner-'));
  const yamlPath = path.join(root, 'task.yaml');
  const resultPath = path.join(root, 'execution-result.json');
  writeFileSync(yamlPath, yamlContent, 'utf8');
  const completed = spawnSync(
    process.execPath,
    [tsxPath, runnerPath, '--yaml', yamlPath, '--result', resultPath, '--dry-run'],
    {
      cwd: executionRoot,
      encoding: 'utf8',
      env: {
        ...process.env,
        MIDSCENE_MODEL_BASE_URL: '',
        MIDSCENE_MODEL_NAME: '',
        MIDSCENE_MODEL_API_KEY: '',
        MIDSCENE_MODEL_FAMILY: '',
      },
    },
  );
  return {
    completed,
    result: JSON.parse(readFileSync(resultPath, 'utf8')) as Record<string, unknown>,
    yamlPath,
  };
}

const valid = run(`
computer: {}
tasks:
  - name: 键盘输入示例
    flow:
      - KeyboardTypeText:
          locate: Chrome 地址栏
          value: QATAR AIRWAYS
          mode: replace
      - KeyboardPress:
          keyName: Enter
`);
assert.equal(valid.completed.status, 0, valid.completed.stderr);
assert.equal(valid.result.status, 'succeeded');
assert.equal(valid.result.dryRun, true);
assert.equal(valid.result.taskCount, 1);
assert.equal(path.resolve(String(valid.result.sourceYamlPath)), path.resolve(valid.yamlPath));

const invalid = run('computer: {}\ntasks: []\n');
assert.notEqual(invalid.completed.status, 0);
assert.equal(invalid.result.status, 'failed');
assert.match(String(invalid.result.error), /tasks 必须是非空数组/);

console.log('Midscene YAML runner 测试通过');
