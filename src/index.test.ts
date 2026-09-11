import { describe, it, mock, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { configure, resetConfiguration, request, FetchKitError } from './index.js';

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' }
  });
}

// Reset global config before each test (singleton).
beforeEach(() => {
  resetConfiguration();
});

describe('request() - successful requests', () => {
  it('parses JSON response for GET', async () => {
    const fetchImpl = mock.fn(async () => jsonResponse({ hello: 'world' }));
    configure({ fetchImpl });

    const res = await request({ url: 'https://api.example.com/ping' });

    assert.deepEqual(res.data, { hello: 'world' });
    assert.equal(res.status, 200);
    assert.equal(fetchImpl.mock.calls.length, 1);
  });

  it('JSON.stringify POST body and sets Content-Type', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = mock.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return jsonResponse({ created: true }, 201);
    });
    configure({ fetchImpl });

    await request({ url: 'https://api.example.com/users', method: 'POST', body: { name: 'Ada' } });

    assert.equal(capturedInit?.body, JSON.stringify({ name: 'Ada' }));
    assert.equal((capturedInit?.headers as Record<string, string>)['Content-Type'], 'application/json');
  });

  it('does not parse body for 204 responses', async () => {
    const fetchImpl = mock.fn(async () => new Response(null, { status: 204 }));
    configure({ fetchImpl });

    const res = await request({ url: 'https://api.example.com/users/1', method: 'DELETE' });

    assert.equal(res.status, 204);
    assert.equal(res.data, undefined);
  });

  it('appends query parameters to the URL', async () => {
    let capturedUrl = '';
    const fetchImpl = mock.fn(async (url: RequestInfo | URL) => {
      capturedUrl = String(url);
      return jsonResponse({});
    });
    configure({ baseUrl: 'https://api.example.com', fetchImpl });

    await request({ url: '/search', params: { q: 'test', tags: ['a', 'b'] } });

    assert.equal(capturedUrl, 'https://api.example.com/search?q=test&tags=a&tags=b');
  });

  it('works with a full URL when baseUrl is not configured', async () => {
    let capturedUrl = '';
    const fetchImpl = mock.fn(async (url: RequestInfo | URL) => {
      capturedUrl = String(url);
      return new Response('plain text content', {
        status: 200,
        headers: { 'content-type': 'text/plain' }
      });
    });
    configure({ fetchImpl });

    const res = await request<string>({ url: 'https://example.com/config.ini' });

    assert.equal(capturedUrl, 'https://example.com/config.ini');
    assert.equal(res.data, 'plain text content');
  });

  it('applies headers from configure() to all requests', async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl = mock.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return jsonResponse({});
    });
    configure({ fetchImpl, headers: { Authorization: 'Bearer TOKEN' } });

    await request({ url: 'https://api.example.com/me' });

    assert.equal(capturedHeaders.Authorization, 'Bearer TOKEN');
  });

  it('per-request headers override configure() defaults', async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl = mock.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return jsonResponse({});
    });
    configure({ fetchImpl, headers: { 'X-Env': 'default' } });

    await request({ url: 'https://api.example.com/me', headers: { 'X-Env': 'override' } });

    assert.equal(capturedHeaders['X-Env'], 'override');
  });

  it('sends rawBody as-is without JSON.stringify', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = mock.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return jsonResponse({ ok: true });
    });
    configure({ fetchImpl });

    await request({
      url: 'https://api.example.com/upload',
      method: 'POST',
      rawBody: 'raw-payload'
    });

    assert.equal(capturedInit?.body, 'raw-payload');
  });

  it('does not override Content-Type when already set for JSON body', async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl = mock.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return jsonResponse({});
    });
    configure({ fetchImpl });

    await request({
      url: 'https://api.example.com/users',
      method: 'POST',
      body: { name: 'Ada' },
      headers: { 'Content-Type': 'application/vnd.api+json' }
    });

    assert.equal(capturedHeaders['Content-Type'], 'application/vnd.api+json');
  });

  it('does not add a duplicate Content-Type when caller uses a different case', async () => {
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl = mock.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedHeaders = init?.headers as Record<string, string>;
      return jsonResponse({});
    });
    configure({ fetchImpl });

    await request({
      url: 'https://api.example.com/users',
      method: 'POST',
      body: { name: 'Ada' },
      headers: { 'content-type': 'text/plain' }
    });

    const keys = Object.keys(capturedHeaders).filter((k) => k.toLowerCase() === 'content-type');
    assert.equal(keys.length, 1, 'should only have one Content-Type-like header key');
    assert.equal(capturedHeaders['content-type'], 'text/plain');
  });

  it('ignores baseUrl when the request url is already absolute', async () => {
    let capturedUrl = '';
    const fetchImpl = mock.fn(async (url: RequestInfo | URL) => {
      capturedUrl = String(url);
      return jsonResponse({});
    });
    configure({ baseUrl: 'https://api.example.com', fetchImpl });

    await request({ url: 'https://other-service.com/data' });

    assert.equal(capturedUrl, 'https://other-service.com/data');
  });

  it('does not attach a JSON body for GET when body is provided', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = mock.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return jsonResponse({});
    });
    configure({ fetchImpl });

    await request({ url: 'https://api.example.com/x', method: 'GET', body: { ignored: true } });

    assert.equal(capturedInit?.body, undefined);
  });

  it('does not attach a JSON body for HEAD when body is provided', async () => {
    let capturedInit: RequestInit | undefined;
    const fetchImpl = mock.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      capturedInit = init;
      return new Response(null, { status: 200 });
    });
    configure({ fetchImpl });

    await request({ url: 'https://api.example.com/x', method: 'HEAD', body: { ignored: true } });

    assert.equal(capturedInit?.body, undefined);
  });
});

describe('request() - AbortSignal', () => {
  it('aborts when the per-request signal is aborted', async () => {
    const controller = new AbortController();
    const fetchImpl = mock.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    });
    configure({ fetchImpl, retry: { retries: 0 } });

    const promise = request({ url: 'https://api.example.com/x', signal: controller.signal });
    controller.abort(new Error('user abort'));

    await assert.rejects(promise, (err: unknown) => {
      assert.ok(err instanceof FetchKitError);
      return true;
    });
  });

  it('rejects when the signal was already aborted before the request', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already aborted'));
    const fetchImpl = mock.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      if (init?.signal?.aborted) throw init.signal.reason ?? new Error('Aborted');
      return jsonResponse({});
    });
    configure({ fetchImpl, retry: { retries: 0 } });

    await assert.rejects(request({ url: 'https://api.example.com/x', signal: controller.signal }), (err: unknown) => {
      assert.ok(err instanceof FetchKitError);
      return true;
    });
    assert.equal(fetchImpl.mock.calls.length, 1);
    assert.ok(fetchImpl.mock.calls[0].arguments[1]?.signal?.aborted);
  });

  it('interrupts the retry backoff wait immediately when the signal is aborted', async () => {
    const controller = new AbortController();
    const fetchImpl = mock.fn(async () => new Response('fail', { status: 503 }));
    configure({
      fetchImpl,
      retry: { retries: 5, baseDelayMs: 2000, maxDelayMs: 2000, jitter: false }
    });

    const start = Date.now();
    const promise = request({ url: 'https://api.example.com/x', signal: controller.signal });
    setTimeout(() => controller.abort(), 50);

    await assert.rejects(promise, (err: unknown) => {
      assert.ok(err instanceof FetchKitError);
      return true;
    });

    const elapsed = Date.now() - start;
    // Should reject shortly after the abort, not after the full 2000ms backoff.
    assert.ok(elapsed < 500, `expected rejection well under 2000ms backoff, took ${elapsed}ms`);
    // Only the first attempt should have run; the retry loop should not continue.
    assert.equal(fetchImpl.mock.calls.length, 1);
  });
});

describe('configure() - logger', () => {
  it('calls logger.warn on retry and logger.error when retries are exhausted', async () => {
    const logger = {
      error: mock.fn(),
      warn: mock.fn(),
      info: mock.fn(),
      debug: mock.fn()
    };
    let callCount = 0;
    const fetchImpl = mock.fn(async () => {
      callCount++;
      if (callCount < 2) return new Response('busy', { status: 503 });
      throw new TypeError('network down');
    });
    configure({ fetchImpl, logger, retry: { retries: 2, baseDelayMs: 5 } });

    await assert.rejects(request({ url: 'https://api.example.com/flaky' }));

    assert.equal(logger.warn.mock.calls.length, 2);
    assert.equal(logger.error.mock.calls.length, 1);
  });
});

describe('request() - retry behavior', () => {
  it('retries on retryOnStatusCodes and eventually succeeds', async () => {
    let callCount = 0;
    const fetchImpl = mock.fn(async () => {
      callCount++;
      if (callCount < 3) return new Response('busy', { status: 503 });
      return jsonResponse({ attempt: callCount });
    });
    configure({ fetchImpl, retry: { retries: 3, baseDelayMs: 5, maxDelayMs: 20 } });

    const res = await request({ url: 'https://api.example.com/flaky' });

    assert.equal(callCount, 3);
    assert.deepEqual(res.data, { attempt: 3 });
  });

  it('throws FetchKitError when all attempts are exhausted', async () => {
    const fetchImpl = mock.fn(async () => new Response('down', { status: 503 }));
    configure({ fetchImpl, retry: { retries: 2, baseDelayMs: 5, maxDelayMs: 10 } });

    await assert.rejects(request({ url: 'https://api.example.com/always-down' }), (err: unknown) => {
      assert.ok(err instanceof FetchKitError);
      assert.equal((err as FetchKitError).status, 503);
      return true;
    });
  });

  it('throws immediately without retry when status is not in retryOnStatusCodes', async () => {
    let callCount = 0;
    const fetchImpl = mock.fn(async () => {
      callCount++;
      return new Response('not found', { status: 404 });
    });
    configure({ fetchImpl, retry: { retries: 3, baseDelayMs: 5 } });

    await assert.rejects(request({ url: 'https://api.example.com/missing' }));
    assert.equal(callCount, 1);
  });

  it('allows custom retry logic via shouldRetry', async () => {
    let callCount = 0;
    const fetchImpl = mock.fn(async () => {
      callCount++;
      return new Response('nope', { status: 404 });
    });
    configure({
      fetchImpl,
      retry: {
        retries: 2,
        baseDelayMs: 5,
        shouldRetry: ({ response }) => response?.status === 404
      }
    });

    await assert.rejects(request({ url: 'https://api.example.com/custom' }));
    assert.equal(callCount, 3); // retried on 404 thanks to shouldRetry
  });

  it('supports fully custom delay via computeDelay', async () => {
    let callCount = 0;
    const delays: number[] = [];
    const fetchImpl = mock.fn(async () => {
      callCount++;
      if (callCount < 2) return new Response('busy', { status: 503 });
      return jsonResponse({ ok: true });
    });
    configure({
      fetchImpl,
      retry: {
        retries: 2,
        baseDelayMs: 1000,
        computeDelay: (_ctx, defaultMs) => {
          delays.push(defaultMs);
          return 5;
        }
      }
    });

    await request({ url: 'https://api.example.com/custom-delay' });
    assert.equal(delays.length, 1);
  });

  it('calls onRetry on each retry attempt', async () => {
    let callCount = 0;
    const onRetry = mock.fn();
    const fetchImpl = mock.fn(async () => {
      callCount++;
      if (callCount < 2) return new Response('busy', { status: 503 });
      return jsonResponse({ ok: true });
    });
    configure({ fetchImpl, retry: { retries: 2, baseDelayMs: 5, onRetry } });

    await request({ url: 'https://api.example.com/notify' });
    assert.equal(onRetry.mock.calls.length, 1);
  });

  it('retries on network errors (fetch rejection)', async () => {
    let callCount = 0;
    const fetchImpl = mock.fn(async () => {
      callCount++;
      if (callCount < 2) throw new TypeError('network down');
      return jsonResponse({ ok: true });
    });
    configure({ fetchImpl, retry: { retries: 2, baseDelayMs: 5 } });

    const res = await request({ url: 'https://api.example.com/network-flaky' });
    assert.deepEqual(res.data, { ok: true });
    assert.equal(callCount, 2);
  });

  it('per-request retry overrides configure() defaults', async () => {
    let callCount = 0;
    const fetchImpl = mock.fn(async () => {
      callCount++;
      return new Response('down', { status: 503 });
    });
    configure({ fetchImpl, retry: { retries: 5, baseDelayMs: 5 } });

    await assert.rejects(request({ url: 'https://api.example.com/x', retry: { retries: 1, baseDelayMs: 5 } }));
    assert.equal(callCount, 2); // per-request retries: 1, not configure's 5
  });
});

describe('request() - timeout', () => {
  it('aborts the request and throws when timeoutMs elapses', async () => {
    const fetchImpl = mock.fn((_url: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    });
    configure({ fetchImpl, timeoutMs: 20, retry: { retries: 0 } });

    await assert.rejects(request({ url: 'https://api.example.com/slow' }), (err: unknown) => {
      assert.ok(err instanceof FetchKitError);
      return true;
    });
  });
});
