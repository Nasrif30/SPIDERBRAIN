import express, { type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spiderbrain, noteAuthentication } from '@spiderbrain/express';
import type { LocalCollector } from './collector.js';
import { labResources, products, type DemoAccount, type SiteState } from '../shared/catalog.js';
import { demoAccess, transportHints } from './access.js';
import { detectPayload } from './payload.js';
interface LoginSession { account: DemoAccount; lastSeen: number; preferences: SiteState['preferences'] }
const accounts = new Set<DemoAccount>(['demo', 'visitor', 'analyst']);
export function site(collector: LocalCollector, directory: string, allowedHost: () => string, dashboardUrl: () => string, remoteDemo = false) {
  const app = express(), sessions = new Map<string, LoginSession>();
  const html = readFileSync(resolve(directory, 'dist/client/index.html'), 'utf8');
  app.disable('x-powered-by');
  app.use((req, res, next) => {
    const access = demoAccess(req.headers, req.method, allowedHost(), remoteDemo);
    if (!access.allowed) { res.status(403).send('Local demo access only'); return; }
    res.locals['publicDemoHost'] = access.publicHost;
    res.set({ 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'" });
    next();
  });
  // Build artifacts are delivered before the application observer. They are not
  // navigation and cannot interrupt the page-to-page route graph.
  app.use('/assets', express.static(resolve(directory, 'dist/client/assets'), { dotfiles: 'deny', index: false, redirect: false, maxAge: '1h' }));
  app.get('/favicon.svg', (_req, res) => res.type('image/svg+xml').send('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="8" fill="#183c30"/><path d="M8 16h16M16 8v16M10 10l12 12M10 22l12-12" stroke="#f4f2e9" stroke-width="2"/><circle cx="16" cy="16" r="4" fill="#f4f2e9"/></svg>'));
  app.use((req, res, next) => {
    const hints = transportHints(req.headers);
    spiderbrain({ observe: metadata => collector.observe({ ...metadata, payload: detectPayload(req.originalUrl, req.body as unknown) }, hints) })(req, res, next);
  });
  app.use(express.json({ limit: '2kb' }));
  app.use(express.urlencoded({ extended: false, limit: '2kb' }));
  const session = (cookie: string | undefined): LoginSession | undefined => {
    const now = Date.now(); for (const [id, value] of sessions) if (now - value.lastSeen > 900_000) sessions.delete(id);
    const id = /(?:^|;\s*)sb_demo=([a-f0-9-]{36})(?:;|$)/.exec(cookie ?? '')?.[1];
    const value = id ? sessions.get(id) : undefined; if (value) value.lastSeen = now; return value;
  };
  const state = (cookie: string | undefined): SiteState => { const value = session(cookie); return { account: value?.account ?? null, preferences: value?.preferences ?? { digest: false, workspace: 'personal' } }; };
  const page = (res: Response, value: SiteState, status = 200) => {
    const boot = JSON.stringify({ ...value, dashboardUrl: dashboardUrl() }).replaceAll('<', '\\u003c');
    res.status(status).type('html').send(html.replace('<div id="root"></div>', `<script type="application/json" id="site-state">${boot}</script><div id="root"></div>`));
  };
  const authenticate: express.RequestHandler = (req, res) => {
    const body: unknown = req.body;
    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    const account = typeof input.username === 'string' && accounts.has(input.username as DemoAccount) ? input.username as DemoAccount : undefined;
    // Only fixed fictional accounts; the submitted password is compared here,
    // never forwarded to the collector, sensor, logs, cookies or memory.
    const success = !!account && input.password === 'lab-only';
    noteAuthentication(res, { type: success ? 'login_success' : 'login_failure', ...(account ? { identityKey: 'fixed-demo-account:' + account } : {}) });
    if (!success) { res.status(401).json({ ok: false, message: 'Use demo, visitor or analyst with the fictional password lab-only.' }); return; }
    if (sessions.size >= 128) sessions.delete(sessions.keys().next().value!);
    const id = randomUUID(); sessions.set(id, { account, lastSeen: Date.now(), preferences: { digest: false, workspace: 'personal' } });
    res.cookie('sb_demo', id, { httpOnly: true, sameSite: 'strict', secure: res.locals['publicDemoHost'] === true, maxAge: 900_000, path: '/' });
    res.json({ ok: true, message: 'Demo workspace ready.' });
  };
  app.post('/login', authenticate); app.post('/register', authenticate);
  app.post('/logout', (req, res) => {
    const id = /(?:^|;\s*)sb_demo=([a-f0-9-]{36})(?:;|$)/.exec(req.headers.cookie ?? '')?.[1]; if (id) sessions.delete(id);
    noteAuthentication(res, { type: 'logout' }); res.clearCookie('sb_demo', { path: '/' }); res.json({ ok: true });
  });
  app.post('/contact', (_req, res) => res.json({ ok: true, message: 'Demo message received. Nothing is sent or stored.' }));
  app.post('/settings', (req, res) => {
    const value = session(req.headers.cookie); if (!value) { noteAuthentication(res, { type: 'protected_route_denial' }); res.status(403).json({ ok: false, message: 'Sign in to a demo account first.' }); return; }
    const body: unknown = req.body, input = body && typeof body === 'object' ? body as Record<string, unknown> : {};
    value.preferences = { digest: input.digest === true, workspace: input.workspace === 'team' ? 'team' : 'personal' };
    res.json({ ok: true, message: 'Preferences saved for this temporary demo session.' });
  });
  for (const path of ['/', '/products', '/search', '/login', '/register', '/about', '/contact']) app.get(path, (req, res) => page(res, state(req.headers.cookie)));
  app.get('/products/:id', (req, res) => page(res, state(req.headers.cookie), products.some(product => product.id === req.params.id) ? 200 : 404));
  for (const path of ['/account', '/profile', '/settings']) app.get(path, (req, res) => {
    const value = state(req.headers.cookie); if (!value.account) noteAuthentication(res, { type: 'protected_route_denial' }); page(res, value, value.account ? 200 : 403);
  });
  for (const [path, resource] of Object.entries(labResources)) app.get(path, (req, res) => page(res, state(req.headers.cookie), resource.status));
  app.use((req, res) => { if (req.method === 'GET' || req.method === 'HEAD') page(res, state(req.headers.cookie), 404); else res.status(404).json({ ok: false, message: 'Demo route not found.' }); });
  app.use((_error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => { if (!res.headersSent) res.status(400).json({ ok: false, message: 'Invalid demo request.' }); });
  return app;
}
