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

export function buildUrl(baseUrl: string | undefined, path: string, params?: QueryParams): string {
  const base = baseUrl ? baseUrl.replace(/\/+$/, '') : '';
  const suffix = path.startsWith('/') || !base ? path : `/${path}`;
  return `${base}${suffix}${buildQueryString(params)}`;
}

export function isNetworkError(error: unknown): boolean {
  // AbortError means user cancellation; do not retry.
  return !(error instanceof DOMException && error.name === 'AbortError');
}
