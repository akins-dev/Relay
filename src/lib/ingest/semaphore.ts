/**
 * Simple in-memory semaphore to limit concurrent executions.
 * Used primarily to protect the Render Sandbox container from OOM crashes
 * during high-concurrency local ingest runs.
 * NOTE: Local ingest is also used for cron
 */
export class Semaphore {
  private tasks: Array<() => void> = [];
  private activeCount: number = 0;

  constructor(maxConcurrent: number) {
    if (!Number.isFinite(maxConcurrent) || maxConcurrent < 1) {
      throw new Error('Semaphore maxConcurrent must be at least 1');
    }
    this.maxConcurrent = Math.floor(maxConcurrent);
  }

  private readonly maxConcurrent: number;

  async acquire(): Promise<void> {
    if (this.activeCount < this.maxConcurrent) {
      this.activeCount++;
      return Promise.resolve();
    }

    return new Promise<void>((resolve) => {
      this.tasks.push(resolve);
    });
  }

  release(): void {
    this.activeCount--;
    const nextTask = this.tasks.shift();
    if (nextTask) {
      this.activeCount++;
      nextTask();
    }
  }

  /**
   * Run a function with concurrency protection
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
