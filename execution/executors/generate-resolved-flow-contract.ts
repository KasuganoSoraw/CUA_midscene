import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileFromFile } from 'json-schema-to-typescript';

const executionRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const schemaPath = path.join(executionRoot, 'schemas', 'resolved-flow.schema.json');
const outputPath = path.join(executionRoot, 'executors', 'generated', 'resolved-flow.ts');
const bannerComment = '/* 由 resolved-flow.schema.json 生成，请勿手工编辑。 */';

async function render(): Promise<string> {
  return compileFromFile(schemaPath, {
    bannerComment,
    format: true,
    style: { singleQuote: true, trailingComma: 'all' },
  });
}

async function main(): Promise<void> {
  const expected = await render();
  if (process.argv.includes('--check')) {
    const actual = await readFile(outputPath, 'utf8').catch(() => '');
    if (actual !== expected) {
      throw new Error(`TypeScript resolved flow DTO 需要重新生成：${outputPath}`);
    }
    return;
  }
  await mkdir(path.dirname(outputPath), { recursive: true });
  await writeFile(outputPath, expected, 'utf8');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
