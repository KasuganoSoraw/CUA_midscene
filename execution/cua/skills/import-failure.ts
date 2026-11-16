import { errorNodes, SkillImportError } from './import-error.js';

export interface ImportContext { url: URL; zipPath: string }
const draftRetained = '生成草稿已保留。';
const uncertain = '是否已安装尚未确认，请先检查 GDE 中的对应技能和服务日志。';
const certificateCodes = new Set(['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID']);

function networkReason(error: unknown, timedOut: boolean): { code: string; message: string } {
  const nodes = errorNodes(error);
  const codes = nodes.filter(node => node.terminal).map(node => node.code);
  const all = (values: Set<string>) => codes.length > 0 && codes.every(code => values.has(code));
  if (all(new Set(['ECONNREFUSED']))) return { code: 'GDE_CONNECTION_REFUSED', message: '无法连接 GDE 服务，请确认 GDE 服务已启动，并检查服务地址和端口。' };
  if (all(new Set(['ENOTFOUND', 'EAI_AGAIN']))) return { code: 'GDE_DNS_FAILED', message: '无法解析 GDE 服务地址，请检查服务地址和网络连接。' };
  if (all(certificateCodes)) return { code: 'GDE_CERTIFICATE_FAILED', message: 'GDE 服务的 HTTPS 证书校验失败，请检查证书和服务地址。' };
  if (all(new Set(['UND_ERR_CONNECT_TIMEOUT']))) return { code: 'GDE_CONNECT_TIMEOUT', message: '连接 GDE 服务超时，请检查服务地址、端口和网络连接。' };
  if (all(new Set(['EHOSTUNREACH', 'ENETUNREACH']))) return { code: 'GDE_NETWORK_UNREACHABLE', message: '无法访问 GDE 服务所在网络，请检查网络连接和服务地址。' };
  if (nodes.some(node => node.message.toLowerCase() === 'unexpected redirect')) {
    return { code: 'GDE_UNEXPECTED_REDIRECT', message: `GDE 导入请求发生重定向，请检查服务地址。${uncertain}` };
  }
  if (timedOut || codes.some(code => ['ETIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code))) {
    return { code: 'GDE_IMPORT_TIMEOUT', message: `等待 GDE 导入结果超时，${uncertain}` };
  }
  if (codes.some(code => ['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(code))) {
    return { code: 'GDE_CONNECTION_INTERRUPTED', message: `与 GDE 服务的连接中断，${uncertain}` };
  }
  return { code: 'GDE_NETWORK_FAILED', message: `未能获取 GDE 的导入结果，${uncertain}` };
}

export function networkImportError(context: ImportContext, error: unknown, timedOut: boolean, remoteStatus?: number): SkillImportError {
  const reason = networkReason(error, timedOut);
  return new SkillImportError(reason.message + draftRetained, context.zipPath, remoteStatus,
    { url: context.url, code: reason.code, cause: error });
}

function httpMessage(status: number): string {
  const messages: Record<number, string> = {
    400: 'GDE 拒绝导入技能，请检查技能包内容并查看详细日志。',
    401: 'GDE 服务要求身份验证，请检查服务访问配置。',
    403: '没有导入技能的权限，请检查 GDE 服务访问权限。',
    404: '未找到 GDE 技能导入接口，请检查 GDE 服务地址和版本。',
    405: 'GDE 服务不支持当前导入请求，请检查服务地址和版本。',
    409: 'Skill 名称冲突，未覆盖已有技能，请检查 GDE 中的同名技能。',
    413: '技能包过大，GDE 服务拒绝接收，请检查上传大小限制。',
    415: 'GDE 服务不支持当前技能包格式，请检查服务版本。',
    422: '技能包内容校验未通过，请查看详细日志。',
    429: 'GDE 服务请求过于频繁，请稍后再试。',
    502: 'GDE 服务网关异常，请检查 GDE 服务状态。',
    503: 'GDE 服务暂时不可用，请检查服务状态后再试。',
    504: `GDE 服务网关等待导入结果超时，${uncertain}`,
  };
  if (messages[status]) return messages[status];
  if (status >= 500) return 'GDE 服务处理导入时发生异常，请检查 GDE 服务日志。';
  return 'GDE 拒绝导入技能，请查看详细日志。';
}

export function httpImportError(context: ImportContext, status: number, detail: string, cause?: unknown): SkillImportError {
  return new SkillImportError(httpMessage(status) + draftRetained, context.zipPath, status,
    { url: context.url, code: `GDE_HTTP_${status}`, detail, cause });
}

export function responseImportError(context: ImportContext, status: number, code: string, detail: string, cause?: unknown): SkillImportError {
  let message = `GDE 未返回有效的导入结果，${uncertain}`;
  if (code === 'GDE_RESPONSE_INVALID_JSON') message = `GDE 导入响应不是有效 JSON，${uncertain}`;
  if (code === 'GDE_IMPORT_REJECTED') message = 'GDE 报告技能导入失败，请查看详细日志。';
  return new SkillImportError(message + draftRetained, context.zipPath, status,
    { url: context.url, code, detail, cause });
}
