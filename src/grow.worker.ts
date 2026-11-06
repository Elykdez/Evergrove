import { generateTree, type TreeParams } from './tree';
import { packTree } from './transfer';

/** Growth worker: grows one tree per message, off the page's main thread (see growPool.ts). */
const scope = self as unknown as {
  onmessage: ((e: MessageEvent<{ id: number; params: TreeParams }>) => void) | null;
  postMessage(message: unknown, transfer?: Transferable[]): void;
};

scope.onmessage = (e) => {
  const { id, params } = e.data;
  try {
    const { tree, transfer } = packTree(generateTree(params));
    scope.postMessage({ id, tree }, transfer);
  } catch (err) {
    const error = err instanceof Error ? err : new Error(String(err));
    scope.postMessage({ id, error: error.message, stack: error.stack });
  }
};
