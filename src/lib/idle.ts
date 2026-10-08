/** Runs `task` once the page is idle, or after `timeout` at the latest. The returned function calls it off. */
export function whenIdle(task: () => void, timeout = 3_000): () => void {
  if (typeof requestIdleCallback !== 'function') {
    const timer = setTimeout(task, 1_000);
    return () => clearTimeout(timer);
  }
  const idle = requestIdleCallback(task, { timeout });
  return () => cancelIdleCallback(idle);
}
