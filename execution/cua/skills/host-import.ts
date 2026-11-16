import { readFile } from 'node:fs/promises';
import { readRuntimeEnvironmentValue } from '../environment.js';
import { packageRoot } from '../package-root.js';
import { requireSkillName } from './paths.js';
import { httpImportError, networkImportError, responseImportError, type ImportContext } from './import-failure.js';
export { SkillImportError } from './import-error.js';

export const gdeclawApiBaseUrlEnv = 'GDECLAW_API_BASE_URL';

export async function resolveSkillImportEndpoint(executionRoot = packageRoot): Promise<URL> {
  const base = await readRuntimeEnvironmentValue(gdeclawApiBaseUrlEnv, executionRoot);
  if (!base) throw new Error('缺少 GDECLAW_API_BASE_URL，请由 GDEClaw 宿主注入实际 API 地址');
  let url: URL;
  try { url = new URL('/api/gdeclaw/skills/import', base); }
  catch { throw new Error('GDECLAW_API_BASE_URL 必须是合法的 HTTP(S) API 基础地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('GDECLAW_API_BASE_URL 必须使用 HTTP(S)，且不能包含用户凭据');
  }
  return url;
}

export function skillImportUrl(skillName: string, endpoint: URL): URL {
  const url = new URL(endpoint);
  url.searchParams.set('enable', 'true');
  url.searchParams.set('target_name', requireSkillName(skillName));
  return url;
}

function responseDetail(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const value = body as Record<string, unknown>;
  const detail = value.detail ?? value.message ?? value.error;
  if (typeof detail === 'string') return detail.slice(0, 1000);
  return '';
}

async function verifyImportResponse(response: Response, context: ImportContext, signal: AbortSignal): Promise<void> {
  let raw: string;
  try { raw = await response.text(); }
  catch (error) {
    if (!response.ok) throw httpImportError(context, response.status, '响应读取失败', error);
    throw networkImportError(context, error, signal.aborted, response.status);
  }
  let body: unknown;
  try { body = JSON.parse(raw); }
  catch (error) {
    if (!response.ok) throw httpImportError(context, response.status, raw, error);
    throw responseImportError(context, response.status, 'GDE_RESPONSE_INVALID_JSON', raw, error);
  }
  if (!response.ok) throw httpImportError(context, response.status, responseDetail(body) || raw);
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw responseImportError(context, response.status, 'GDE_RESPONSE_INVALID_OBJECT', raw);
  }
  const result = body as Record<string, unknown>;
  if (result.success === false || result.ok === false || result.status === 'failed' || result.status === 'error' || Boolean(result.error)) {
    throw responseImportError(context, response.status, 'GDE_IMPORT_REJECTED', responseDetail(body) || raw);
  }
}

export async function importSkillArchive(options: {
  url: URL; skillName: string; zipPath: string;
}, dependencies: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<void> {
  const form = new FormData();
  const bytes = await readFile(options.zipPath);
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/zip' }), `${requireSkillName(options.skillName)}.zip`);
  const signal = AbortSignal.timeout(dependencies.timeoutMs ?? 60_000);
  let response: Response;
  try {
    response = await (dependencies.fetch ?? fetch)(options.url, { method: 'POST', body: form, signal, redirect: 'error' });
  } catch (error) {
    throw networkImportError(options, error, signal.aborted);
  }
  await verifyImportResponse(response, options, signal);
}
