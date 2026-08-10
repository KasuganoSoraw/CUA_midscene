import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const executionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const releaseRoot = path.join(executionRoot, 'release');
const stageRoot = path.join(releaseRoot, 'agent-runtime');

async function collectRelativeFiles(directory: string, root = directory): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) files.push(...(await collectRelativeFiles(entryPath, root)));
    else files.push(path.relative(root, entryPath).replaceAll('\\', '/'));
  }
  return files.sort();
}

test('Agent Runtime 发布物只包含首期白名单', async () => {
  const files = await collectRelativeFiles(stageRoot);
  const packageJson = JSON.parse(await readFile(path.join(stageRoot, 'package.json'), 'utf8'));

  assert.equal(packageJson.name, 'cua-agent-runtime');
  assert.equal(packageJson.bin.cua, './dist/agent-runtime/cli.js');
  assert.equal(packageJson.exports['.'].import, './dist/agent-runtime/index.js');
  assert.deepEqual(Object.keys(packageJson.dependencies).sort(), [
    '@midscene/computer',
    '@midscene/core',
    'dotenv',
  ]);
  assert.ok(files.includes('.env.example'));
  assert.ok(files.includes('README.md'));
  assert.ok(files.includes('SKILL.md'));
  assert.ok(files.includes('dist/agent-runtime/cli.js'));
  assert.ok(files.includes('dist/agent-runtime/index.js'));
  assert.equal(files.some((file) => /(^|\/)(projects|recording|conversion|review|task|tests)(\/|$)/.test(file)), false);
  assert.equal(files.some((file) => /(^|\/)\.env(\.local)?$/.test(file)), false);

  const tarballs = (await readdir(releaseRoot)).filter((name) => /^cua-agent-runtime-.*\.tgz$/.test(name));
  assert.deepEqual(tarballs, [`cua-agent-runtime-${packageJson.version}.tgz`]);
});

test('Agent Runtime 窄 API 与 CLI 可从发布目录独立加载', async () => {
  const api = await import(pathToFileURL(path.join(stageRoot, 'dist/agent-runtime/index.js')).href);
  assert.equal(typeof api.runNaturalLanguageAiAct, 'function');

  const cliPath = path.join(stageRoot, 'dist/agent-runtime/cli.js');
  const help = await execFileAsync(process.execPath, [cliPath, '--help'], { cwd: stageRoot });
  assert.match(help.stdout, /cua act run --prompt/);
  assert.doesNotMatch(help.stdout, /task run|create-from-recording|review/);

  const dataRoot = await mkdtemp(path.join(os.tmpdir(), 'cua-agent-package-'));
  const dryRun = await execFileAsync(process.execPath, [
    cliPath,
    'act',
    'run',
    '--prompt',
    '打开 Chrome 并搜索 GUI agent',
    '--data-root',
    dataRoot,
    '--dry-run',
  ], { cwd: stageRoot });
  const result = JSON.parse(dryRun.stdout);
  assert.equal(result.mode, 'prompt');
  assert.equal(result.executor.dryRun, true);
  assert.ok(path.resolve(result.runDir).startsWith(path.join(dataRoot, 'runs')));
});
