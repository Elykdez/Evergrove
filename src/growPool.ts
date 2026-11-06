import { log, logWarn } from './log';
import { generateTree, type TreeParams, type TreeResult } from './tree';
import { unpackTree, type PackedTree } from './transfer';

/**
 * Grows trees in a small pool of workers, so growth never freezes the page: the retro world
 * keeps animating and the panel keeps responding while trees grow, several at once. Results are
 * exactly what generateTree gives on the page (same code, same seed). If workers cannot start,
 * growth falls back to the main thread.
 */

/** Workers in the pool: one core stays free for the page itself. */
export const GROW_WORKERS = Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1));

type Job = {
  id: number;
  params: TreeParams;
  signal?: AbortSignal;
  resolve: (result: TreeResult) => void;
  reject: (error: Error) => void;
};
type Reply = { id: number; tree?: PackedTree; error?: string; stack?: string };

const queue: Job[] = [];
const idle: Worker[] = [];
const running = new Map<Worker, Job>();
let created = 0;
let broken = false;
let nextId = 0;

const aborted = () => new DOMException('Growth cancelled', 'AbortError');

/**
 * Grows `params` in a worker. The params are copied now, so later edits never reach the job.
 * Aborting `signal` drops the job if it has not started yet (a started one runs to the end).
 */
export function growTree(params: TreeParams, signal?: AbortSignal): Promise<TreeResult> {
  const snapshot = structuredClone(params);
  const promise = new Promise<TreeResult>((resolve, reject) => {
    queue.push({ id: nextId++, params: snapshot, signal, resolve, reject });
  });
  pump();
  return promise;
}

/** Starts one worker ahead of the first job, so its module load overlaps the page's own start. */
export function warmGrowth() {
  if (created || broken) return;
  const worker = spawn();
  if (worker) idle.push(worker);
}

function spawn(): Worker | null {
  try {
    const worker = new Worker(new URL('./grow.worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<Reply>) => finish(worker, e.data);
    worker.onerror = (e) => {
      e.preventDefault();
      breakPool(new Error(e.message || 'Growth worker failed to load'), worker);
    };
    if (created === 0) log('Tree', `Growing in up to ${GROW_WORKERS} workers.`);
    created++;
    return worker;
  } catch (e) {
    breakPool(e);
    return null;
  }
}

/** A worker that fails to load breaks the pool: its job and every later one grow on the page. */
function breakPool(error: unknown, worker?: Worker) {
  if (!broken) logWarn('Tree', 'Growth workers unavailable; growing on the main thread instead.', error);
  broken = true;
  const job = worker && running.get(worker);
  if (worker) {
    running.delete(worker);
    worker.terminate();
  }
  if (job) queue.unshift(job);
  pump();
}

function growHere(job: Job) {
  try {
    job.resolve(generateTree(job.params));
  } catch (e) {
    job.reject(e instanceof Error ? e : new Error(String(e)));
  }
}

function pump() {
  while (queue.length) {
    const job = queue[0];
    if (job.signal?.aborted) {
      queue.shift();
      job.reject(aborted());
      continue;
    }
    if (broken) {
      queue.shift();
      growHere(job);
      continue;
    }
    const worker = idle.pop() ?? (created < GROW_WORKERS ? spawn() : null);
    if (!worker) {
      if (broken) continue;
      return;
    }
    queue.shift();
    running.set(worker, job);
    worker.postMessage({ id: job.id, params: job.params });
  }
}

function finish(worker: Worker, reply: Reply) {
  const job = running.get(worker);
  running.delete(worker);
  idle.push(worker);
  if (job && job.id === reply.id) {
    if (reply.tree) job.resolve(unpackTree(reply.tree, job.params));
    else {
      const error = new Error(reply.error ?? 'Growth failed');
      if (reply.stack) error.stack = reply.stack;
      job.reject(error);
    }
  }
  pump();
}
