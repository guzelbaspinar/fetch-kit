import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { computeExponentialDelay, sleep } from './backoff.js';

describe('computeExponentialDelay', () => {
  const opts = { baseDelayMs: 1000, maxDelayMs: 30_000, factor: 2, jitter: false };

  it('produces pure exponential growth when jitter is off', () => {
    assert.equal(computeExponentialDelay(1, opts), 1000); // 1000 * 2^0
    assert.equal(computeExponentialDelay(2, opts), 2000); // 1000 * 2^1
    assert.equal(computeExponentialDelay(3, opts), 4000); // 1000 * 2^2
    assert.equal(computeExponentialDelay(4, opts), 8000); // 1000 * 2^3
  });

  it('does not exceed maxDelayMs', () => {
    assert.equal(computeExponentialDelay(10, opts), 30_000);
  });

  it('with jitter on, produces a value between 0 and the cap', () => {
    for (let i = 0; i < 50; i++) {
      const delay = computeExponentialDelay(3, { ...opts, jitter: true });
      assert.ok(delay >= 0 && delay <= 4000, `delay ${delay} is outside expected range`);
    }
  });

  it('computes correctly with different factor values', () => {
    assert.equal(computeExponentialDelay(3, { ...opts, factor: 3 }), 9000); // 1000 * 3^2
  });
});

describe('sleep', () => {
  it('waits for the given duration', async () => {
    const start = Date.now();
    await sleep(30);
    assert.ok(Date.now() - start >= 25);
  });

  it('rejects when signal is aborted', async () => {
    const controller = new AbortController();
    const promise = sleep(1000, controller.signal);
    controller.abort(new Error('aborted'));
    await assert.rejects(promise, /aborted/);
  });

  it('rejects immediately when signal was already aborted', async () => {
    const controller = new AbortController();
    controller.abort(new Error('already aborted'));
    await assert.rejects(sleep(1000, controller.signal), /already aborted/);
  });
});
