# fetch-kit

A lightweight TypeScript HTTP client built on native `fetch`, supporting all HTTP methods, customizable **exponential backoff** retries, and an **injectable logger**.

You do not need to create a `client` instance — import and call `request` and `configure` directly:

```ts
import { request } from '@guzelbaspinar/fetch-kit';

const { data } = await request({ url: 'https://api.example.com/users' });
```

- Zero required dependencies — only native `fetch` and `AbortController`
- Targets Node.js 18+, ships both CJS (`require`) and ESM (`import`) builds
- Full TypeScript support (including `.d.ts`) with generic response/body types
- Automatically parses JSON **and** plain text / other content types correctly
- Fully customizable retry strategy (sensible defaults included)
- Single-line `import`; no instance or factory setup

---

## Table of contents

- [Installation](#installation)
- [Quick start](#quick-start)
- [`configure()` — global defaults](#configure--global-defaults)
- [`request()` — all config options](#request--all-config-options)
- [HTTP methods](#http-methods)
- [Query parameters](#query-parameters)
- [Request body](#request-body)
- [Response body: JSON or plain text?](#response-body-json-or-plain-text)
- [Retry](#retry)
- [Timeout](#timeout)
- [Logger injection](#logger-injection)
- [Error handling (`FetchKitError`)](#error-handling-fetchkiterror)
- [TypeScript type safety](#typescript-type-safety)
- [Request cancellation (AbortSignal)](#request-cancellation-abortsignal)
- [Using in tests (`resetConfiguration`)](#using-in-tests-resetconfiguration)
- [Example: fetching a `.ini` / text endpoint](#example-fetching-a-ini--text-endpoint)
- [More examples](#more-examples)
- [API reference](#api-reference)

---

## Installation

```bash
npm install @guzelbaspinar/fetch-kit
```

## Quick start

No setup or instance creation. Import and call `request()`; every option, including `url`, lives in a single config object:

```ts
import { request } from '@guzelbaspinar/fetch-kit';

const { data, status } = await request<{ id: number; name: string }[]>({
  url: 'https://api.example.com/users',
  headers: { Authorization: 'Bearer TOKEN' },
  params: { active: true },
  retry: { retries: 3 },
  timeoutMs: 8000
});

console.log(status, data);
```

If you share a base URL, headers, or retry policy across the app, set them once at startup with `configure()` instead of repeating them on every request (see below).

---

## `configure()` — global defaults

Call once at your app entry point (e.g. `bootstrap.ts` / `main.ts`). Subsequent `request()` calls use these defaults; fields you pass per request override them.

```ts
import { configure } from '@guzelbaspinar/fetch-kit';

configure({
  baseUrl: 'https://api.example.com',
  headers: { Authorization: 'Bearer TOKEN' },
  timeoutMs: 8000,
  retry: { retries: 3, baseDelayMs: 1000 },
  logger: myLogger
});
```

Every field passed to `configure()` is optional and only updates what you specify — other previously set fields are left unchanged (`headers` and `retry` are **merged** with existing values; other fields are replaced).

| Option | Type | Description |
|---|---|---|
| `baseUrl` | `string` | Prepended to all request paths. Trailing `/` is stripped. If `request()` uses a full `http(s)://` URL, it is still combined with `baseUrl` unless you omit `baseUrl` when you want absolute URLs only. |
| `headers` | `Record<string,string>` | Default headers on every request. Override per request with `request({ headers })`. |
| `logger` | `Logger` | Your logger (see [Logger injection](#logger-injection)). If omitted, nothing is logged. |
| `timeoutMs` | `number` | Default per-request timeout. Override per request. |
| `retry` | `RetryOptions` | Default retry settings (see [Retry](#retry)). |
| `fetchImpl` | `typeof fetch` | Defaults to global `fetch`; useful for mocks in tests. |

> `configure()` is optional. If you never call it, `request()` uses factory defaults (retry: 3 attempts + exponential backoff, no timeout, no logger) and you only need a full `url`.

---

## `request()` — all config options

`request(config)` takes a single argument; `url` is required, everything else is optional:

```ts
interface RequestConfig<TBody = unknown> {
  url: string;                          // REQUIRED. Path if baseUrl is set, otherwise full URL.
  method?: HttpMethod;                  // 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE' | 'HEAD' | 'OPTIONS'. Default: 'GET'
  params?: QueryParams;                 // serialized as query string (see Query parameters)
  headers?: Record<string, string>;     // merged with configure() headers; per-request keys win
  body?: TBody;                         // JSON.stringify'd + Content-Type: application/json when appropriate
  rawBody?: BodyInit;                   // raw body; no transformation (see Request body)
  timeoutMs?: number;                   // per-request timeout; overrides configure()
  retry?: RetryOptions;                 // per-request retry; merged with configure()
  signal?: AbortSignal;                 // your AbortSignal (see Request cancellation)
}
```

Example with every field:

```ts
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
  signal: myAbortController.signal
});
```

---

## HTTP methods

All methods go through the same `request()` function via the `method` field — there are no separate `get`/`post`/`put` helpers:

```ts
await request({ url: '/users' });                                    // GET (default when method omitted)
await request({ url: '/users', method: 'POST', body: { name: 'Ada' } });
await request({ url: '/users/1', method: 'PUT', body: { name: 'Ada Lovelace' } });
await request({ url: '/users/1', method: 'PATCH', body: { active: false } });
await request({ url: '/users/1', method: 'DELETE' });
await request({ url: '/users/1', method: 'HEAD' });
await request({ url: '/users', method: 'OPTIONS' });
```

---

## Query parameters

The `params` object is URL-encoded into a query string. Arrays become repeated keys; `undefined`/`null` values are skipped:

```ts
await request({
  url: '/search',
  params: {
    q: 'laptop',
    inStock: true,
    tags: ['electronics', 'sale'],   // -> tags=electronics&tags=sale
    brand: undefined                 // -> omitted
  }
});
// GET /search?q=laptop&inStock=true&tags=electronics&tags=sale
```

---

## Request body

Objects passed to `body` are `JSON.stringify`'d and `Content-Type: application/json` is set unless you provide your own `Content-Type`:

```ts
await request({ url: '/users', method: 'POST', body: { name: 'Ada', email: 'ada@example.com' } });
```

For non-JSON payloads (form-data, plain text, binary, etc.) use `rawBody` — no automatic serialization; set `Content-Type` yourself when needed:

```ts
const formData = new FormData();
formData.append('file', myBlob, 'file.txt');

await request({
  url: '/upload',
  method: 'POST',
  rawBody: formData
  // FormData sets Content-Type (with boundary) automatically; do not set it manually.
});

await request({
  url: '/webhook',
  method: 'POST',
  rawBody: 'plain text payload',
  headers: { 'Content-Type': 'text/plain' }
});
```

> `body` is ignored on `GET` and `HEAD` requests (per the HTTP spec).

---

## Response body: JSON or plain text?

The library inspects `Content-Type` and parses accordingly — you do not call `response.json()` or `response.text()` yourself:

- Contains `application/json` → `response.json()`
- Otherwise (`text/plain`, `text/csv`, `application/octet-stream`, missing header, `.ini`/`.txt`, etc.) → `response.text()`
- `204 No Content` → `data` is `undefined`; no parse is attempted

```ts
// JSON API
const { data: user } = await request<{ id: number; name: string }>({ url: '/users/1' });
console.log(user.name); // typed access

// Plain text / .ini file
const { data: iniText } = await request<string>({ url: 'https://example.com/config.ini' });
console.log(iniText); // raw string
```

---

## Retry

Default behavior: **exponential backoff + full jitter**, retrying on these status codes:

```
408, 429, 500, 502, 503, 504
```

and on network errors (connection loss, DNS failure, etc.) — except `AbortError` (user-initiated cancellation).

### Default options

| Option | Default | Description |
|---|---|---|
| `retries` | `3` | Retries after the first attempt (up to 4 requests total). |
| `baseDelayMs` | `1000` | Delay before the first retry. |
| `maxDelayMs` | `30000` | Upper bound on delay. |
| `factor` | `2` | Multiplier for exponential backoff. |
| `jitter` | `true` | When `true`, delay is random between `0` and the computed cap (full jitter) — reduces thundering herd on retries. |
| `retryOnStatusCodes` | `[408, 429, 500, 502, 503, 504]` | Status codes that trigger a retry. |

Set globals with `configure()`, override per request via `retry`:

```ts
configure({ retry: { retries: 5, baseDelayMs: 500 } }); // all requests

await request({
  url: '/flaky-endpoint',
  retry: { retries: 1 } // only this request: 1 retry
});
```

### Custom retry logic: `shouldRetry`

When `retryOnStatusCodes` is not enough (e.g. you need the response body), use `shouldRetry`. Return `true` to retry:

```ts
await request({
  url: '/orders',
  retry: {
    retries: 4,
    shouldRetry: ({ response, error, attempt }) => {
      if (error) return true;                       // always retry network errors
      if (response?.status === 429) return true;
      if (response?.status === 400) return false;    // never retry 400
      return false;
    }
  }
});
```

### Custom delay: `computeDelay`

For example, honoring the `Retry-After` header:

```ts
await request({
  url: '/rate-limited',
  retry: {
    retries: 5,
    computeDelay: (ctx, defaultDelayMs) => {
      const retryAfter = ctx.response?.headers.get('retry-after');
      return retryAfter ? Number(retryAfter) * 1000 : defaultDelayMs;
    }
  }
});
```

### Observe each retry: `onRetry`

For logging, metrics, or UI (“retrying…”):

```ts
await request({
  url: '/flaky',
  retry: {
    onRetry: ({ attempt, maxRetries, delayMs, response, error }) => {
      console.log(`Attempt ${attempt}/${maxRetries} failed; retrying in ${delayMs}ms`);
    }
  }
});
```

### When all attempts are exhausted

The last failure throws `FetchKitError` (see [Error handling](#error-handling-fetchkiterror)).

---

## Timeout

Set a per-request timeout or a global default via `configure()`. When time runs out, the request is aborted via `AbortController` and `FetchKitError` is thrown:

```ts
configure({ timeoutMs: 5000 }); // default for all requests

await request({ url: '/slow-endpoint', timeoutMs: 15_000 }); // override for this request
```

> Timeout works with retry: a timed-out request is treated as a network error and may be retried if retry rules allow it.

---

## Logger injection

The library does not depend on any logging framework. Pass any object that satisfies this minimal interface (`winston`, `pino`, `console`, your own wrapper):

```ts
interface Logger {
  error(message: string, ...meta: unknown[]): void;
  warn?(message: string, ...meta: unknown[]): void;
  info?(message: string, ...meta: unknown[]): void;
  debug?(message: string, ...meta: unknown[]): void;
}
```

```ts
import { configure } from '@guzelbaspinar/fetch-kit';
import myLogger from './logger'; // e.g. your winston/pino instance

configure({ logger: myLogger });
```

The library logs:
- `warn` before each retry attempt
- `error` when all attempts are exhausted, before throwing

If `logger` is not set, nothing is written (silent mode).

---

## Error handling (`FetchKitError`)

Any request that fails after retries throws `FetchKitError`:

```ts
import { request, FetchKitError } from '@guzelbaspinar/fetch-kit';

try {
  await request({ url: '/users/999' });
} catch (err) {
  if (err instanceof FetchKitError) {
    console.error(err.message);   // "HTTP 404 for GET https://.../users/999"
    console.error(err.status);    // 404 for HTTP errors; undefined for network errors
    console.error(err.url);       // full request URL
    console.error(err.method);    // "GET"
    console.error(err.response);  // original Response (if any)
    console.error(err.cause);     // underlying error / response body text
  }
}
```

| Field | Description |
|---|---|
| `message` | Human-readable error message |
| `url` | Full request URL |
| `method` | HTTP method |
| `status` | HTTP status when a response was received; `undefined` on network errors |
| `response` | Raw `Response` object (if any) |
| `cause` | Original error, or response body text for HTTP errors |

---

## TypeScript type safety

`request` is generic; specify response and body types:

```ts
interface User {
  id: number;
  name: string;
  email: string;
}

interface CreateUserBody {
  name: string;
  email: string;
}

// Response type
const { data } = await request<User>({ url: '/users/1' });
data.name; // string, type-safe

// Response + body type
const { data: created } = await request<User, CreateUserBody>({
  url: '/users',
  method: 'POST',
  body: { name: 'Ada', email: 'ada@example.com' }
});
```

---

## Request cancellation (AbortSignal)

Pass your own `AbortSignal` (e.g. React `useEffect` cleanup, user cancel action):

```ts
const controller = new AbortController();

request({ url: '/long-running', signal: controller.signal })
  .catch(err => {
    // FetchKitError from timeoutMs or manual abort()
  });

// elsewhere:
controller.abort();
```

---

## Using in tests (`resetConfiguration`)

`configure()` is global (module-level singleton), so one test’s `configure()` can leak into others. Call `resetConfiguration()` before each test:

```ts
import { beforeEach } from 'node:test'; // or jest/vitest
import { resetConfiguration } from '@guzelbaspinar/fetch-kit';

beforeEach(() => {
  resetConfiguration();
});
```

This resets everything set via `configure()` (baseUrl, headers, logger, retry, timeoutMs, fetchImpl) to factory defaults.

---

## Example: fetching a `.ini` / text endpoint

No extra setup for plain-text endpoints — the library picks `.text()` from `Content-Type`. You can pass a full URL in `url` without `baseUrl`:

```ts
import { request } from '@guzelbaspinar/fetch-kit';

const { data } = await request<string>({
  url: 'https://example.com/config.ini',
  retry: { retries: 3, baseDelayMs: 1000 }
});

console.log(data); // raw .ini content as string
```

---

## More examples

[`examples/usage.ts`](examples/usage.ts) is a numbered copy-paste catalog (50 snippets). Functions are not invoked when you run the file; use the index at the top of that file or the table below.

| # | Topic | README section |
|---|--------|----------------|
| 1 | Quick start (full URL, headers, params, retry, timeout) | [Quick start](#quick-start) |
| 2 | Absolute URL without `configure()` | [configure()](#configure--global-defaults) |
| 3 | `FetchKitResponse` (`data`, `status`, `headers`, `response`) | [request()](#request--all-config-options) |
| 4–9 | `configure()` (all options, header/retry merge, `baseUrl`, header override, `fetchImpl`) | [configure()](#configure--global-defaults) |
| 10–12 | HTTP methods, query params, full `RequestConfig` | [HTTP methods](#http-methods), [Query parameters](#query-parameters), [request()](#request--all-config-options) |
| 13–16 | JSON body, `rawBody`, custom `Content-Type`, GET/HEAD ignore `body` | [Request body](#request-body) |
| 17–19 | JSON response, text/`.ini`, `204` | [Response body](#response-body-json-or-plain-text) |
| 20–29 | `RetryOptions` — one field each (+ defaults, `onRetry`) | [Retry](#retry), [RetryOptions](#retryoptions) |
| 30–38 | `RetryOptions` — combinations 1–9 (README API reference) | [RetryOptions](#retryoptions) |
| 39 | Global `configure({ retry })` + per-request override | [Retry](#retry) |
| 40–41 | Timeout; timeout + retry | [Timeout](#timeout) |
| 42 | Logger injection | [Logger injection](#logger-injection) |
| 43–44 | `FetchKitError` (HTTP vs network) | [Error handling](#error-handling-fetchkiterror) |
| 45 | TypeScript generics | [TypeScript type safety](#typescript-type-safety) |
| 46–47 | `AbortSignal`; `resetConfiguration()` in tests | [Request cancellation](#request-cancellation-abortsignal), [Using in tests](#using-in-tests-resetconfiguration) |
| 48–50 | `buildQueryString`, `buildUrl`, `computeExponentialDelay` | [API reference](#api-reference) |

---

## API reference

### `configure(options: FetchKitOptions): void`

Sets global defaults. See [`configure()` — global defaults](#configure--global-defaults).

### `request<TResponse, TBody>(config: RequestConfig<TBody>): Promise<FetchKitResponse<TResponse>>`

Issues a single request. See [`request()` — all config options](#request--all-config-options).

### `resetConfiguration(): void`

Resets global configuration to factory defaults. See [Using in tests](#using-in-tests-resetconfiguration).

### `FetchKitResponse<T>`

```ts
interface FetchKitResponse<T> {
  data: T;
  status: number;
  headers: Headers;
  response: Response; // original fetch Response
}
```

### `RetryOptions`

Pass on `configure({ retry })` or per request as `request({ retry })`. Per-request fields are **merged** with global `configure()` retry settings (same as `configure()` retry merge).

```ts
interface RetryOptions {
  retries?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  factor?: number;
  jitter?: boolean;
  retryOnStatusCodes?: number[];
  shouldRetry?: (ctx: RetryDecisionContext) => boolean;
  computeDelay?: (ctx: RetryDecisionContext, defaultDelayMs: number) => number;
  onRetry?: (info: RetryInfo) => void;
}

interface RetryDecisionContext {
  attempt: number;       // 1-based attempt index for the current request
  maxRetries: number;    // same as retries (not including the first attempt)
  method: HttpMethod;
  url: string;
  response?: Response;   // set when an HTTP response was received
  error?: unknown;       // set on network/timeout failures (not FetchKitError)
}

interface RetryInfo extends RetryDecisionContext {
  delayMs: number;       // wait time before the next attempt
}
```

**How options interact**

| Situation | What decides a retry |
|---|---|
| HTTP error (`!response.ok`) | If `shouldRetry` is set → its return value only. Otherwise → `response.status` is in `retryOnStatusCodes`. |
| Network / timeout error | If `shouldRetry` is set → its return value only. Otherwise → any error except `AbortError` (see `isNetworkError`). |
| Delay before next attempt | `computeDelay(ctx, defaultDelayMs)` if set; else exponential backoff from `baseDelayMs`, `factor`, `maxDelayMs`, and `jitter`. |
| After delay is chosen | `onRetry(info)` runs, then the library sleeps `delayMs`. |

Defaults and narrative: [Retry](#retry). Runnable numbered snippets for examples **20–38** live in [`examples/usage.ts`](examples/usage.ts). Below: one example per field, then common multi-field combinations.

#### Single options (defaults for everything else)

```ts
// retries — extra attempts after the first (default 3 → up to 4 HTTP calls)
await request({ url: '/x', retry: { retries: 0 } }); // no retries

// baseDelayMs — starting point for backoff before retry #1 (default 1000)
await request({ url: '/x', retry: { baseDelayMs: 250 } });

// maxDelayMs — cap on computed delay (default 30000)
await request({ url: '/x', retry: { maxDelayMs: 5_000 } });

// factor — multiply delay by this each attempt (default 2)
await request({ url: '/x', retry: { factor: 1.5 } });

// jitter — full jitter between 0 and cap when true (default true)
await request({ url: '/x', retry: { jitter: false } }); // predictable delays (e.g. tests)

// retryOnStatusCodes — only these HTTP statuses retry when shouldRetry is omitted
await request({
  url: '/x',
  retry: { retryOnStatusCodes: [429, 503] }
});

// shouldRetry — replaces default status / network rules when provided
await request({
  url: '/x',
  retry: {
    retries: 2,
    shouldRetry: ({ response, error }) => {
      if (error) return true;
      return response?.status === 503;
    }
  }
});

// computeDelay — return ms to wait; not auto-capped by maxDelayMs
await request({
  url: '/x',
  retry: {
    computeDelay: (_ctx, defaultDelayMs) => defaultDelayMs // or any number
  }
});

// onRetry — hook after delay is computed, before sleep
await request({
  url: '/x',
  retry: {
    onRetry: ({ attempt, maxRetries, delayMs, method, url }) => {
      console.log(`${method} ${url}: retry ${attempt}/${maxRetries} in ${delayMs}ms`);
    }
  }
});
```

#### Common combinations

```ts
// 1) Disable retry entirely
await request({ url: '/idempotent-read', retry: { retries: 0 } });

// 2) More attempts, faster start, lower cap (rate-limited APIs)
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

// 3) Deterministic backoff (no jitter) — useful in tests or fixed schedules
await request({
  url: '/x',
  retry: {
    retries: 3,
    baseDelayMs: 100,
    factor: 2,
    jitter: false
    // attempt 1 fail → wait ~100ms, attempt 2 → ~200ms, attempt 3 → ~400ms (capped by maxDelayMs)
  }
});

// 4) Only retry 429, ignore default 5xx list
await request({
  url: '/quota',
  retry: {
    retries: 4,
    retryOnStatusCodes: [429]
  }
});

// 5) Custom status rules + observe retries (metrics / UI)
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

// 6) Honor Retry-After when present, else library backoff
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

// 7) Fixed custom delay every time (ignores factor/jitter for the returned value)
await request({
  url: '/x',
  retry: {
    retries: 3,
    computeDelay: () => 2_000
  }
});

// 8) Global defaults + per-request override (merge)
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
    retries: 2,              // overrides global retries only
    shouldRetry: ({ error }) => !!error // replaces global retryOnStatusCodes for this request
  }
});

// 9) “Kitchen sink” — all knobs explicit (copy-paste template)
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
    computeDelay: (ctx, defaultDelayMs) => Math.min(defaultDelayMs, 15_000),
    onRetry: (info) => {
      console.log(info.attempt, info.delayMs, info.response?.status ?? info.error);
    }
  }
});
```

> **Note:** When `shouldRetry` is defined, you must encode any status-code or network behavior you still want inside that function — it does not run in parallel with `retryOnStatusCodes`; it replaces the default predicate for that failure type.

### `FetchKitError`

```ts
class FetchKitError extends Error {
  readonly url: string;
  readonly method: HttpMethod;
  readonly status?: number;
  readonly response?: Response;
  readonly cause?: unknown;
}
```

---

## License

MIT
