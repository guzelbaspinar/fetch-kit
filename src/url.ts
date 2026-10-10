import type { QueryParams } from './types.js';

export function buildQueryString(params?: QueryParams): string {
  if (!params) return '';
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    if (Array.isArray(value)) {
      for (const item of value) search.append(key, String(item));
    } else {
      search.append(key, String(value));
    }
  }
  const qs = search.toString();
  return qs ? `?${qs}` : '';
}

function appendQuery(url: string, params?: QueryParams): string {
  const qs = buildQueryString(params).slice(1);
  if (!qs) return url;
  const hashIdx = url.indexOf('#');
  const main = hashIdx === -1 ? url : url.slice(0, hashIdx);
  const fragment = hashIdx === -1 ? '' : url.slice(hashIdx);
  const sep = main.includes('?') ? (main.endsWith('?') || main.endsWith('&') ? '' : '&') : '?';
  return `${main}${sep}${qs}${fragment}`;
}

export function buildUrl(baseUrl: string | undefined, path: string, params?: QueryParams): string {
  if (/^https?:\/\//i.test(path)) {
    // Absolute URL: ignore baseUrl entirely to avoid producing an invalid combined URL.
    return appendQuery(path, params);
  }
  const base = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
  const suffix = path.startsWith('/') || !base ? path : `/${path}`;
  return appendQuery(`${base}${suffix}`, params);
}

/** Node/undici error codes that indicate a genuine network-level failure. */
const NETWORK_ERROR_CODES = new Set([
  'ECONNRESET',
  'ECONNREFUSED',
  'ETIMEDOUT',
  'ENOTFOUND',
  'EAI_AGAIN',
  'EPIPE',
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ENETDOWN',
  'UND_ERR_CONNECT_TIMEOUT',
  'UND_ERR_SOCKET'
]);

export function isNetworkError(error: unknown): boolean {
  // Our own timeout abort: retryable.
  if (error instanceof DOMException && error.name === 'TimeoutError') return true;

  // AbortError means user cancellation; do not retry.
  if (error instanceof DOMException && error.name === 'AbortError') return false;

  // `fetch`/undici throw a `TypeError` (e.g. "fetch failed", "Failed to fetch") for
  // connection-level failures (DNS, refused connections, TLS issues, etc.).
  if (error instanceof TypeError) return true;

  // Node error objects often carry a `code` identifying the underlying syscall failure.
  if (error && typeof error === 'object' && 'code' in error) {
    const code = (error as { code?: unknown }).code;
    if (typeof code === 'string' && NETWORK_ERROR_CODES.has(code)) return true;
  }

  // Anything else (programming errors, unexpected throws from a custom fetchImpl, etc.)
  // is not treated as a retryable network error to avoid masking real bugs.
  return false;
}
