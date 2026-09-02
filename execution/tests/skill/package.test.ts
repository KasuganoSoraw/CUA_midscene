import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const executionRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const repositoryRoot = path.dirname(executionRoot);
const execFileAsync = promisify(execFile);

async function collectFiles(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files: string[] = [];
  for (const entry of entries) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectFiles(entryPath)));
    } else {
      files.push(entryPath);
    }
  }
  return files;
}

test('Skill 发布物只声明 TypeScript 运行时和必要资产', async () => {
  const packageJson = JSON.parse(
    await readFile(path.join(executionRoot, 'package.json'), 'utf8'),
  ) as {
    bin?: Record<string, string>;
    files?: string[];
    scripts?: Record<string, string>;
    engines?: Record<string, string>;
    dependencies?: Record<string, string>;
  };

  assert.equal(packageJson.bin?.cua, './dist/cli/main.js');
  assert.equal(packageJson.scripts?.prepack, 'npm run build');
  assert.equal(packageJson.engines?.node, '>=22.18.0');
  assert.match(packageJson.dependencies?.fastify ?? '', /^\^5\./);
  assert.match(packageJson.dependencies?.['@fastify/static'] ?? '', /^\^8\./);
  assert.deepEqual(
    new Set(packageJson.files),
    new Set([
      '.env.example',
      'cli',
      'cua',
      'dist',
      'executors',
      'projects',
      '!projects/**/reports/**',
      '!projects/**/midscene_run/**',
      'references',
      'review',
      'runtime-bridge',
      'schemas',
      'README.md',
      'SKILL.md',
      'tsconfig.build.json',
      'tsconfig.json',
    ]),
  );

  const runtimeFiles = await collectFiles(path.join(executionRoot, 'cua'));
  const testFiles = await collectFiles(path.join(executionRoot, 'tests'));
  assert.equal(
    [...runtimeFiles, ...testFiles].some((file) =>
      ['.py', '.pyc'].includes(path.extname(file)),
    ),
    false,
  );

  const npmArgs = ['pack', '--dry-run', '--json', '--ignore-scripts'];
  const npmExecPath = process.env.npm_execpath;
  const { stdout } = npmExecPath
    ? await execFileAsync(process.execPath, [npmExecPath, ...npmArgs], { cwd: executionRoot })
    : await execFileAsync(process.platform === 'win32' ? 'npm.cmd' : 'npm', npmArgs, {
        cwd: executionRoot,
      });
  const pack = JSON.parse(stdout) as Array<{ files?: Array<{ path?: string }> }>;
  const packedPaths = pack[0]?.files?.flatMap((file) => file.path ?? []) ?? [];
  assert.equal(packedPaths.some((file) => /(^|\/)reports(\/|$)/.test(file)), false);
  assert.equal(packedPaths.some((file) => /(^|\/)midscene_run(\/|$)/.test(file)), false);
});

test('Skill 文档面向维护型调用方并使用编译后的 Node CLI', async () => {
  const skill = await readFile(path.join(executionRoot, 'SKILL.md'), 'utf8');
  const envExample = await readFile(path.join(executionRoot, '.env.example'), 'utf8');

  assert.match(skill, /node dist\/cli\/main\.js/);
  assert.match(skill, /维护型调用方/);
  assert.match(skill, /不是 Python Agent 的运行时 prompt/);
  assert.match(skill, /Node\.js `>=22\.18\.0`/);
  assert.match(skill, /设置足够长的超时/);
  assert.match(skill, /模型请求默认 120 秒.*Runtime 单请求默认 300 秒.*Review 外层 invocation 默认 30 分钟/);
  assert.match(skill, /task create-from-recording/);
  assert.match(skill, /CUA_PYTHON_EXECUTABLE/);
  assert.match(skill, /Windows `cua_recorder` 是采集 Worker.*`cua_record` 后处理器/);
  assert.match(skill, /--goal.*不参与 trace 生成/);
  assert.match(skill, /提出 `task\.yaml` 修改建议，展示原值、新值和原因，等待明确确认/);
  assert.match(skill, /停止并等待用户明确确认/);
  assert.doesNotMatch(skill, /uv run cua|python\s+-m/i);
  assert.doesNotMatch(skill, /uv run python|Aloha_Learn[\\/]parser\.py/i);
  assert.match(envExample, /^# CUA_PYTHON_EXECUTABLE=.+$/m);
  assert.doesNotMatch(envExample, /CUA_RECORD_ROOT|CUA_RECORDER_ROOT/);
  await assert.rejects(access(path.join(repositoryRoot, 'scripts/install-cua-midscene-skill.ps1')));
});
