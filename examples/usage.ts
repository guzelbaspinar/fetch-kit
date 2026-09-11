/**
 * fetch-kit usage examples.
 *
 * Copy-paste reference only — functions are not invoked when you run this file.
 *   npx tsx examples/usage.ts
 *
 * Index (# | function | README)
 * ----|----------|--------
 *  1 | example01_quickStart              | Quick start
 *  2 | example02_fullUrlNoConfigure      | configure — global defaults
 *  3 | example03_fetchKitResponseFields  | request() — all config options
 *  4 | example04_configureAllOptions     | configure — global defaults
 *  5 | example05_configureMergeHeaders   | configure — global defaults
 *  6 | example06_configureMergeRetry     | configure — global defaults / Retry
 *  7 | example07_baseUrlAndPath          | configure — global defaults
 *  8 | example08_perRequestHeaders       | request() — all config options
 *  9 | example09_fetchImplMock           | configure — global defaults / Using in tests
 * 10 | example10_allHttpMethods          | HTTP methods
 * 11 | example11_queryParams             | Query parameters
 * 12 | example12_requestAllFields        | request() — all config options
 * 13 | example13_jsonRequestBody         | Request body
 * 14 | example14_rawBody                 | Request body
 * 15 | example15_jsonBodyCustomContentType | Request body
 * 16 | example16_getHeadIgnoreBody       | Request body
 * 17 | example17_jsonResponse            | Response body: JSON or plain text?
 * 18 | example18_textResponse            | Response body / .ini example
 * 19 | example19_noContent204            | Response body: JSON or plain text?
 * 20 | example20_retryDefaults           | Retry
 * 21 | example21_retryRetriesZero        | RetryOptions — retries
 * 22 | example22_retryBaseDelayMs        | RetryOptions — baseDelayMs
 * 23 | example23_retryMaxDelayMs         | RetryOptions — maxDelayMs
 * 24 | example24_retryFactor             | RetryOptions — factor
 * 25 | example25_retryJitterOff          | RetryOptions — jitter
 * 26 | example26_retryOnStatusCodes      | RetryOptions — retryOnStatusCodes
 * 27 | example27_shouldRetry             | RetryOptions — shouldRetry
 * 28 | example28_computeDelayPassthrough | RetryOptions — computeDelay
 * 29 | example29_onRetry                 | RetryOptions — onRetry
 * 30 | example30_retryComboDisable       | RetryOptions — combination 1
 * 31 | example31_retryComboAggressive    | RetryOptions — combination 2
 * 32 | example32_retryComboDeterministic | RetryOptions — combination 3
 * 33 | example33_retryComboOnly429       | RetryOptions — combination 4
 * 34 | example34_retryComboShouldRetryMetrics | RetryOptions — combination 5
 * 35 | example35_retryComboRetryAfter    | RetryOptions — combination 6
 * 36 | example36_retryComboFixedDelay    | RetryOptions — combination 7
 * 37 | example37_retryComboGlobalMerge   | RetryOptions — combination 8
 * 38 | example38_retryComboKitchenSink   | RetryOptions — combination 9
 * 39 | example39_configureThenOverrideRetry | Retry / configure merge
 * 40 | example40_timeout                 | Timeout
 * 41 | example41_timeoutWithRetry        | Timeout / Retry
 * 42 | example42_logger                  | Logger injection
 * 43 | example43_errorHttp               | Error handling (FetchKitError)
 * 44 | example44_errorNetwork            | Error handling (FetchKitError)
 * 45 | example45_typescriptGenerics      | TypeScript type safety
 * 46 | example46_abortSignal             | Request cancellation (AbortSignal)
 * 47 | example47_resetConfiguration      | Using in tests (resetConfiguration)
 * 48 | example48_buildQueryString        | API — buildQueryString
 * 49 | example49_buildUrl                | API — buildUrl
 * 50 | example50_computeExponentialDelay | API — computeExponentialDelay
 */

import {
  buildQueryString,
  buildUrl,
  computeExponentialDelay,
  configure,
  request,
  resetConfiguration,
  FetchKitError,
  type Logger
} from '../src/index.js';

// ---------------------------------------------------------------------------
// 1) Quick start — full URL, no configure()
// ---------------------------------------------------------------------------
async function example01_quickStart() {
  const { data, status } = await request<{ id: number; name: string }[]>({
    url: 'https://api.example.com/users',
    headers: { Authorization: 'Bearer TOKEN' },
    params: { active: true },
    retry: { retries: 3 },
    timeoutMs: 8000
  });

  console.log(status, data);
}

// ---------------------------------------------------------------------------
// 2) Full URL without baseUrl (absolute endpoint)
// ---------------------------------------------------------------------------
async function example02_fullUrlNoConfigure() {
  const { data } = await request<string>({
    url: 'https://example.com/config.ini'
  });
  console.log(data);
}

// ---------------------------------------------------------------------------
// 3) FetchKitResponse — data, status, headers, raw Response
// ---------------------------------------------------------------------------
async function example03_fetchKitResponseFields() {
  const { data, status, headers, response } = await request<{ ok: boolean }>({
    url: 'https://api.example.com/health'
  });

  console.log(data.ok, status, headers.get('content-type'), response.ok);
}

// ---------------------------------------------------------------------------
// 4) configure() — all FetchKitOptions at once
// ---------------------------------------------------------------------------
async function example04_configureAllOptions() {
  const myLogger: Logger = {
    error: (msg, ...meta) => console.error(msg, ...meta),
    warn: (msg, ...meta) => console.warn(msg, ...meta)
  };

  configure({
    baseUrl: 'https://api.example.com',
    headers: { Authorization: 'Bearer TOKEN' },
    timeoutMs: 8000,
    retry: { retries: 3, baseDelayMs: 1000 },
    logger: myLogger,
    fetchImpl: fetch
  });

  await request({ url: '/users/1' });
}

// ---------------------------------------------------------------------------
// 5) configure() — headers merge across multiple configure() calls
// ---------------------------------------------------------------------------
async function example05_configureMergeHeaders() {
  configure({ headers: { Authorization: 'Bearer A' } });
  configure({ headers: { 'X-Trace-Id': 'trace-1' } });
  // Effective defaults: both Authorization and X-Trace-Id

  await request({ url: 'https://api.example.com/me' });
}

// ---------------------------------------------------------------------------
// 6) configure() — retry merge across multiple configure() calls
// ---------------------------------------------------------------------------
async function example06_configureMergeRetry() {
  configure({ retry: { retries: 5, baseDelayMs: 1000 } });
  configure({ retry: { maxDelayMs: 10_000 } });
  // Effective: retries 5, baseDelayMs 1000, maxDelayMs 10000 (+ other defaults)

  await request({ url: '/flaky' });
}

// ---------------------------------------------------------------------------
// 7) baseUrl + path-only url
// ---------------------------------------------------------------------------
async function example07_baseUrlAndPath() {
  configure({ baseUrl: 'https://api.example.com/' });

  await request({ url: '/users', params: { page: 1 } });
  // -> https://api.example.com/users?page=1
}

// ---------------------------------------------------------------------------
// 8) Per-request headers override configure() defaults
// ---------------------------------------------------------------------------
async function example08_perRequestHeaders() {
  configure({ headers: { 'X-Env': 'production' } });

  await request({
    url: 'https://api.example.com/deploy',
    headers: { 'X-Env': 'staging' }
  });
}

// ---------------------------------------------------------------------------
// 9) fetchImpl — inject mock fetch (tests)
// ---------------------------------------------------------------------------
async function example09_fetchImplMock() {
  const fetchImpl = async () =>
    new Response(JSON.stringify({ mocked: true }), {
      status: 200,
      headers: { 'content-type': 'application/json' }
    });

  configure({ fetchImpl });

  const { data } = await request<{ mocked: boolean }>({ url: '/any' });
  console.log(data.mocked);
}

// ---------------------------------------------------------------------------
// 10) All HTTP methods
// ---------------------------------------------------------------------------
async function example10_allHttpMethods() {
  await request({ url: '/users', method: 'GET' });
  await request({ url: '/users', method: 'POST', body: { name: 'Ada' } });
  await request({ url: '/users/1', method: 'PUT', body: { name: 'Ada Lovelace' } });
  await request({ url: '/users/1', method: 'PATCH', body: { active: false } });
  await request({ url: '/users/1', method: 'DELETE' });
  await request({ url: '/users/1', method: 'HEAD' });
  await request({ url: '/users', method: 'OPTIONS' });
  await request({ url: '/users' }); // default GET
}

// ---------------------------------------------------------------------------
// 11) Query parameters
// ---------------------------------------------------------------------------
async function example11_queryParams() {
  await request({
    url: '/search',
    params: {
      q: 'laptop',
      inStock: true,
      tags: ['electronics', 'sale'],
      brand: undefined,
      legacy: null
    }
  });
}

// ---------------------------------------------------------------------------
// 12) request() with every RequestConfig field
// ---------------------------------------------------------------------------
async function example12_requestAllFields() {
  const controller = new AbortController();

  await request({
    url: '/orders',
    method: 'POST',
    headers: { 'X-Trace-Id': crypto.randomUUID() },
    params: { source: 'web' },
    body: { productId: 42, quantity: 2 },
    timeoutMs: 5000,
    retry: {
      retries: 4,
      baseDelayMs: 500,
      retryOnStatusCodes: [429, 503],
      onRetry: (info) => console.log(`retry #${info.attempt}`)
    },
    signal: controller.signal
  });
}

// ---------------------------------------------------------------------------
// 13) JSON request body (auto Content-Type)
// ---------------------------------------------------------------------------
async function example13_jsonRequestBody() {
  await request({
    url: '/users',
    method: 'POST',
    body: { name: 'Ada', email: 'ada@example.com' }
  });
}

// ---------------------------------------------------------------------------
// 14) rawBody — FormData and plain text
// ---------------------------------------------------------------------------
async function example14_rawBody() {
  const formData = new FormData();
  formData.append('file', new Blob(['file contents']), 'file.txt');

  await request({
    url: '/upload',
    method: 'POST',
    rawBody: formData
  });

  await request({
    url: '/webhook',
    method: 'POST',
    rawBody: 'plain text payload',
    headers: { 'Content-Type': 'text/plain' }
  });
}

// ---------------------------------------------------------------------------
// 15) JSON body with custom Content-Type (not overwritten)
// ---------------------------------------------------------------------------
async function example15_jsonBodyCustomContentType() {
  await request({
    url: '/users',
    method: 'POST',
    body: { name: 'Ada' },
    headers: { 'Content-Type': 'application/vnd.api+json' }
  });
}

// ---------------------------------------------------------------------------
// 16) body on GET / HEAD is not sent
// ---------------------------------------------------------------------------
async function example16_getHeadIgnoreBody() {
  await request({ url: '/users', method: 'GET', body: { ignored: true } });
  await request({ url: '/users/1', method: 'HEAD', body: { ignored: true } });
}

// ---------------------------------------------------------------------------
// 17) JSON response parsing
// ---------------------------------------------------------------------------
async function example17_jsonResponse() {
  const { data } = await request<{ id: number; name: string }>({ url: '/users/1' });
  console.log(data.name);
}

// ---------------------------------------------------------------------------
// 18) Plain text / .ini response
// ---------------------------------------------------------------------------
async function example18_textResponse() {
  const { data } = await request<string>({
    url: 'https://example.com/config.ini'
  });
  console.log(data);
}

// ---------------------------------------------------------------------------
// 19) 204 No Content — data is undefined
// ---------------------------------------------------------------------------
async function example19_noContent204() {
  const { data, status } = await request({
    url: '/users/1',
    method: 'DELETE'
  });
  console.log(status, data === undefined);
}

// ---------------------------------------------------------------------------
// 20) Retry — library defaults + per-request override
// ---------------------------------------------------------------------------
async function example20_retryDefaults() {
  await request({ url: '/flaky-endpoint' });

  await request({
    url: '/flaky-endpoint',
    retry: { retries: 5, baseDelayMs: 500, maxDelayMs: 10_000 }
  });
}

// ---------------------------------------------------------------------------
// 21) Retry — retries: 0 (disable)
// ---------------------------------------------------------------------------
async function example21_retryRetriesZero() {
  await request({ url: '/idempotent-read', retry: { retries: 0 } });
}

// ---------------------------------------------------------------------------
// 22) Retry — baseDelayMs only
// ---------------------------------------------------------------------------
async function example22_retryBaseDelayMs() {
  await request({ url: '/x', retry: { baseDelayMs: 250 } });
}

// ---------------------------------------------------------------------------
// 23) Retry — maxDelayMs only
// ---------------------------------------------------------------------------
async function example23_retryMaxDelayMs() {
  await request({ url: '/x', retry: { maxDelayMs: 5_000 } });
}

// ---------------------------------------------------------------------------
// 24) Retry — factor only
// ---------------------------------------------------------------------------
async function example24_retryFactor() {
  await request({ url: '/x', retry: { factor: 1.5 } });
}

// ---------------------------------------------------------------------------
// 25) Retry — jitter: false (predictable delays)
// ---------------------------------------------------------------------------
async function example25_retryJitterOff() {
  await request({ url: '/x', retry: { jitter: false } });
}

// ---------------------------------------------------------------------------
// 26) Retry — custom retryOnStatusCodes
// ---------------------------------------------------------------------------
async function example26_retryOnStatusCodes() {
  await request({
    url: '/rate-limited',
    retry: { retryOnStatusCodes: [429, 503] }
  });
}

// ---------------------------------------------------------------------------
// 27) Retry — shouldRetry replaces default rules when set
// ---------------------------------------------------------------------------
async function example27_shouldRetry() {
  await request({
    url: '/orders',
    retry: {
      retries: 4,
      shouldRetry: ({ response, error, attempt }) => {
        if (error) return true;
        if (response?.status === 429) return true;
        if (response?.status === 400) return false;
        return false;
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 28) Retry — computeDelay passthrough
// ---------------------------------------------------------------------------
async function example28_computeDelayPassthrough() {
  await request({
    url: '/x',
    retry: {
      computeDelay: (_ctx, defaultDelayMs) => defaultDelayMs
    }
  });
}

// ---------------------------------------------------------------------------
// 29) Retry — onRetry hook
// ---------------------------------------------------------------------------
async function example29_onRetry() {
  await request({
    url: '/flaky',
    retry: {
      onRetry: ({ attempt, maxRetries, delayMs, method, url, response, error }) => {
        console.log(`${method} ${url}: retry ${attempt}/${maxRetries} in ${delayMs}ms`, response?.status ?? error);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 30) Retry combination 1 — disable retry entirely
// ---------------------------------------------------------------------------
async function example30_retryComboDisable() {
  await request({ url: '/idempotent-read', retry: { retries: 0 } });
}

// ---------------------------------------------------------------------------
// 31) Retry combination 2 — more attempts, faster start, lower cap
// ---------------------------------------------------------------------------
async function example31_retryComboAggressive() {
  await request({
    url: '/api',
    retry: {
      retries: 5,
      baseDelayMs: 500,
      maxDelayMs: 10_000,
      factor: 2,
      jitter: true
    }
  });
}

// ---------------------------------------------------------------------------
// 32) Retry combination 3 — deterministic backoff (no jitter)
// ---------------------------------------------------------------------------
async function example32_retryComboDeterministic() {
  await request({
    url: '/x',
    retry: {
      retries: 3,
      baseDelayMs: 100,
      factor: 2,
      jitter: false
    }
  });
}

// ---------------------------------------------------------------------------
// 33) Retry combination 4 — only retry 429
// ---------------------------------------------------------------------------
async function example33_retryComboOnly429() {
  await request({
    url: '/quota',
    retry: {
      retries: 4,
      retryOnStatusCodes: [429]
    }
  });
}

// ---------------------------------------------------------------------------
// 34) Retry combination 5 — shouldRetry + onRetry (metrics)
// ---------------------------------------------------------------------------
async function example34_retryComboShouldRetryMetrics() {
  const metrics = { increment: (_name: string, _tags?: Record<string, string>) => {} };

  await request({
    url: '/orders',
    retry: {
      retries: 4,
      shouldRetry: ({ response, error }) => {
        if (error) return true;
        if (response?.status === 404) return false;
        return response?.status === 429 || response?.status === 503;
      },
      onRetry: (info) => metrics.increment('fetch_kit.retry', { url: info.url })
    }
  });
}

// ---------------------------------------------------------------------------
// 35) Retry combination 6 — Retry-After header + onRetry log
// ---------------------------------------------------------------------------
async function example35_retryComboRetryAfter() {
  await request({
    url: '/rate-limited',
    retry: {
      retries: 5,
      computeDelay: (ctx, defaultDelayMs) => {
        const header = ctx.response?.headers.get('retry-after');
        const seconds = header ? Number(header) : NaN;
        return Number.isFinite(seconds) ? seconds * 1000 : defaultDelayMs;
      },
      onRetry: ({ delayMs }) => console.log(`backing off ${delayMs}ms`)
    }
  });
}

// ---------------------------------------------------------------------------
// 36) Retry combination 7 — fixed custom delay every retry
// ---------------------------------------------------------------------------
async function example36_retryComboFixedDelay() {
  await request({
    url: '/x',
    retry: {
      retries: 3,
      computeDelay: () => 2_000
    }
  });
}

// ---------------------------------------------------------------------------
// 37) Retry combination 8 — global configure() + per-request merge
// ---------------------------------------------------------------------------
async function example37_retryComboGlobalMerge() {
  configure({
    retry: {
      retries: 5,
      baseDelayMs: 1000,
      retryOnStatusCodes: [503],
      onRetry: (info) => console.log('global', info.attempt)
    }
  });

  await request({
    url: '/critical',
    retry: {
      retries: 2,
      shouldRetry: ({ error }) => !!error
    }
  });
}

// ---------------------------------------------------------------------------
// 38) Retry combination 9 — kitchen sink (all RetryOptions explicit)
// ---------------------------------------------------------------------------
async function example38_retryComboKitchenSink() {
  await request({
    url: '/flaky',
    retry: {
      retries: 3,
      baseDelayMs: 1000,
      maxDelayMs: 30_000,
      factor: 2,
      jitter: true,
      retryOnStatusCodes: [408, 429, 500, 502, 503, 504],
      shouldRetry: ({ response, error, attempt }) => {
        if (error) return attempt < 3;
        return (response?.status ?? 0) >= 500;
      },
      computeDelay: (_ctx, defaultDelayMs) => Math.min(defaultDelayMs, 15_000),
      onRetry: (info) => {
        console.log(info.attempt, info.delayMs, info.response?.status ?? info.error);
      }
    }
  });
}

// ---------------------------------------------------------------------------
// 39) configure() retry defaults, then per-request partial override
// ---------------------------------------------------------------------------
async function example39_configureThenOverrideRetry() {
  configure({ retry: { retries: 5, baseDelayMs: 500 } });

  await request({
    url: '/flaky-endpoint',
    retry: { retries: 1 }
  });
}

// ---------------------------------------------------------------------------
// 40) Timeout — global and per-request
// ---------------------------------------------------------------------------
async function example40_timeout() {
  configure({ timeoutMs: 5000 });

  await request({ url: '/slow-endpoint', timeoutMs: 15_000 });
}

// ---------------------------------------------------------------------------
// 41) Timeout with retry (timeout may retry as network failure)
// ---------------------------------------------------------------------------
async function example41_timeoutWithRetry() {
  configure({
    timeoutMs: 100,
    retry: { retries: 2, baseDelayMs: 5 }
  });

  await request({ url: '/sometimes-slow' });
}

// ---------------------------------------------------------------------------
// 42) Logger injection
// ---------------------------------------------------------------------------
async function example42_logger() {
  const myLogger: Logger = {
    error: (msg, ...meta) => console.error('[fetch-kit]', msg, ...meta),
    warn: (msg, ...meta) => console.warn('[fetch-kit]', msg, ...meta),
    info: (msg, ...meta) => console.info('[fetch-kit]', msg, ...meta),
    debug: (msg, ...meta) => console.debug('[fetch-kit]', msg, ...meta)
  };

  configure({ logger: myLogger });

  await request({ url: '/flaky' });
}

// ---------------------------------------------------------------------------
// 43) FetchKitError — HTTP error response
// ---------------------------------------------------------------------------
async function example43_errorHttp() {
  try {
    await request({ url: '/users/999' });
  } catch (err) {
    if (err instanceof FetchKitError) {
      console.error(err.message);
      console.error(err.status);
      console.error(err.url);
      console.error(err.method);
      console.error(err.response);
      console.error(err.cause);
    }
  }
}

// ---------------------------------------------------------------------------
// 44) FetchKitError — network failure (no HTTP status)
// ---------------------------------------------------------------------------
async function example44_errorNetwork() {
  try {
    await request({ url: 'https://api.example.com/down', retry: { retries: 0 } });
  } catch (err) {
    if (err instanceof FetchKitError) {
      console.error(err.status === undefined);
      console.error(err.cause);
    }
  }
}

// ---------------------------------------------------------------------------
// 45) TypeScript — response and body generics
// ---------------------------------------------------------------------------
interface User {
  id: number;
  name: string;
  email: string;
}

interface CreateUserBody {
  name: string;
  email: string;
}

async function example45_typescriptGenerics() {
  const { data: user } = await request<User>({ url: '/users/1' });
  console.log(user.name);

  const { data: created } = await request<User, CreateUserBody>({
    url: '/users',
    method: 'POST',
    body: { name: 'Ada', email: 'ada@example.com' }
  });
  console.log(created.id);
}

// ---------------------------------------------------------------------------
// 46) AbortSignal — user cancellation
// ---------------------------------------------------------------------------
async function example46_abortSignal() {
  const controller = new AbortController();

  const pending = request({ url: '/long-running', signal: controller.signal }).catch((err) => {
    console.error('Request cancelled or failed:', err);
  });

  controller.abort();

  await pending;
}

// ---------------------------------------------------------------------------
// 47) resetConfiguration() — prevent configure() leaking between tests
// ---------------------------------------------------------------------------
async function example47_resetConfiguration() {
  // In node:test / jest / vitest:
  //
  // beforeEach(() => resetConfiguration());
  resetConfiguration();
}

// ---------------------------------------------------------------------------
// 48) buildQueryString — standalone URL helper
// ---------------------------------------------------------------------------
function example48_buildQueryString() {
  const qs = buildQueryString({
    q: 'test',
    tags: ['a', 'b'],
    skip: undefined
  });
  console.log(qs); // ?q=test&tags=a&tags=b
}

// ---------------------------------------------------------------------------
// 49) buildUrl — base + path + query
// ---------------------------------------------------------------------------
function example49_buildUrl() {
  const url = buildUrl('https://api.example.com/', '/search', { q: 'laptop' });
  console.log(url);
}

// ---------------------------------------------------------------------------
// 50) computeExponentialDelay — backoff math without HTTP
// ---------------------------------------------------------------------------
function example50_computeExponentialDelay() {
  const ms = computeExponentialDelay(2, {
    baseDelayMs: 1000,
    maxDelayMs: 30_000,
    factor: 2,
    jitter: false
  });
  console.log(ms);
}
