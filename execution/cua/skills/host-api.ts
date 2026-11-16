import { readRuntimeEnvironmentValue } from '../environment.js';
import { packageRoot } from '../package-root.js';

export const gdeclawApiBaseUrlEnv = 'GDECLAW_API_BASE_URL';

export async function resolveGdeApiEndpoint(route: string, executionRoot = packageRoot): Promise<URL> {
  const base = await readRuntimeEnvironmentValue(gdeclawApiBaseUrlEnv, executionRoot);
  if (!base) throw new Error('缺少 GDECLAW_API_BASE_URL，请由 GDEClaw 宿主注入实际 API 地址');
  let url: URL;
  try { url = new URL(route, base); }
  catch { throw new Error('GDECLAW_API_BASE_URL 必须是合法的 HTTP(S) API 基础地址'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) {
    throw new Error('GDECLAW_API_BASE_URL 必须使用 HTTP(S)，且不能包含用户凭据');
  }
  return url;
}
