import { cp, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const executionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseRoot = path.join(executionRoot, 'release');
const stageRoot = path.join(releaseRoot, 'agent-runtime');

const compiledModules = [
  'agent-runtime/cli',
  'agent-runtime/index',
  'cua/act/execution',
  'cua/contracts/types',
  'cua/data-paths',
  'cua/package-root',
  'cua/run-directory',
  'executors/computer-agent',
  'executors/env',
  'executors/keyboard-type-action',
  'executors/midscene-ai-act',
];

const runtimeDependencies = [
  '@midscene/computer',
  '@midscene/core',
  'dotenv',
];

async function copyFile(relativeSource, relativeTarget = relativeSource) {
  const source = path.join(executionRoot, relativeSource);
  const target = path.join(stageRoot, relativeTarget);
  await mkdir(path.dirname(target), { recursive: true });
  await cp(source, target);
}

function run(command, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd, stdio: 'inherit', shell: false });
    child.once('error', reject);
    child.once('exit', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(' ')} 退出码为 ${code}`));
    });
  });
}

export async function stageAgentRuntimePackage() {
  const sourcePackage = JSON.parse(await readFile(path.join(executionRoot, 'package.json'), 'utf8'));
  const dependencies = Object.fromEntries(runtimeDependencies.map((name) => {
    const version = sourcePackage.dependencies?.[name];
    if (!version) throw new Error(`完整包缺少 Agent Runtime 依赖声明：${name}`);
    return [name, version];
  }));

  await rm(stageRoot, { recursive: true, force: true });
  await mkdir(stageRoot, { recursive: true });
  for (const modulePath of compiledModules) {
    for (const extension of ['.js', '.js.map', '.d.ts']) {
      await copyFile(`dist/${modulePath}${extension}`);
    }
  }
  await copyFile('agent-runtime/.env.example', '.env.example');
  await copyFile('agent-runtime/README.md', 'README.md');
  await copyFile('agent-runtime/SKILL.md', 'SKILL.md');

  const packageJson = {
    name: 'cua-agent-runtime',
    version: sourcePackage.version,
    description: '供 Agent 集成的 Midscene 自然语言 Computer Use 精简运行时',
    type: 'module',
    bin: { cua: './dist/agent-runtime/cli.js' },
    exports: {
      '.': {
        types: './dist/agent-runtime/index.d.ts',
        import: './dist/agent-runtime/index.js',
      },
    },
    files: ['.env.example', 'dist', 'README.md', 'SKILL.md'],
    engines: sourcePackage.engines,
    dependencies,
    license: sourcePackage.license,
  };
  await writeFile(path.join(stageRoot, 'package.json'), `${JSON.stringify(packageJson, null, 2)}\n`, 'utf8');
  return { executionRoot, releaseRoot, stageRoot, packageJson };
}

export async function packAgentRuntime() {
  const staged = await stageAgentRuntimePackage();
  const entries = await readdir(releaseRoot);
  await Promise.all(entries
    .filter((name) => /^cua-agent-runtime-.*\.tgz$/.test(name))
    .map((name) => rm(path.join(releaseRoot, name), { force: true })));
  const npmCli = process.env.npm_execpath;
  if (!npmCli) {
    throw new Error('缺少 npm_execpath；请通过 npm run package:agent 执行打包');
  }
  await run(
    process.execPath,
    [npmCli, 'pack', '--ignore-scripts', '--pack-destination', staged.releaseRoot],
    staged.stageRoot,
  );
  return staged;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const staged = await packAgentRuntime();
  process.stdout.write(`${JSON.stringify({
    package: staged.packageJson.name,
    version: staged.packageJson.version,
    stageRoot: staged.stageRoot,
    releaseRoot: staged.releaseRoot,
  }, null, 2)}\n`);
}
