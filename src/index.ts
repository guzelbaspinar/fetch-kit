import { computeExponentialDelay, sleep } from './backoff.js';
import { buildUrl, isNetworkError } from './url.js';
import {
  FetchKitError,
  type FetchKitOptions,
  type FetchKitResponse,
  type HttpMethod,
  type Logger,
  type RequestConfig,
  type RetryDecisionContext,
  type RetryOptions
} from './types.js';

export * from './types.js';
export { buildUrl, buildQueryString } from './url.js';
export { computeExponentialDelay } from './backoff.js';

const DEFAULT_RETRY: Required<
  Pick<RetryOptions, 'retries' | 'baseDelayMs' | 'maxDelayMs' | 'factor' | 'jitter' | 'retryOnStatusCodes'>
> = {
  retries: 3,
  baseDelayMs: 1000,
  maxDelayMs: 30_000,
  factor: 2,
  jitter: true,
  retryOnStatusCodes: [408, 429, 500, 502, 503, 504]
};

const noopLogger: Logger = {
  error: () => {},
  warn: () => {},
  info: () => {},
  debug: () => {}
};

function mergeRetryOptions(
  defaults: RetryOptions | undefined,
  perRequest: RetryOptions | undefined
): Required<Pick<RetryOptions, 'retries' | 'baseDelayMs' | 'maxDelayMs' | 'factor' | 'jitter' | 'retryOnStatusCodes'>> &
  RetryOptions {
  const merged = {
    ...DEFAULT_RETRY,
    ...stripUndefined(defaults),
    ...stripUndefined(perRequest)
  };
  // Guard against NaN / negative / fractional values: fall back to default or clamp to >= 0.
  const retries = merged.retries as unknown;
  merged.retries =
    typeof retries === 'number' && Number.isFinite(retries)
      ? Math.max(0, Math.floor(retries))
      : DEFAULT_RETRY.retries;
  return merged;
}

function stripUndefined<T extends object>(obj: T | undefined): Partial<T> {
  if (!obj) return {};
  return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

/**
 * Internal engine. Not exported as a class — a single singleton used via `configure()` and `request()`,
 * so consumers never need `new` or `createFetchKit()`.
 */
class FetchKitEngine {
  baseUrl?: string;
  defaultHeaders: Record<string, string> = {};
  logger: Logger = noopLogger;
  defaultRetry?: RetryOptions;
  defaultTimeoutMs?: number;
  fetchImpl?: typeof fetch;

  configure(options: FetchKitOptions): void {
    if (options.baseUrl !== undefined) this.baseUrl = options.baseUrl;
    if (options.headers !== undefined) this.defaultHeaders = { ...this.defaultHeaders, ...options.headers };
    if (options.logger !== undefined) this.logger = options.logger;
    if (options.retry !== undefined) this.defaultRetry = { ...this.defaultRetry, ...options.retry };
    if (options.timeoutMs !== undefined) this.defaultTimeoutMs = options.timeoutMs;
    if (options.fetchImpl !== undefined) this.fetchImpl = options.fetchImpl;
  }

  async request<TResponse = unknown, TBody = unknown>(
    config: RequestConfig<TBody>
  ): Promise<FetchKitResponse<TResponse>> {
    const method: HttpMethod = config.method ?? 'GET';
    const url = buildUrl(this.baseUrl, config.url, config.params);
    const retryConfig = mergeRetryOptions(this.defaultRetry, config.retry);
    const timeoutMs = config.timeoutMs ?? this.defaultTimeoutMs;

    // Header names are case-insensitive: a later source replaces an earlier header of any casing,
    // while the original casing of the winning key is preserved.
    const headers: Record<string, string> = {};
    for (const source of [this.defaultHeaders, config.headers]) {
      for (const [key, value] of Object.entries(source ?? {})) {
        const lower = key.toLowerCase();
        for (const existing of Object.keys(headers)) {
          if (existing.toLowerCase() === lower) delete headers[existing];
        }
        headers[key] = value;
      }
    }

    let body: BodyInit | undefined;
    if (config.rawBody !== undefined) {
      body = config.rawBody;
    } else if (config.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      body = JSON.stringify(config.body);
      const hasContentType = Object.keys(headers).some((k) => k.toLowerCase() === 'content-type');
      if (!hasContentType) headers['Content-Type'] = 'application/json';
    }

    if (config.rawBody !== undefined && (method === 'GET' || method === 'HEAD')) {
      throw new FetchKitError(`${method} requests cannot have a body (rawBody) for ${url}`, {
        url,
        method,
        cause: new TypeError(`Request with ${method} method cannot have body`)
      });
    }

    const maxAttempts = retryConfig.retries + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      let timer: ReturnType<typeof setTimeout> | undefined;
      const onUserAbort = () => controller.abort(config.signal!.reason);

      const cleanup = () => {
        if (timer !== undefined) clearTimeout(timer);
        timer = undefined;
        config.signal?.removeEventListener('abort', onUserAbort);
      };

      if (timeoutMs) {
        timer = setTimeout(
          () => controller.abort(new DOMException(`Timeout after ${timeoutMs}ms`, 'TimeoutError')),
          timeoutMs
        );
      }
      if (config.signal) {
        if (config.signal.aborted) controller.abort(config.signal.reason);
        else config.signal.addEventListener('abort', onUserAbort, { once: true });
      }

      try {
        const doFetch = this.fetchImpl ?? globalThis.fetch;
        const response = await doFetch(url, {
          method,
          headers,
          body,
          signal: controller.signal
        });

        const isRetryableStatus = retryConfig.retryOnStatusCodes.includes(response.status);
        const decisionCtx: RetryDecisionContext = { attempt, maxRetries: retryConfig.retries, method, url, response };
        const shouldRetryStatus =
          !response.ok && (retryConfig.shouldRetry?.(decisionCtx) ?? isRetryableStatus);

        if (!response.ok && shouldRetryStatus && attempt < maxAttempts) {
          // Release the connection held by the discarded response.
          await response.body?.cancel().catch(() => {});
          cleanup();
          await this.waitBeforeRetry(attempt, retryConfig, decisionCtx, config.signal);
          continue;
        }

        if (!response.ok) {
          // Read from a clone so `error.response` stays readable for the caller.
          const text = await response.clone().text().catch(() => '');
          this.logger.error?.(
            `fetch-kit: ${method} ${url} failed after ${attempt} attempt(s), giving up.`,
            { status: response.status }
          );
          throw new FetchKitError(`HTTP ${response.status} for ${method} ${url}`, {
            url,
            method,
            status: response.status,
            response,
            cause: text
          });
        }

        // Timeout stays active while the body is being read.
        const data = await this.parseBody<TResponse>(response, method);
        return { data, status: response.status, headers: response.headers, response };
      } catch (error) {
        cleanup();
        lastError = error;

        if (error instanceof FetchKitError) throw error;

        const isLastAttempt = attempt >= maxAttempts;
        const decisionCtx: RetryDecisionContext = { attempt, maxRetries: retryConfig.retries, method, url, error };
        const userAborted = config.signal?.aborted === true;
        const shouldRetryError = userAborted
          ? false
          : (retryConfig.shouldRetry?.(decisionCtx) ?? isNetworkError(error));

        if (isLastAttempt || !shouldRetryError) {
          this.logger.error?.(`fetch-kit: ${method} ${url} failed after ${attempt} attempt(s), giving up.`, error);
          throw new FetchKitError(`Request failed for ${method} ${url}`, { url, method, cause: error });
        }

        await this.waitBeforeRetry(attempt, retryConfig, decisionCtx, config.signal);
      } finally {
        cleanup();
      }
    }

    // Unreachable in normal flow.
    throw new FetchKitError(`Request failed for ${method} ${url}`, { url, method, cause: lastError });
  }

  private async waitBeforeRetry(
    attempt: number,
    retryConfig: RetryOptions & Required<Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'factor' | 'jitter'>>,
    ctx: RetryDecisionContext,
    signal?: AbortSignal
  ): Promise<void> {
    const defaultDelay = computeExponentialDelay(attempt, retryConfig);
    const delayMs = retryConfig.computeDelay ? retryConfig.computeDelay(ctx, defaultDelay) : defaultDelay;

    retryConfig.onRetry?.({ ...ctx, delayMs });
    this.logger.warn?.(
      `fetch-kit: ${ctx.method} ${ctx.url} failed on attempt ${attempt}, retrying in ${delayMs}ms.`,
      ctx.error ?? ctx.response?.status
    );

    await sleep(delayMs, signal);
  }

  private async parseBody<T>(response: Response, method: HttpMethod): Promise<T> {
    if (response.status === 204 || method === 'HEAD') return undefined as T;
    const contentType = response.headers.get('content-type') ?? '';
    if (/application\/([^;\s]*\+)?json/i.test(contentType)) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }
}

// Share one engine across ESM/CJS copies of this package (dual package hazard).
const ENGINE_KEY = Symbol.for('@guzelbaspinar/fetch-kit/engine');
const globalStore = globalThis as unknown as Record<symbol, FetchKitEngine | undefined>;
const engine: FetchKitEngine = (globalStore[ENGINE_KEY] ??= new FetchKitEngine());

/**
 * Sets global defaults: baseUrl, headers, logger, retry, timeoutMs, fetchImpl.
 * Call once at app startup; subsequent `request()` calls inherit these (overridable per request).
 *
 *   import { configure } from '@guzelbaspinar/fetch-kit';
 *   configure({ baseUrl: 'https://api.example.com', logger: myLogger });
 */
export function configure(options: FetchKitOptions): void {
  engine.configure(options);
}

/**
 * Resets global configuration to factory defaults (baseUrl, headers, logger, retry,
 * timeoutMs, fetchImpl). Primarily for tests to avoid config leaking between cases;
 * rarely needed in application code.
 *
 *   import { resetConfiguration } from '@guzelbaspinar/fetch-kit';
 *   beforeEach(() => resetConfiguration());
 */
export function resetConfiguration(): void {
  engine.baseUrl = undefined;
  engine.defaultHeaders = {};
  engine.logger = noopLogger;
  engine.defaultRetry = undefined;
  engine.defaultTimeoutMs = undefined;
  engine.fetchImpl = undefined;
}

/**
 * Issues a single HTTP request. All options, including `url`, are passed in one config object.
 *
 *   import { request } from '@guzelbaspinar/fetch-kit';
 *   const { data } = await request({ url: 'https://api.example.com/users' });
 */
export function request<TResponse = unknown, TBody = unknown>(
  config: RequestConfig<TBody>
): Promise<FetchKitResponse<TResponse>> {
  return engine.request<TResponse, TBody>(config);
}
