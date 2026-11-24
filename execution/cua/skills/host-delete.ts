import { resolveGdeApiEndpoint } from './host-api.js';
import { classifyGdeNetworkError } from './host-network.js';
import { errorNodes, requestAddress } from './import-error.js';
import { requireSkillName } from './paths.js';

interface DeleteFailure { code: string; status?: number; detail?: string; cause?: unknown }
export class SkillDeleteError extends Error {
  readonly diagnostics: string;
  readonly statusCode: number;
  constructor(readonly userMessage: string, url: URL, readonly failure: DeleteFailure) {
    const lines = [`错误类型：${failure.code}`, `请求地址：DELETE ${requestAddress(url)}`];
    if (failure.status !== undefined) lines.push(`HTTP ${failure.status}`);
    if (failure.detail) lines.push(`服务响应：${failure.detail.slice(0, 2000)}`);
    if (failure.cause !== undefined) {
      for (const node of errorNodes(failure.cause)) lines.push(`${node.name} ${node.code}: ${node.message}`);
    }
    const diagnostics = lines.join('\n');
    super(`${userMessage}\n${diagnostics}`, { cause: failure.cause });
    this.name = 'SkillDeleteError';
    this.diagnostics = diagnostics;
    this.statusCode = 502;
    if (failure.status !== undefined && failure.status >= 400 && failure.status <= 599) this.statusCode = failure.status;
  }
}

function networkDeleteError(url: URL, error: unknown, timedOut: boolean): SkillDeleteError {
  const kind = classifyGdeNetworkError(error, timedOut);
  const messages = {
    refused: '无法连接 GDE 服务，请确认服务已启动，并检查服务地址和端口。',
    dns: '无法解析 GDE 服务地址，请检查服务地址和网络连接。',
    certificate: 'GDE 服务的 HTTPS 证书校验失败，请检查证书和服务地址。',
    connectTimeout: '连接 GDE 服务超时，请检查服务地址、端口和网络连接。',
    unreachable: '无法访问 GDE 服务所在网络，请检查网络连接和服务地址。',
    redirect: 'GDE 删除请求发生重定向，请检查服务地址；是否已删除尚未确认。',
    timeout: '等待 GDE 删除结果超时，是否已删除尚未确认，请检查 GDE 中的对应技能后重试。',
    interrupted: '与 GDE 服务的连接中断，是否已删除尚未确认，请检查 GDE 中的对应技能后重试。',
    unknown: '未能获取 GDE 的删除结果，是否已删除尚未确认，请检查服务日志。',
  };
  return new SkillDeleteError(`${messages[kind]}本地卡片和资产记录已保留。`, url,
    { code: `GDE_DELETE_${kind.toUpperCase()}`, cause: error });
}

function responseDeleteError(url: URL, status: number, detail: string, code = `GDE_DELETE_HTTP_${status}`): SkillDeleteError {
  let message = 'GDE 未确认技能删除成功，请查看服务日志。';
  if (status === 401 || status === 403) message = '没有删除技能的权限，请检查 GDE 服务访问配置。';
  if (status === 404) message = '未找到 GDE 技能删除接口或对应技能，请检查服务地址和技能状态。';
  if (status === 409) message = 'GDE 拒绝删除当前技能，请确认技能未被占用或执行。';
  if (status === 202 || code === 'GDE_DELETE_PENDING') message = 'GDE 已接收删除请求，但尚未确认完成，请稍后检查技能状态后重试。';
  if (status >= 500) message = 'GDE 服务删除技能时发生异常，请检查服务状态和日志后重试。';
  return new SkillDeleteError(`${message}本地卡片和资产记录已保留。`, url, { code, status, detail });
}

function confirmsMissingSkill(body: unknown): boolean {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return false;
  const value = body as Record<string, unknown>;
  if (value.code === 'SKILL_NOT_FOUND') return true;
  const message = value.detail ?? value.message ?? value.error;
  return typeof message === 'string' && /\bskill\b.*\bnot found\b|技能.*(?:不存在|未找到)/i.test(message);
}

function isRejectedResult(result: Record<string, unknown>): boolean {
  return (
    result.success === false
    || result.ok === false
    || result.deleted === false
    || result.status === 'error'
    || result.status === 'failed'
    || Boolean(result.error)
  );
}

function verifyDeletionBody(response: Response, body: unknown, raw: string, url: URL): void {
  if (response.status !== 200 || !body || typeof body !== 'object' || Array.isArray(body)) {
    throw responseDeleteError(url, response.status, raw, 'GDE_DELETE_INVALID_RESPONSE');
  }
  const result = body as Record<string, unknown>;
  if (['pending', 'running', 'accepted', 'processing'].includes(String(result.status))) {
    throw responseDeleteError(url, response.status, raw, 'GDE_DELETE_PENDING');
  }
  if (isRejectedResult(result)) {
    throw responseDeleteError(url, response.status, raw, 'GDE_DELETE_REJECTED');
  }
}

async function verifyDeletion(response: Response, url: URL, signal: AbortSignal): Promise<void> {
  if (response.status === 204 || response.status === 205) return;
  let raw: string;
  try { raw = await response.text(); }
  catch (error) { throw networkDeleteError(url, error, signal.aborted); }
  if (response.status === 202) throw responseDeleteError(url, response.status, raw);
  if (response.status === 200 && !raw.trim()) return;
  let body: unknown;
  try { body = JSON.parse(raw); }
  catch { throw responseDeleteError(url, response.status, raw, 'GDE_DELETE_INVALID_RESPONSE'); }
  if (response.status === 404 && confirmsMissingSkill(body)) return;
  if (!response.ok) throw responseDeleteError(url, response.status, raw);
  verifyDeletionBody(response, body, raw, url);
}

export async function deleteHostSkill(options: { skillName: string; executionRoot?: string },
  dependencies: { fetch?: typeof fetch; timeoutMs?: number } = {}): Promise<void> {
  const name = requireSkillName(options.skillName);
  const url = await resolveGdeApiEndpoint(`/api/skills/${encodeURIComponent(name)}`, options.executionRoot);
  const signal = AbortSignal.timeout(dependencies.timeoutMs ?? 60_000);
  let response: Response;
  try { response = await (dependencies.fetch ?? fetch)(url, { method: 'DELETE', signal, redirect: 'error' }); }
  catch (error) { throw networkDeleteError(url, error, signal.aborted); }
  await verifyDeletion(response, url, signal);
}
