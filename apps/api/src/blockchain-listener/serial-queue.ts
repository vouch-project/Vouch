/**
 * Runs async tasks serially per key, in the order they were enqueued.
 *
 * ethers fires event listeners concurrently; without serialization a
 * LoanPartiallyRepaid can be processed before the corresponding LoanFunded
 * write completes, leaving lenderAddress NULL when the repayment RPC needs it.
 * Tasks for different keys run independently.
 */
export class SerialQueue {
  private readonly queues = new Map<string, Promise<void>>();

  // onError is invoked when a task rejects; a rejection never poisons the
  // queue, so subsequent tasks for the same key still run.
  constructor(private readonly onError?: (key: string, err: unknown) => void) {}

  enqueue(key: string, task: () => Promise<void>): void {
    const prev = this.queues.get(key) ?? Promise.resolve();
    // Ignore the previous task's outcome so one failure can't block the chain,
    // then run this task and route any rejection to onError.
    const next = prev
      .catch(() => undefined)
      .then(task)
      .catch((err) => this.onError?.(key, err));
    this.queues.set(key, next);
  }

  /** Resolves once all work currently queued for `key` has settled. */
  idle(key: string): Promise<void> {
    return this.queues.get(key) ?? Promise.resolve();
  }
}
