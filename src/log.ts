/**
 * Scoped console logging. Every line reads `[Scope]: message`, with a short scope (System, Load,
 * Tree, Grove, Export, Batch, i18n). A step reports its start ("Exporting ...") and its end with the
 * time and the figures that matter ("Saved 'x.glb' in 41.2 ms; bytes=..."), warns when it falls
 * back to something, and errors when it fails.
 *
 * Every line goes to the browser's developer console (F12), in dev and in the deployed build
 * alike, so a deployed page leaves the same trace. Info lines stay silent under Vitest; warnings
 * and errors always print. Runs in Node too, so modules the tests import can log.
 */

const enabled = import.meta.env.MODE !== 'test';

/** The error object goes to the console as-is, so its stack trace stays clickable. */
const extra = (error: unknown) => (error === undefined ? [] : [error]);

export function log(scope: string, message: string) {
  if (enabled) console.log(`[${scope}]: ${message}`);
}

export function logWarn(scope: string, message: string, error?: unknown) {
  console.warn(`[${scope}]: ${message}`, ...extra(error));
}

export function logError(scope: string, message: string, error?: unknown) {
  console.error(`[${scope}]: ${message}`, ...extra(error));
}

/** Starts a stopwatch; calling the result gives the milliseconds since, to one decimal. */
export function stopwatch(): () => string {
  const t0 = performance.now();
  return () => (performance.now() - t0).toFixed(1);
}
