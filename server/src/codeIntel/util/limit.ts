/**
 * Minimal concurrency limiter (p-limit is ESM-only from v4 and this server is
 * CommonJS). `limit(fn)` runs `fn` when a slot is free and resolves with its
 * result; at most `concurrency` calls are in flight at once.
 */
export const createLimiter = (concurrency: number) => {
  const max = Math.max(1, Math.floor(concurrency));
  let active = 0;
  const queue: Array<() => void> = [];

  const next = () => {
    if (active >= max) return;
    const job = queue.shift();
    if (!job) return;
    active++;
    job();
  };

  return <T>(fn: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        fn()
          .then(resolve, reject)
          .finally(() => {
            active--;
            next();
          });
      });
      next();
    });
};

/** Let the event loop breathe: indexing is CPU-bound and shares a process with the API. */
export const yieldToEventLoop = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));
