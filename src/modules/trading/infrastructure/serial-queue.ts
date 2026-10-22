/**
 * Runs tasks with the same key one after another, and tracks every task so tests and shutdown can
 * wait until nothing is running.
 */
export class SerialQueue {
  private readonly tails = new Map<string, Promise<unknown>>();
  private readonly running = new Set<Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.tails.get(key) ?? Promise.resolve();
    const next = previous.catch(() => undefined).then(task);
    const tail = next.catch(() => undefined);
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }

  /** Tracks work that has not reached a queue yet (it reads before it knows its key). */
  track<T>(task: Promise<T>): Promise<T> {
    this.running.add(task);
    void task.catch(() => undefined).finally(() => this.running.delete(task));
    return task;
  }

  async idle(): Promise<void> {
    while (this.tails.size > 0 || this.running.size > 0) {
      await Promise.allSettled([...this.tails.values(), ...this.running]);
    }
  }
}
