import { readFile } from 'node:fs/promises';
import { readRuntimeEnvironmentValue } from '../environment.js';
import { packageRoot } from '../package-root.js';
import { requireSkillName } from './paths.js';

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

export class SkillImportError extends Error {
  constructor(message: string, readonly zipPath: string, readonly remoteStatus?: number) {
    super(`${message}\nZIP 产物：${zipPath}`);
    this.name = 'SkillImportError';
  }
}

function responseDetail(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const value = body as Record<string, unknown>;
  const detail = value.detail ?? value.message ?? value.error;
  if (typeof detail === 'string') return detail.slice(0, 1000);
  return '';
}

async function verifyImportResponse(response: Response, zipPath: string): Promise<void> {
  let body: unknown;
  try { body = await response.json(); }
  catch {
    if (response.ok) throw new SkillImportError('GDEClaw 导入响应不是有效 JSON，结果尚未确认，请先核实宿主状态', zipPath);
  }
  if (!response.ok) {
    const detail = responseDetail(body);
    const conflict = response.status === 409 ? 'Skill 名称冲突，未覆盖已有 Skill' : 'GDEClaw Skill 导入失败';
    throw new SkillImportError(`${conflict}（HTTP ${response.status}）${detail ? `：${detail}` : ''}`, zipPath, response.status);
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new SkillImportError('GDEClaw 导入成功响应缺少有效对象，请先核实宿主状态', zipPath);
  }
  const result = body as Record<string, unknown>;
  if (result.success === false || result.ok === false || result.status === 'failed' || result.status === 'error' || Boolean(result.error)) {
    throw new SkillImportError(`GDEClaw 未确认导入成功：${responseDetail(body) || '响应报告失败'}`, zipPath);
  }
}

export async function importSkillArchive(options: {
  url: URL; skillName: string; zipPath: string;
}, dependencies: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<void> {
  const form = new FormData();
  const bytes = await readFile(options.zipPath);
  form.append('file', new Blob([new Uint8Array(bytes)], { type: 'application/zip' }), `${requireSkillName(options.skillName)}.zip`);
  const signal = AbortSignal.timeout(dependencies.timeoutMs ?? 60_000);
  try {
    const response = await (dependencies.fetch ?? fetch)(options.url, { method: 'POST', body: form, signal, redirect: 'error' });
    await verifyImportResponse(response, options.zipPath);
  } catch (error) {
    if (error instanceof SkillImportError) throw error;
    const reason = signal.aborted ? '请求超时' : '网络或响应读取失败';
    throw new SkillImportError(`${reason}，导入结果不确定；请先核实 GDEClaw 中是否已安装，勿直接换名重传`, options.zipPath);
  }
}
