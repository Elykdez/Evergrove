/**
 * Latest-wins scheduling for repeated generation, such as regrowing a tree while a slider moves.
 *
 * request() asks for a run with the newest inputs. A run reads its inputs when it starts, so every
 * request made before then folds into it. Runs start at most every `interval` ms, only after
 * `quiet` ms without a request (a debounce, 0 for none), and at most `parallel` at once, so
 * several can overlap in the growth workers. Results land in start order: a run that finishes
 * after a newer one landed is dropped instead. No DOM or three.js, so it runs in Node too.
 */
export interface ThrottleOptions<T> {
  /** Starts one run, reading its inputs now. */
  start: () => Promise<T>;
  /** Applies a run's result; called in start order, never for a result older than one applied. */
  land?: (value: T) => void;
  /** Receives a result that a newer run beat, so it can be freed. */
  drop?: (value: T) => void;
  /** A run or land() threw; without this the error surfaces as an unhandled rejection. */
  fail?: (error: unknown) => void;
  /** Least time between two starts, in ms. */
  interval?: number;
  /** Time without a request before a run starts, in ms. */
  quiet?: number;
  /** Runs in flight at once. */
  parallel?: number;
}

export interface Throttle {
  /** Asks for a run with the newest inputs; `now` skips the quiet time and the interval. */
  request(now?: boolean): void;
  /** Resolves once no run is waiting or in flight. */
  idle(): Promise<void>;
}

export function throttle<T>(o: ThrottleOptions<T>): Throttle {
  const interval = o.interval ?? 0;
  const quiet = o.quiet ?? 0;
  const parallel = Math.max(1, o.parallel ?? 1);
  let wanted = false;
  let readyAt = 0;
  let lastStart = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = 0;
  let started = 0;
  let landed = 0;
  let waiters: (() => void)[] = [];

  const settled = () => !wanted && running === 0 && timer === null;

  function pump() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
    if (wanted && running < parallel) {
      const now = Date.now();
      const at = Math.max(readyAt, lastStart + interval);
      if (at > now) timer = setTimeout(pump, at - now);
      else launch(now);
    }
    if (settled()) {
      const done = waiters;
      waiters = [];
      for (const resolve of done) resolve();
    }
  }

  function launch(now: number) {
    wanted = false;
    lastStart = now;
    running++;
    const seq = ++started;
    let run: Promise<T>;
    try {
      run = o.start();
    } catch (e) {
      run = Promise.reject(e);
    }
    run
      .then((value) => {
        if (seq > landed) {
          landed = seq;
          o.land?.(value);
        } else o.drop?.(value);
      })
      .catch((e) => {
        if (o.fail) o.fail(e);
        else void Promise.reject(e);
      })
      .finally(() => {
        running--;
        pump();
      });
  }

  return {
    request(now = false) {
      wanted = true;
      readyAt = now ? 0 : Date.now() + quiet;
      if (now) lastStart = -Infinity;
      pump();
    },
    idle() {
      return settled() ? Promise.resolve() : new Promise<void>((resolve) => waiters.push(resolve));
    },
  };
}
