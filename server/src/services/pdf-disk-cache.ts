import { mkdir, readdir, lstat, readFile, writeFile, rename, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

/** One writer process per directory. Only hash-named PDF cache files are managed. */
export class PdfDiskCache {
  private files = new Map<string, { bytes: number; time: number }>();
  private bytes = 0;
  private enabled = false;
  private tail: Promise<void>;
  private ready: Promise<void>;
  constructor(private directory: string | null, private maxFiles: number, private maxBytes: number) {
    this.ready = this.initialize();
    this.tail = this.ready;
  }
  private valid(key: string) { return /^[a-f0-9]{64}$/.test(key); }
  private async initialize() {
    if (!this.directory) return;
    try {
      await mkdir(this.directory, { recursive: true });
      for (const name of await readdir(this.directory)) {
        const key = name.replace(/\.pdf$/, '');
        if (name !== `${key}.pdf` || !this.valid(key)) continue;
        const info = await lstat(join(this.directory, name)).catch(() => null);
        if (!info?.isFile()) continue;
        this.files.set(key, { bytes: info.size, time: info.mtimeMs }); this.bytes += info.size;
      }
      this.enabled = true;
      await this.trim();
    } catch { this.enabled = false; }
  }
  private async trim() {
    if (!this.directory || (this.bytes <= this.maxBytes && this.files.size <= this.maxFiles)) return;
    const targetBytes = this.maxBytes * 0.9, targetFiles = Math.max(1, Math.floor(this.maxFiles * 0.9));
    for (const [key, info] of [...this.files].sort((a, b) => a[1].time - b[1].time)) {
      if (this.bytes <= targetBytes && this.files.size <= targetFiles) break;
      try { await unlink(join(this.directory, `${key}.pdf`)); }
      catch (error: any) { if (error.code !== 'ENOENT') continue; }
      this.files.delete(key); this.bytes -= info.bytes;
    }
  }
  async read(key: string): Promise<Buffer | null> {
    await this.ready;
    if (!this.enabled || !this.directory || !this.valid(key) || !this.files.has(key)) return null;
    // Large historical entries are never loaded before the startup sweep.
    try { return await readFile(join(this.directory, `${key}.pdf`)); } catch { return null; }
  }
  write(key: string, pdf: Buffer): Promise<void> {
    // Called inside the render gate; writers are bounded by render concurrency.
    const operation = this.tail.then(async () => {
      if (!this.enabled || !this.directory || !this.valid(key) || pdf.length > this.maxBytes) return;
      const target = join(this.directory, `${key}.pdf`);
      const temp = `${target}.${process.pid}.${randomUUID()}.tmp`;
      try {
        await writeFile(temp, pdf, { flag: 'wx' });
        await rename(temp, target);
        this.bytes -= this.files.get(key)?.bytes || 0;
        this.files.set(key, { bytes: pdf.length, time: Date.now() }); this.bytes += pdf.length;
        await this.trim();
      } catch { /* Cache failure must not fail the report. */ }
      finally { await unlink(temp).catch(() => {}); }
    });
    this.tail = operation.catch(() => {});
    return this.tail;
  }
  stats() { return { enabled: this.enabled, files: this.files.size, bytes: this.bytes, max_bytes: this.maxBytes, max_files: this.maxFiles }; }
}
