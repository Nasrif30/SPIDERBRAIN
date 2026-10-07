import { mkdirSync, statSync } from 'node:fs';
import { appendFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
/** Fixed local paths, 512 pending records, 64 per async write, two files <=5 MiB each. */
export class DemoLog {
  private queue: string[] = [];
  private running: Promise<void> | undefined;
  private bytes = 0;
  private closed = false;
  online = true;
  processed = 0;
  dropped = 0;
  readonly path: string;
  constructor(directory: string) {
    this.path = join(directory, 'traffic.jsonl');
    try { mkdirSync(directory, { recursive: true }); try { this.bytes = statSync(this.path).size; } catch { /* fresh log */ } }
    catch { this.online = false; }
  }
  append(record: unknown): void {
    if (!this.online || this.closed) return;
    if (this.queue.length >= 512) { this.dropped++; return; }
    this.queue.push(JSON.stringify(record) + '\n');
    if (!this.running) this.running = this.drain();
  }
  private async drain(): Promise<void> {
    await new Promise<void>(resolve => setImmediate(resolve));
    let inFlight = 0;
    try {
      while (this.queue.length) {
        const batch = this.queue.splice(0, 64), text = batch.join(''), size = Buffer.byteLength(text);
        inFlight = batch.length;
        if (this.bytes + size > 5 * 1024 * 1024) { await rename(this.path, this.path.replace('traffic.jsonl', 'traffic.previous.jsonl')); this.bytes = 0; }
        await appendFile(this.path, text, { encoding: 'utf8', mode: 0o600 });
        this.bytes += size; this.processed += batch.length;
        inFlight = 0;
        await new Promise<void>(resolve => setImmediate(resolve));
      }
    } catch { this.online = false; this.dropped += inFlight + this.queue.length; this.queue = []; }
    finally { this.running = undefined; }
  }
  async close(): Promise<void> { this.closed = true; await this.running; }
}
