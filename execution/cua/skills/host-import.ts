import { readFile } from 'node:fs/promises';
import { resolveGdeApiEndpoint } from './host-api.js';
export { gdeclawApiBaseUrlEnv } from './host-api.js';
import { requireSkillName } from './paths.js';
import { httpImportError, networkImportError, responseImportError, type ImportContext } from './import-failure.js';
export { SkillImportError } from './import-error.js';

export function resolveSkillImportEndpoint(executionRoot?: string): Promise<URL> {
  return resolveGdeApiEndpoint('/api/gdeclaw/skills/import', executionRoot);
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
