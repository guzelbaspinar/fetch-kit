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
  return {
    ...DEFAULT_RETRY,
    ...defaults,
    ...perRequest
  };
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
  fetchImpl: typeof fetch = fetch;

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

    const headers: Record<string, string> = {
      ...this.defaultHeaders,
      ...config.headers
    };

    let body: BodyInit | undefined;
    if (config.rawBody !== undefined) {
      body = config.rawBody;
    } else if (config.body !== undefined && method !== 'GET' && method !== 'HEAD') {
      body = JSON.stringify(config.body);
      if (!headers['Content-Type']) headers['Content-Type'] = 'application/json';
    }

    const maxAttempts = retryConfig.retries + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      const controller = new AbortController();
      const timers: ReturnType<typeof setTimeout>[] = [];

      if (timeoutMs) {
        timers.push(setTimeout(() => controller.abort(new Error(`Timeout after ${timeoutMs}ms`)), timeoutMs));
      }
      if (config.signal) {
        if (config.signal.aborted) controller.abort(config.signal.reason);
        else config.signal.addEventListener('abort', () => controller.abort(config.signal!.reason), { once: true });
      }

      try {
        const response = await this.fetchImpl(url, {
          method,
          headers,
          body,
          signal: controller.signal
        });

        timers.forEach(clearTimeout);

        const isRetryableStatus = retryConfig.retryOnStatusCodes.includes(response.status);
        const decisionCtx: RetryDecisionContext = { attempt, maxRetries: retryConfig.retries, method, url, response };
        const shouldRetryStatus =
          !response.ok && (retryConfig.shouldRetry?.(decisionCtx) ?? isRetryableStatus);

        if (!response.ok && shouldRetryStatus && attempt < maxAttempts) {
          await this.waitBeforeRetry(attempt, retryConfig, decisionCtx);
          continue;
        }

        if (!response.ok) {
          const text = await response.text().catch(() => '');
          throw new FetchKitError(`HTTP ${response.status} for ${method} ${url}`, {
            url,
            method,
            status: response.status,
            response,
            cause: text
          });
        }

        const data = await this.parseBody<TResponse>(response);
        return { data, status: response.status, headers: response.headers, response };
      } catch (error) {
        timers.forEach(clearTimeout);
        lastError = error;

        const isLastAttempt = attempt >= maxAttempts;
        const decisionCtx: RetryDecisionContext = { attempt, maxRetries: retryConfig.retries, method, url, error };
        const shouldRetryError =
          error instanceof FetchKitError
            ? false // HTTP errors are handled above; do not retry FetchKitError
            : (retryConfig.shouldRetry?.(decisionCtx) ?? isNetworkError(error));

        if (error instanceof FetchKitError) throw error;

        if (isLastAttempt || !shouldRetryError) {
          this.logger.error?.(`fetch-kit: ${method} ${url} failed after ${attempt} attempt(s), giving up.`, error);
          throw new FetchKitError(`Request failed for ${method} ${url}`, { url, method, cause: error });
        }

        await this.waitBeforeRetry(attempt, retryConfig, decisionCtx);
      }
    }

    // Unreachable in normal flow.
    throw new FetchKitError(`Request failed for ${method} ${url}`, { url, method, cause: lastError });
  }

  private async waitBeforeRetry(
    attempt: number,
    retryConfig: RetryOptions & Required<Pick<RetryOptions, 'baseDelayMs' | 'maxDelayMs' | 'factor' | 'jitter'>>,
    ctx: RetryDecisionContext
  ): Promise<void> {
    const defaultDelay = computeExponentialDelay(attempt, retryConfig);
    const delayMs = retryConfig.computeDelay ? retryConfig.computeDelay(ctx, defaultDelay) : defaultDelay;

    retryConfig.onRetry?.({ ...ctx, delayMs });
    this.logger.warn?.(
      `fetch-kit: ${ctx.method} ${ctx.url} failed on attempt ${attempt}, retrying in ${delayMs}ms.`,
      ctx.error ?? ctx.response?.status
    );

    await sleep(delayMs);
  }

  private async parseBody<T>(response: Response): Promise<T> {
    if (response.status === 204) return undefined as T;
    const contentType = response.headers.get('content-type') ?? '';
    if (contentType.includes('application/json')) {
      return (await response.json()) as T;
    }
    return (await response.text()) as unknown as T;
  }
}

const engine = new FetchKitEngine();

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
  engine.fetchImpl = fetch;
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
