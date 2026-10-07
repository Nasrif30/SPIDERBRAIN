import type { VibrationEvent } from '@spiderbrain/shared';
type Listener = (event: VibrationEvent) => void | Promise<void>;
/** Bounded, synchronous delivery. Each subscriber is isolated from the application. */
export class Silk {
  private readonly listeners = new Set<Listener>();
  constructor(private readonly onError: () => void = () => {}, private readonly limit = 32) {}
  subscribe(listener: Listener): () => void {
    if (this.listeners.size >= this.limit) throw new Error('SILK subscriber limit reached');
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }
  publish(event: VibrationEvent): void {
    for (const listener of this.listeners) {
      try {
        // Copies prevent a subscriber from changing later subscribers' evidence.
        const result = listener(structuredClone(event));
        if (result && typeof result.catch === 'function') void result.catch(() => this.report());
      } catch { this.report(); }
    }
  }
  private report(): void { try { this.onError(); } catch { /* fail open */ } }
  close(): void { this.listeners.clear(); }
}
