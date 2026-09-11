export type HttpMethod =
  | 'GET'
  | 'POST'
  | 'PUT'
  | 'PATCH'
  | 'DELETE'
  | 'HEAD'
  | 'OPTIONS';

/** Minimal interface for injecting a custom logger. */
export interface Logger {
  error(message: string, ...meta: unknown[]): void;
  warn?(message: string, ...meta: unknown[]): void;
  info?(message: string, ...meta: unknown[]): void;
  debug?(message: string, ...meta: unknown[]): void;
}

/** Query parameter values: primitives, arrays of primitives, or undefined/null (skipped). */
export type QueryParamValue =
  | string
  | number
  | boolean
  | undefined
  | null
  | Array<string | number | boolean>;

export type QueryParams = Record<string, QueryParamValue>;

export interface RetryDecisionContext {
  attempt: number;
  maxRetries: number;
  method: HttpMethod;
  url: string;
  response?: Response;
  error?: unknown;
}

export interface RetryInfo extends RetryDecisionContext {
  delayMs: number;
}

export interface RetryOptions {
  /** Number of retries after the first attempt. Default: 3 */
  retries?: number;
  /** Delay before the first retry (ms). Default: 1000 */
  baseDelayMs?: number;
  /** Upper bound on delay (ms). Default: 30000 */
  maxDelayMs?: number;
  /** Exponential backoff multiplier. Default: 2 */
  factor?: number;
  /** Whether to apply full jitter to the delay. Default: true */
  jitter?: boolean;
  /** HTTP status codes that trigger a retry. Default: [408, 429, 500, 502, 503, 504] */
  retryOnStatusCodes?: number[];
  /**
   * Custom predicate for retry decisions.
   * When set, combined with retryOnStatusCodes via OR: return true to retry.
   */
  shouldRetry?: (ctx: RetryDecisionContext) => boolean;
  /**
   * Fully custom delay computation.
   * The return value is not capped by maxDelayMs; the caller is responsible.
   */
  computeDelay?: (ctx: RetryDecisionContext, defaultDelayMs: number) => number;
  /** Called before each retry attempt (logging, metrics, etc.). */
  onRetry?: (info: RetryInfo) => void;
}

export interface FetchKitOptions {
  /** Base URL prepended to all request paths. */
  baseUrl?: string;
  /** Default headers applied to every request. */
  headers?: Record<string, string>;
  /** Custom logger. If omitted, nothing is logged. */
  logger?: Logger;
  /** Default retry settings; overridable per request. */
  retry?: RetryOptions;
  /** Per-request timeout (ms). Default: none (unlimited). */
  timeoutMs?: number;
  /** Override fetch for tests or environment-specific behavior. */
  fetchImpl?: typeof fetch;
}

export interface RequestOptions<TBody = unknown> {
  method?: HttpMethod;
  params?: QueryParams;
  headers?: Record<string, string>;
  body?: TBody;
  /** Send body as-is without JSON.stringify. */
  rawBody?: BodyInit;
  timeoutMs?: number;
  retry?: RetryOptions;
  signal?: AbortSignal;
}

/**
 * Single config object for a request, including URL.
 * Usage: `request({ url: '/users', method: 'POST', body: {...} })`.
 */
export interface RequestConfig<TBody = unknown> extends RequestOptions<TBody> {
  /** Request URL. Joined with baseUrl when set; otherwise used as the full URL. */
  url: string;
}

export interface FetchKitResponse<T> {
  data: T;
  status: number;
  headers: Headers;
  response: Response;
}

export class FetchKitError extends Error {
  readonly url: string;
  readonly method: HttpMethod;
  readonly status?: number;
  readonly response?: Response;
  readonly cause?: unknown;

  constructor(message: string, info: {
    url: string;
    method: HttpMethod;
    status?: number;
    response?: Response;
    cause?: unknown;
  }) {
    super(message);
    this.name = 'FetchKitError';
    this.url = info.url;
    this.method = info.method;
    this.status = info.status;
    this.response = info.response;
    this.cause = info.cause;
  }
}
