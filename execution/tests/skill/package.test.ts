import assert from 'node:assert/strict';
import { access, readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const executionRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../..',
);
const repositoryRoot = path.dirname(executionRoot);

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
      'references',
      'review',
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
});

test('Skill 文档面向外部 Agent 并使用编译后的 Node CLI', async () => {
  const skill = await readFile(path.join(executionRoot, 'SKILL.md'), 'utf8');
  const envExample = await readFile(path.join(executionRoot, '.env.example'), 'utf8');

  assert.match(skill, /node dist\/cli\/main\.js/);
  assert.match(skill, /外部 Agent|Agent Host/);
  assert.match(skill, /Node\.js `>=22\.18\.0`/);
  assert.match(skill, /task create-from-recording/);
  assert.match(skill, /CUA_RECORD_ROOT/);
  assert.match(skill, /--goal.*不参与 trace 生成/);
  assert.match(skill, /提出 `task\.yaml` 修改建议，展示原值、新值和原因，等待明确确认/);
  assert.match(skill, /停止并等待用户明确确认/);
  assert.doesNotMatch(skill, /uv run cua|python\s+-m/i);
  assert.doesNotMatch(skill, /uv run python|Aloha_Learn[\\/]parser\.py/i);
  assert.match(envExample, /^CUA_RECORD_ROOT=.+$/m);
  await assert.rejects(access(path.join(repositoryRoot, 'scripts/install-cua-midscene-skill.ps1')));
});
