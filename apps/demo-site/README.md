# SpiderBrain Labs — local integrated website

A separate npm workspace in the existing repository. React + Vite render a fictional tool studio. Express owns page navigation and application POSTs. It reuses the existing observer, redactor, Sensor, seven Eyes, Synganglion, graph, SILK, SQLite and SSE renderer.

From the repository root:

```sh
npm install
npm run dev
npm test
npm run typecheck
npm run build
```

Or run the same commands inside this folder (after the repository dependencies are installed). `dev` builds once and watches compiled server files; after source edits run `npm run build` in another terminal. There is no frontend HMR service. `npm start` inside this folder runs the completed build. Ctrl+C stops the application and dashboard.


| Component | Local address |
|---|---|
| Website and application API | http://127.0.0.1:4173 |
| Integrated Live Web and session inspection | http://127.0.0.1:5173/web |
| Collector | In-process adapter; no injection endpoint |
| Existing SSE publisher | Private ephemeral loopback listener, bridged to this dashboard |

Application responses pass through the existing Express observer. The adapter redacts first, validates a strict typed schema, rejects malformed/extra fields, deduplicates request IDs and passes sanitized metadata into the existing Sensor. Runtime events drive the graph, evidence and vibrations. Full-page links and GET search forms make real HTTP requests; product filters change local presentation only. Built CSS/JS and favicon are served before the application observer so asset downloads cannot interrupt navigation edges. This intentionally measures application requests, not static-asset requests or aborted responses.

Pages: `/`, `/products`, `/products/:id`, `/search`, `/login`, `/register`, `/account`, `/profile`, `/settings`, `/about`, `/contact`. Product IDs, search values and unknown path segments are redacted in telemetry. Fixed fictional accounts: `demo`, `visitor`, `analyst`; password: `lab-only`. Register opens a supplied fictional account rather than storing a new identity. Login outcomes yield safe `AUTH_ATTEMPT`, `AUTH_SUCCESS` or `AUTH_FAILURE` projections after completion. The submitted password never reaches SpiderBrain. Authentication cookies are random, HttpOnly/SameSite Strict; the collector never receives cookies. Preferences and logins are temporary and reset on restart.

Lab specimens: `/admin-demo`, `/admin-old-demo`, `/.env-demo`, `/.git-demo`, `/backup-demo`, `/config-demo`, `/internal-demo`, `/debug-demo`. Their contents are literal fictional strings. Restricted/archive specimens deliberately return 403/404, allowing the existing Route/Error Eyes to observe failed access. They emit `LAB_RESOURCE_ACCESS`; they are not added to the guarded canary catalog and do not manufacture Honey evidence. A single visit does not prove hostility.

Select an active session in Live Web to inspect its last 64 application requests: route sequence, authentication/lab events, risk, confidence, classification and contributions. Dashboard updates use the existing bounded SSE channel; no synthetic timer-generated request traffic. Confidence remains heuristic evidence strength, never attack probability.

The integrated dashboard adds a compact Recent incidents panel. Select a route node or a session with retained incidents to open SPIDERBRAIN INCIDENT REPORT, including evidence, contributions, HTTP behavior, timeline, classification progression and defensive recommendations. EXPORT JSON downloads sanitized metadata from the local dashboard. Sessions without a supported incident retain their existing evidence view; route visits alone produce no attack assessment.

Payload Anomaly Eye accepts only four structure flags (SQL-like, script-like, traversal, shell-like), never raw inputs. The demo examines at most a small bounded set of explicit query/body fields and the URL path; passwords, tokens, private contact/profile contents and headers are excluded. Supported labels require accumulated behavior, and use Possible/Suspected wording. Existing per-Eye caps, decay, evidence diversity and state inertia apply; payload evidence alone cannot become HOSTILE. Reports coalesce repeated session/route/category evidence, retain at most 128 reports for 15 minutes, and include at most 32 timeline entries. They are temporary, read-only projections; no enforcement or exploit execution was added.

`logs/web-memory.sqlite` stores existing sanitized Web Memory. `logs/traffic.jsonl` stores safe runtime records, rotating to one previous file at 5 MiB. Logs queue 512 records and write 64 per asynchronous batch, with observable drops. Collector deduplication keeps 2,048 IDs for up to 15 minutes; timeline history keeps 64 requests for 128 cohorts. Request IDs and sensor event IDs are linked explicitly. Anonymous IDs derive from rotating HMACs of the local connection cohort; browsers sharing loopback may share one behavioral cohort, independently of their demo login cookie. No attacker identity is inferred.

Manual acceptance: keep Live Web open, browse `/ → /products → /login → /admin-demo → /.env-demo`, then select the session. Submit fictional failed logins and inspect Authentication Eye. For a deliberate burst that reaches Velocity Eye, run:

```sh
npm run traffic
```

This explicitly issues 40 real requests to fixed owned routes at `127.0.0.1:4173`, writes safe `logs/acceptance-traffic.json`, and exits. It has no URL/target argument, remote controls or background traffic. Ordinary browsing can remain quiet; thresholds were not lowered for this website.

All listeners remain bound to `127.0.0.1`. By default (`SPIDERBRAIN_REMOTE_DEMO` unset or `0`), the website accepts only loopback Host names (`127.0.0.1`, `localhost`, `[::1]`) on its configured port. Host/Origin checks reject rebinding and cross-site mutation. Website responses continue when sensing fails or the dashboard cannot bind. See the [security model](../../README.md#security-model) for known limits.

Optional remote demo mode is read once at server startup. Only the exact value `1` permits valid public DNS Host names on the demo website. This supports changing Quick Tunnel hostnames without treating proxy headers as authentication. Same-host HTTPS Origin checks and cross-site form/subresource restrictions remain active; cross-site top-level GET navigation is allowed. Public-host demo login cookies use Secure in addition to HttpOnly/SameSite Strict.

```powershell
cd SPIDERBRAIN
$env:SPIDERBRAIN_REMOTE_DEMO="1"
npm run dev
```

In a separate PowerShell window, when starting a tunnel is needed:

```powershell
cloudflared tunnel --url http://127.0.0.1:4173
```

Reuse an already-running tunnel instead of starting another. The dashboard at `127.0.0.1:5173/web` and its session/collector endpoints keep their original local-only guards; the internal SSE listener is unchanged. The website does not proxy dashboard, database, filesystem or internal administration endpoints. Remote demo mode adds no remote-control functionality.

All accepted application requests still pass through the same Express observer, collector, Sensor and behavior engine. Stored transport hints are coarse `cloudflarePresent`, `forwardedAddressClass` and `userAgentClass` values. Header presence is unverified: raw proxy addresses, user-agent strings and Cloudflare header values are not stored or used to authenticate users. Existing connection-based anonymous session grouping is preserved, so visitors behind the tunnel can share a behavioral cohort.

To return to local-only mode, stop the server, then restart with:

```powershell
$env:SPIDERBRAIN_REMOTE_DEMO="0"
npm run dev
```
