import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { throttle } from '../src/throttle';

/** A run that finishes when the test says so. */
function deferred<T>() {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => (resolve = r));
  return { promise, resolve };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

describe('throttle', () => {
  it('folds requests within the interval into one later run of the newest input', async () => {
    let input = 0;
    const starts: number[] = [];
    const landed: number[] = [];
    const t = throttle<number>({ interval: 100, parallel: 4, start: async () => (starts.push(input), input), land: (v) => landed.push(v) });
    for (input = 1; input <= 5; input++) t.request();
    input = 5;
    await vi.advanceTimersByTimeAsync(0);
    expect(starts).toEqual([1]);
    await vi.advanceTimersByTimeAsync(100);
    expect(starts).toEqual([1, 5]);
    await t.idle();
    expect(landed).toEqual([1, 5]);
  });

  it('drops a run that finishes after a newer one landed', async () => {
    const runs = [deferred<string>(), deferred<string>()];
    let n = 0;
    const landed: string[] = [];
    const dropped: string[] = [];
    const t = throttle<string>({ parallel: 2, start: () => runs[n++].promise, land: (v) => landed.push(v), drop: (v) => dropped.push(v) });
    t.request();
    t.request();
    expect(n).toBe(2);
    runs[1].resolve('new');
    await vi.advanceTimersByTimeAsync(0);
    runs[0].resolve('old');
    await t.idle();
    expect(landed).toEqual(['new']);
    expect(dropped).toEqual(['old']);
  });

  it('keeps to the parallel limit and starts the waiting request when a run ends', async () => {
    const run = deferred<void>();
    let n = 0;
    const t = throttle<void>({ start: () => (n++ === 0 ? run.promise : Promise.resolve()) });
    t.request();
    t.request();
    t.request();
    expect(n).toBe(1);
    run.resolve();
    await t.idle();
    expect(n).toBe(2);
  });

  it('waits for quiet unless asked to run now', async () => {
    let n = 0;
    const t = throttle<void>({ quiet: 400, start: async () => void n++ });
    t.request();
    await vi.advanceTimersByTimeAsync(300);
    t.request();
    await vi.advanceTimersByTimeAsync(300);
    expect(n).toBe(0);
    await vi.advanceTimersByTimeAsync(100);
    expect(n).toBe(1);
    t.request(true);
    await vi.advanceTimersByTimeAsync(0);
    expect(n).toBe(2);
  });

  it('reports a failed run and carries on', async () => {
    const errors: unknown[] = [];
    let n = 0;
    const t = throttle<number>({
      start: async () => {
        if (n++ === 0) throw new Error('boom');
        return n;
      },
      fail: (e) => errors.push(e),
    });
    t.request();
    await t.idle();
    t.request();
    await t.idle();
    expect(errors).toHaveLength(1);
    expect(n).toBe(2);
  });
});
