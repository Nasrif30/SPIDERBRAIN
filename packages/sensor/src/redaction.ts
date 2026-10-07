import { randomUUID } from 'node:crypto';
import type { Observation, AuthenticationType, AuthenticationObservation, HoneyObservation } from '@spiderbrain/shared';
import { payloadPatterns, type PayloadPattern } from '@spiderbrain/shared';
export interface AuthenticationMetadata {
  type: AuthenticationType;
  /** Opaque application identity reference; immediately HMACed, never retained raw. */
  identityKey?: string;
  authenticated?: boolean;
}
export interface RequestMetadata {
  /** Only used in memory to derive an anonymous ID; never included in an event. */
  clientKey: string;
  path: string;
  /** Trusted, application-owned Express route template, including router mount. */
  routeTemplate?: string;
  method: string;
  status: number;
  latency: number;
  authentication?: AuthenticationMetadata;
  /** Server-marked synthetic response metadata; validated against the active manifest. */
  honey?: readonly HoneyObservation[];
  payload?: readonly PayloadPattern[];
}
// A finite vocabulary prevents arbitrary path contents from reaching storage.
// Applications can explicitly add public literal segments through publicRoutes.
const vocabulary = new Set(['', '.', '..', 'home', 'about', 'contact', 'products', 'product', 'search', 'static', 'assets', 'favicon.ico', 'robots.txt', 'sitemap.xml', 'login', 'logout', 'auth', 'register', 'reset', 'password', 'account', 'user', 'users', 'api', 'v1', 'v2', 'health', 'admin', 'admin-old', 'admin.php', 'wp-admin', 'wp-login.php', 'upload', 'uploads', 'internal', 'dev-console', 'backup', 'backups', 'config', 'config.old', '.git', 'head', '.env', '.env.backup', 'index.php', 'internal-dev', 'backup-console', 'debug-old', 'backup.sql', 'deployment-notes.txt']);
export class Redactor {
  private readonly publicSegments: Set<string>;
  constructor(publicRoutes: readonly string[] = []) {
    if (publicRoutes.length > 256) throw new Error('Too many public routes');
    this.publicSegments = new Set(vocabulary);
    for (const route of publicRoutes) {
      for (const segment of route.split('/')) {
        if (/^[a-zA-Z0-9._-]{1,64}$/.test(segment)) this.publicSegments.add(segment.toLowerCase());
      }
    }
  }
  route(path: string): string {
    const pathname = String(path).slice(0, 2048).split(/[?#]/, 1)[0] ?? '/';
    const raw = pathname.startsWith('/') ? pathname : '/';
    const parts = raw.split('/').slice(1, 13);
    let redactNext = false;
    const segments = parts.map((part) => {
      let segment: string;
      try { segment = decodeURIComponent(part).toLowerCase(); } catch { return ':redacted'; }
      if (redactNext) { redactNext = false; return ':redacted'; }
      if (/^(password|token|secret|key|authorization|session|cookie|email)$/.test(segment)) {
        redactNext = true;
        return ':redacted';
      }
      return this.publicSegments.has(segment) ? segment : ':redacted';
    });
    return '/' + segments.join('/');
  }
  authentication(raw: AuthenticationMetadata | undefined, identityId?: string): AuthenticationObservation | undefined {
    if (!raw || !['login_success', 'login_failure', 'protected_route_denial', 'logout', 'auth_transition'].includes(raw.type)) return undefined;
    const authenticated = typeof raw.authenticated === 'boolean' ? raw.authenticated :
      raw.type === 'login_success' ? true : raw.type === 'logout' ? false : undefined;
    if (raw.type === 'auth_transition' && authenticated === undefined) return undefined;
    return { type: raw.type, ...(identityId ? { identityId } : {}), ...(authenticated !== undefined ? { authenticated } : {}) };
  }
  observation(raw: RequestMetadata, sessionId: string, timestamp: number, identityId?: string): Observation {
    const method = /^(GET|HEAD|POST|PUT|PATCH|DELETE|OPTIONS|CONNECT|TRACE)$/.test(raw.method) ? raw.method : 'OTHER';
    const authentication = this.authentication(raw.authentication, identityId);
    const payload = Array.isArray(raw.payload) ? [...new Set(raw.payload.filter((value): value is PayloadPattern => payloadPatterns.includes(value as PayloadPattern)))].slice(0, 4) : [];
    return {
      schemaVersion: 1, id: randomUUID(), sessionId,
      route: this.route(raw.routeTemplate ?? raw.path), method, timestamp,
      status: Number.isInteger(raw.status) && raw.status >= 100 && raw.status <= 599 ? raw.status : 500,
      latency: Number.isFinite(raw.latency) ? Math.max(0, Math.min(raw.latency, 3_600_000)) : 0,
      ...(authentication ? { authentication } : {}),
      ...(payload.length ? { payload } : {}),
    };
  }
}
