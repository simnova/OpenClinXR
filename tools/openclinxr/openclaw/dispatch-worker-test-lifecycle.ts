/** Own asynchronous unit-fixture work until cleanup, preserving every rejection. */
export function createTestLifecycle() {
  type Outcome = { ok: true } | { ok: false; error: unknown };
  const pending = new Set<Promise<Outcome>>();
  return {
    run<T>(work: () => Promise<T>): Promise<T> {
      const task = Promise.resolve().then(work);
      // Attach rejection ownership immediately; cleanup still rejects with the original error.
      const outcome = task.then<Outcome, Outcome>(
        () => ({ ok: true }),
        (error) => ({ ok: false, error }),
      );
      pending.add(outcome);
      return task;
    },
    async drain(): Promise<void> {
      const errors: unknown[] = [];
      while (pending.size) {
        const batch = [...pending];
        const outcomes = await Promise.all(batch);
        for (const task of batch) pending.delete(task);
        for (const outcome of outcomes) if (!outcome.ok) errors.push(outcome.error);
      }
      if (errors.length) throw new AggregateError(errors, "Owned fixture tasks failed");
    },
  };
}

export const dispatchFixtureLifecycle = createTestLifecycle();
