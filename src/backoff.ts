/**
 * attempt: retry attempt number starting at 1 (first retry, second retry, ...)
 * Full jitter: delay = random(0, min(maxDelay, base * factor^(attempt-1)))
 * Reduces thundering herd when many clients retry at once.
 */
export function computeExponentialDelay(
  attempt: number,
  {
    baseDelayMs,
    maxDelayMs,
    factor,
    jitter
  }: { baseDelayMs: number; maxDelayMs: number; factor: number; jitter: boolean }
): number {
  const rawDelay = baseDelayMs * Math.pow(factor, attempt - 1);
  const cappedDelay = Math.min(rawDelay, maxDelayMs);
  if (!jitter) return cappedDelay;
  return Math.floor(Math.random() * cappedDelay);
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error('Aborted'));
      return;
    }
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener(
      'abort',
      () => {
        clearTimeout(timer);
        reject(signal.reason ?? new Error('Aborted'));
      },
      { once: true }
    );
  });
}
