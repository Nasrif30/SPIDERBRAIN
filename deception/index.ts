import { randomBytes } from 'node:crypto';
import type { CanaryEntry, CanaryManifest, HoneyObservation } from '@spiderbrain/shared';
export type { CanaryEntry, CanaryManifest } from '@spiderbrain/shared';
const resources = [
  { route: '/admin-old', type: 'route', sensitivity: 'medium' },
  { route: '/internal-dev', type: 'route', sensitivity: 'medium' },
  { route: '/backup-console', type: 'route', sensitivity: 'medium' },
  { route: '/debug-old', type: 'route', sensitivity: 'medium' },
  { route: '/.env.backup', type: 'file', sensitivity: 'high' },
  { route: '/config.old', type: 'file', sensitivity: 'high' },
  { route: '/backup.sql', type: 'file', sensitivity: 'high' },
  { route: '/deployment-notes.txt', type: 'file', sensitivity: 'medium' },
] as const;
const idPattern = /^SB-CANARY-[A-F0-9]{6,32}$/;
/** Only the shipped catalog and fixed templates are capabilities. No user content or executable hooks. */
export class DeceptionBoundary {
  validate(input: unknown): CanaryEntry {
    if (!input || typeof input !== 'object' || Object.getPrototypeOf(input) !== Object.prototype) throw new Error('REJECT: synthetic manifest entry required');
    const properties = Object.getOwnPropertyDescriptors(input);
    const keys = ['id', 'type', 'route', 'sensitivity', 'enabled'];
    if (Reflect.ownKeys(input).length !== keys.length || keys.some((key) => !properties[key] || !('value' in properties[key]!))) throw new Error('REJECT: data fields only');
    const value = Object.fromEntries(keys.map((key) => [key, properties[key]!.value])) as Record<string, unknown>;
    const catalog = resources.find((entry) => entry.route === value['route']);
    if (!catalog || value['type'] !== catalog.type || value['sensitivity'] !== catalog.sensitivity ||
      typeof value['enabled'] !== 'boolean' || typeof value['id'] !== 'string' || !idPattern.test(value['id'])) throw new Error('REJECT: resource outside synthetic catalog');
    return { id: value['id'], type: catalog.type, route: catalog.route, sensitivity: catalog.sensitivity, enabled: value['enabled'] };
  }
  response(input: unknown): { body: string; contentType: string } {
    const entry = this.validate(input);
    if (!entry.enabled) throw new Error('REJECT: canary disabled');
    if (entry.type === 'route') return { contentType: 'application/json; charset=utf-8', body: JSON.stringify({ synthetic: true, service: 'archived-console', canary: entry.id, resource: entry.route }) };
    if (entry.route === '/backup.sql') return { contentType: 'text/plain; charset=utf-8', body: '-- Synthetic SpiderBrain sample; no customer data\nCREATE TABLE demo_notes (note TEXT);\nINSERT INTO demo_notes VALUES (\'' + entry.id + '\');\n' };
    if (entry.route === '/deployment-notes.txt') return { contentType: 'text/plain; charset=utf-8', body: 'Synthetic deployment notes\nService: demo-backup.invalid\nReference: ' + entry.id + '\n' };
    return { contentType: 'text/plain; charset=utf-8', body: '# Synthetic SpiderBrain canary; no live credentials\nDB_HOST=synthetic-db.invalid\nDB_USER=synthetic_backup\nDB_PASSWORD=' + entry.id + '\n' };
  }
}
export function createCanaryManifest(): CanaryManifest {
  return resources.map((entry) => ({ ...entry, id: 'SB-CANARY-' + randomBytes(8).toString('hex').toUpperCase(), enabled: true }));
}
export interface CanaryOptions { enabled: true; manifest?: CanaryManifest }
export class CanaryEngine {
  private activeCount = 0;
  private readonly byRoute = new Map<string, Readonly<CanaryEntry>>();
  private readonly byId = new Map<string, Readonly<CanaryEntry>>();
  private readonly responses = new Map<string, ReturnType<DeceptionBoundary['response']>>();
  private readonly boundary = new DeceptionBoundary();
  constructor(options: false | CanaryOptions = false) {
    if (options === false) return;
    if (options.enabled !== true || Object.keys(options).some((key) => !['enabled', 'manifest'].includes(key))) throw new Error('REJECT: explicit canary opt-in required');
    const manifest = options.manifest ?? createCanaryManifest();
    if (!Array.isArray(manifest) || manifest.length > resources.length) throw new Error('REJECT: bounded manifest required');
    for (const raw of manifest) {
      const entry = this.boundary.validate(raw);
      if (this.byRoute.has(entry.route) || this.byId.has(entry.id)) throw new Error('REJECT: duplicate canary');
      // Disabled entries also reserve their route and identifier during validation.
      this.byRoute.set(entry.route, Object.freeze(entry)); this.byId.set(entry.id, Object.freeze(entry));
      if (entry.enabled) { this.activeCount++; this.responses.set(entry.route,Object.freeze(this.boundary.response(entry))); }
    }
  }
  get manifest(): CanaryEntry[] { return [...this.byRoute.values()].filter((entry) => entry.enabled).map((entry) => ({ ...entry })); }
  get count(): number { return this.activeCount; }
  private path(raw: string): string | undefined {
    if (typeof raw !== 'string' || raw.length > 2048 || !raw.startsWith('/') || raw.startsWith('//') || /[%\\#\u0000-\u0020]/.test(raw)) return undefined;
    const path = raw.split('?', 1)[0]!;
    if (path.split('/').some((part) => part === '.' || part === '..')) return undefined;
    return path;
  }
  response(rawPath: string, method: string) {
    if (method !== 'GET' && method !== 'HEAD') return undefined;
    const path = this.path(rawPath), entry = path ? this.byRoute.get(path) : undefined;
    if (!entry?.enabled) return undefined;
    return { ...this.responses.get(entry.route)!, honey: { canaryId: entry.id, resource: entry.route,
      interaction: entry.type === 'file' ? 'file_touch' : 'route_touch' } as HoneyObservation };
  }
  /** Accept only server-marked catalog touches and exact references to our own synthetic IDs. */
  interactions(rawPath: string, reported: readonly HoneyObservation[] | undefined): HoneyObservation[] {
    const path = this.path(rawPath);
    if (!path || !this.count) return [];
    const result: HoneyObservation[] = [];
    for (const item of Array.isArray(reported) ? reported.slice(0, 2) : []) {
      const entry = this.byId.get(item.canaryId);
      if (entry?.enabled && item.resource === entry.route && path === entry.route && item.interaction === (entry.type === 'file' ? 'file_touch' : 'route_touch')) {
        result.push({ canaryId: entry.id, resource: entry.route, interaction: item.interaction });
      }
    }
    const queryAt = rawPath.indexOf('?');
    if (queryAt >= 0) {
      const query = new URLSearchParams(rawPath.slice(queryAt + 1));
      const references = query.getAll('canary');
      if (references.length === 1) {
        const entry = this.byId.get(references[0]!);
        if (entry?.enabled) result.push({ canaryId: entry.id, resource: entry.route, interaction: 'token_reference' });
      }
    }
    return result;
  }
}
