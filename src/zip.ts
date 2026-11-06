import { Zip, ZipDeflate, ZipPassThrough, strToU8 } from 'fflate';

/**
 * Streams files into a ZIP as they are added, so a large batch only keeps the
 * compressed bytes in memory, not every model at once.
 */
export class ZipWriter {
  private chunks: Uint8Array[] = [];
  private zip: Zip;
  private done: Promise<void>;

  constructor() {
    let resolve!: () => void;
    let reject!: (e: Error) => void;
    this.done = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    this.zip = new Zip((err, chunk, final) => {
      if (err) return reject(err);
      this.chunks.push(chunk);
      if (final) resolve();
    });
  }

  /** Already-compressed data (PNG) is stored; everything else is deflated. */
  add(name: string, data: Uint8Array | string, compress = true) {
    const bytes = typeof data === 'string' ? strToU8(data) : data;
    const file = compress ? new ZipDeflate(name, { level: 6 }) : new ZipPassThrough(name);
    this.zip.add(file);
    file.push(bytes, true);
  }

  /** The ZIP as Blob parts (fflate emits fresh ArrayBuffer-backed chunks). */
  async finish(): Promise<Uint8Array<ArrayBuffer>[]> {
    this.zip.end();
    await this.done;
    return this.chunks as Uint8Array<ArrayBuffer>[];
  }

  abort() {
    this.zip.terminate();
    this.chunks = [];
  }
}
