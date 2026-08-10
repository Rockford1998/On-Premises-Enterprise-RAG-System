export type RetryOptions = {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs?: number;
  /**
   * Decide whether a given failure is worth another attempt. Defaults to
   * retrying everything, but callers should almost always narrow this —
   * retrying a deterministic error just returns the same failure, slower.
   */
  shouldRetry?: (error: unknown, attempt: number) => boolean;
  onRetry?: (error: unknown, attempt: number, delayMs: number) => void;
};

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry with exponential backoff and full jitter.
 *
 * Jitter matters when several callers fail at once (a Postgres restart, say):
 * fixed backoff wakes them all at the same instant and stampedes the
 * recovering server. Randomising each delay spreads the retries out.
 */
export const retry = async <T>(
  fn: () => Promise<T>,
  options: RetryOptions,
): Promise<T> => {
  const {
    maxAttempts,
    baseDelayMs,
    maxDelayMs = 30_000,
    shouldRetry = () => true,
    onRetry,
  } = options;

  let lastError: unknown;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;

      const isLastAttempt = attempt >= maxAttempts;
      if (isLastAttempt || !shouldRetry(error, attempt)) {
        throw error;
      }

      const exponential = Math.min(baseDelayMs * 2 ** (attempt - 1), maxDelayMs);
      const delay = Math.round(Math.random() * exponential);

      onRetry?.(error, attempt, delay);
      await sleep(delay);
    }
  }

  // Unreachable: the loop either returns or throws.
  throw lastError;
};
