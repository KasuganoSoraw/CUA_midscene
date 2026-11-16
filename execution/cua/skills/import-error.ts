interface ErrorNode { name: string; message: string; code: string; terminal: boolean }
interface ImportErrorDetails { url?: URL; code?: string; detail?: string; cause?: unknown }

export function errorNodes(error: unknown): ErrorNode[] {
  const pending: unknown[] = [error];
  const seen = new Set<unknown>();
  const nodes: ErrorNode[] = [];
  while (pending.length && nodes.length < 16) {
    const value = pending.shift();
    if (seen.has(value)) continue;
    seen.add(value);
    if (!value || typeof value !== 'object') {
      nodes.push({ name: 'Error', message: String(value).slice(0, 1000), code: '', terminal: true });
      continue;
    }
    const item = value as Record<string, unknown>;
    const children: unknown[] = [];
    if (item.cause !== undefined) children.push(item.cause);
    if (Array.isArray(item.errors)) children.push(...item.errors);
    nodes.push({ name: String(item.name ?? 'Error'), message: String(item.message ?? '').slice(0, 1000),
      code: String(item.code ?? ''), terminal: children.length === 0 });
    pending.push(...children);
  }
  if (pending.length) nodes.push({ name: 'Error', message: '错误链过长', code: '', terminal: true });
  return nodes;
}

export function requestAddress(url: URL): string {
  const safe = new URL(url);
  safe.username = '';
  safe.password = '';
  safe.search = '';
  safe.hash = '';
  for (const key of ['enable', 'target_name']) {
    const value = url.searchParams.get(key);
    if (value !== null) safe.searchParams.set(key, value);
  }
  return safe.toString();
}

export class SkillImportError extends Error {
  readonly userMessage: string;
  readonly diagnostics: string;
  readonly code: string;
  constructor(message: string, readonly zipPath: string, readonly remoteStatus?: number, details: ImportErrorDetails = {}) {
    const lines = [`错误类型：${details.code ?? 'GDE_IMPORT_FAILED'}`];
    if (details.url) lines.push(`请求地址：${requestAddress(details.url)}`);
    if (remoteStatus !== undefined) lines.push(`HTTP ${remoteStatus}`);
    if (details.detail) lines.push(`服务响应：${details.detail.slice(0, 2000)}`);
    if (details.cause !== undefined) {
      for (const node of errorNodes(details.cause)) lines.push(`${node.name} ${node.code}: ${node.message}`);
    }
    lines.push(`ZIP 产物：${zipPath}`);
    const diagnostics = lines.join('\n');
    super(`${message}\n${diagnostics}`, { cause: details.cause });
    this.name = 'SkillImportError';
    this.userMessage = message;
    this.diagnostics = diagnostics;
    this.code = details.code ?? 'GDE_IMPORT_FAILED';
  }
}
