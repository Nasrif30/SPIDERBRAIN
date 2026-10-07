import type { Observation, Signal, BehavioralFingerprint, Eye } from '@spiderbrain/shared';
import { family } from '../physics/resonance.js';
import { decay } from '../physics/decay.js';
import { signal } from '../eyes/context.js';
export function category(route: string): string { return family(route) ?? (route === '/robots.txt' ? 'discovery' : ['/', '/about', '/products', '/account'].includes(route) ? 'public' : 'unknown'); }
const sensitive = (name: string) => name === 'configuration' || name === 'administration';
export interface TemporalPoint { timestamp: number; route: string; category: string; failed: boolean; honey: boolean }
/** Short context stays in the existing 30-second window. Medium stores 32 important
 * points for ten minutes; long context is two decaying counters, not a request log. */
export class TemporalMemory {
  private points: TemporalPoint[] = [];
  private last = 0;
  private entry = -Infinity;
  private failed = 0;
  private clean = 0;
  readonly categories: string[] = [];
  readonly timing: string[] = [];
  private readonly profile: Partial<Record<Eye, number>> = {};
  observe(event: Observation): void {
    const elapsed = this.last ? Math.max(0, event.timestamp - this.last) : 0;
    this.failed = decay(this.failed, elapsed, .0015); this.clean = decay(this.clean, elapsed, .0015);
    const name = category(event.route), failed = sensitive(name) && [401, 403, 404].includes(event.status);
    if (name === 'public' || name === 'discovery') this.entry = event.timestamp;
    if (failed) this.failed = Math.min(32, this.failed + 1); else if (event.status < 400 && !event.honey?.length) this.clean = Math.min(64, this.clean + 1);
    this.points = this.points.filter(point => event.timestamp - point.timestamp <= 600_000);
    if (failed || event.honey?.length || name === 'discovery') { this.points.push({ timestamp: event.timestamp, route: event.route, category: name, failed, honey: !!event.honey?.length }); if (this.points.length > 32) this.points.shift(); }
    this.categories.push(event.honey?.length ? 'synthetic' : name); if (this.categories.length > 32) this.categories.shift();
    if (this.last) { this.timing.push(elapsed < 200 ? 'burst' : elapsed <= 2000 ? 'fast' : elapsed <= 15000 ? 'paced' : elapsed <= 90000 ? 'sparse' : 'paused'); if (this.timing.length > 32) this.timing.shift(); }
    this.last = event.timestamp;
  }
  context(now: number) {
    const points = this.points.filter(point => point.failed && now - point.timestamp <= 600_000);
    return { points, distinct: new Set(points.map(point => point.route)).size, categories: new Set(points.map(point => point.category)).size,
      span: points.length ? now - points[0]!.timestamp : 0, anchored: now - this.entry <= 600_000,
      balance: this.failed / Math.max(1, this.failed + this.clean), longWeight: decay(this.failed, now - this.last, .0015) };
  }
  correlated(now: number): boolean { const c = this.context(now); return c.anchored && c.points.length >= 5 && c.distinct >= 3 && c.categories >= 2 && c.span >= 20_000 && c.balance >= .35; }
  movement(event: Observation): Signal[] {
    if (!sensitive(category(event.route)) || ![401, 403, 404].includes(event.status) || !this.correlated(event.timestamp)) return [];
    const c = this.context(event.timestamp);
    return [signal('movement', 'structured temporal traversal', Math.min(3.5, 1.5 + c.longWeight * .35), .72,
      `${c.points.length} failed sensitive observations across ${c.distinct} routes and ${c.categories} categories over ${Math.round(c.span / 1000)} seconds, anchored in navigation; strength follows the decayed long counter and remains capped`, event.timestamp, .004)];
  }
  sequence(): readonly TemporalPoint[] { return this.points; }
  rememberEyes(totals: Partial<Record<Eye, number>>): void { for (const [name, value] of Object.entries(totals)) this.profile[name as Eye] = Math.min(5, Math.max(value ?? 0, (this.profile[name as Eye] ?? 0) * .95)); }
  behavior(durationMs: number, honeyTouches: number): BehavioralFingerprint {
    const transitionShape = this.categories.slice(1).map((name, i) => { const previous = this.categories[i]!; return name === previous ? 'same' : sensitive(previous) && sensitive(name) ? 'cross-sensitive' : sensitive(name) ? 'toward-sensitive' : name === 'public' ? 'return-public' : 'other'; });
    return { categories: this.categories.slice(), transitionShape, timingBuckets: this.timing.slice(), velocityProfile: ['burst', 'fast', 'paced', 'sparse', 'paused'].map(name => this.timing.filter(bucket => bucket === name).length / Math.max(1, this.timing.length)),
      eyeProfile: { ...this.profile }, honeyInterest: honeyTouches >= 3 ? 'HIGH' : honeyTouches ? 'LOW' : 'NONE', durationMs: Math.max(0, durationMs) };
  }
}
