import { errorNodes } from './import-error.js';

export type GdeNetworkError = 'refused' | 'dns' | 'certificate' | 'connectTimeout' | 'unreachable' | 'redirect' | 'timeout' | 'interrupted' | 'unknown';
const certificateCodes = new Set(['CERT_HAS_EXPIRED', 'CERT_NOT_YET_VALID', 'DEPTH_ZERO_SELF_SIGNED_CERT',
  'SELF_SIGNED_CERT_IN_CHAIN', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'UNABLE_TO_GET_ISSUER_CERT_LOCALLY', 'ERR_TLS_CERT_ALTNAME_INVALID']);

export function classifyGdeNetworkError(error: unknown, timedOut: boolean): GdeNetworkError {
  const nodes = errorNodes(error);
  const codes = nodes.filter(node => node.terminal).map(node => node.code);
  const all = (values: Set<string>) => codes.length > 0 && codes.every(code => values.has(code));
  if (all(new Set(['ECONNREFUSED']))) return 'refused';
  if (all(new Set(['ENOTFOUND', 'EAI_AGAIN']))) return 'dns';
  if (all(certificateCodes)) return 'certificate';
  if (all(new Set(['UND_ERR_CONNECT_TIMEOUT']))) return 'connectTimeout';
  if (all(new Set(['EHOSTUNREACH', 'ENETUNREACH']))) return 'unreachable';
  if (nodes.some(node => node.message.toLowerCase() === 'unexpected redirect')) return 'redirect';
  if (timedOut || codes.some(code => ['ETIMEDOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT'].includes(code))) return 'timeout';
  if (codes.some(code => ['ECONNRESET', 'EPIPE', 'UND_ERR_SOCKET'].includes(code))) return 'interrupted';
  return 'unknown';
}
