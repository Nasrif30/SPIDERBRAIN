import { createServer, request, type ServerResponse } from 'node:http';
import { randomBytes } from 'node:crypto';
import type { Sensor } from '@spiderbrain/sensor';
import { page, css, script } from '@spiderbrain/live-web';
import type { LocalCollector } from './collector.js';
import { incidentsPanel, incidentDialog, incidentCss, incidentScript } from './incident-ui.js';
import { presentationPanel, resetDialog, polishCss, polishScript } from './polish.js';
const panel = '<dialog id="session-autopsy"><div class="autopsy-head"><h2>Session evidence</h2><button id="close-autopsy" aria-label="Close session evidence">×</button></div><div id="autopsy-body"></div><small>Heuristic behavior only. Confidence is not attack probability. Last 64 retained application requests.</small></dialog>';
const extraCss = '.session-panel li button{display:block;text-align:left;background:none;border:0;padding:0;color:inherit;font:inherit;cursor:pointer;width:100%}.session-panel li button:hover{text-decoration:underline}#session-autopsy{width:min(92vw,900px);max-height:85vh;border:1px solid #ccd4d0;border-radius:5px;padding:24px;color:#192b23;background:#fcfcfb}#session-autopsy::backdrop{background:#16261f66}.autopsy-head{display:flex;justify-content:space-between;align-items:center}.autopsy-head h2{font:24px Georgia,serif;margin:0}.autopsy-head button{border:0;background:none;font-size:24px;cursor:pointer}.autopsy-table{width:100%;border-collapse:collapse;font:11px ui-monospace,monospace}.autopsy-table td,.autopsy-table th{border-top:1px solid #dde3df;padding:9px;text-align:left}.autopsy-table-wrap{overflow:auto}.autopsy-summary{font:12px/1.8 ui-monospace,monospace;overflow-wrap:anywhere}#session-autopsy small{display:block;color:#6b7b8c;line-height:1.6;margin-top:16px}';
const extraScript = String.raw`
let activeSession=null,inspectionBusy=false,inspectionAt=0;
const dialog=document.getElementById('session-autopsy'),body=document.getElementById('autopsy-body');
async function showSession(){if(!activeSession||inspectionBusy)return;inspectionBusy=true;inspectionAt=Date.now();try{const response=await fetch('/web/session/'+encodeURIComponent(activeSession));if(!response.ok)throw new Error('Expired');const value=await response.json();if(value.session.id!==activeSession)return;body.replaceChildren();const summary=document.createElement('p');summary.className='autopsy-summary';summary.textContent=value.session.id+' · '+value.session.state+' · risk '+(value.session.decision?.risk??0)+' · confidence '+Math.round((value.session.decision?.confidence??0)*100)+'% · energy '+value.session.energy.toFixed(1)+' · '+value.session.requests+' requests';body.append(summary);const routes=document.createElement('p');routes.className='autopsy-summary';routes.textContent=value.requests.map(row=>row.currentRoute).join(' → ');body.append(routes);const wrap=document.createElement('div'),table=document.createElement('table'),head=document.createElement('tr');wrap.className='autopsy-table-wrap';table.className='autopsy-table';for(const label of ['Time','Route / events','Risk','Confidence','State','Contributions']){const th=document.createElement('th');th.textContent=label;head.append(th);}table.append(head);for(const row of value.requests){const tr=document.createElement('tr'),d=row.vibration.decision;for(const text of [new Date(row.timestamp).toLocaleTimeString(),row.currentRoute+' · '+row.events.filter(e=>e.type.startsWith('AUTH_')||e.type==='LAB_RESOURCE_ACCESS').map(e=>e.type).join(', '),d.risk.toFixed(1),Math.round(d.confidence*100)+'%',d.state,d.contributions.map(c=>c.eye+' +'+c.value.toFixed(1)).join('; ')]){const td=document.createElement('td');td.textContent=text;tr.append(td);}table.append(tr);}wrap.append(table);body.append(wrap);}catch{body.textContent='Session evidence unavailable or expired.';}finally{inspectionBusy=false;}}
document.getElementById('close-autopsy').addEventListener('click',()=>{activeSession=null;dialog.close();});dialog.addEventListener('close',()=>activeSession=null);
stream.addEventListener('web',()=>{if(!latest)return;const rows=[...document.querySelectorAll('#sessions li')];latest.sessions.forEach((session,index)=>{const li=rows[index];if(!li)return;const button=document.createElement('button');button.type='button';button.setAttribute('aria-label','Inspect session '+session.id);while(li.firstChild)button.append(li.firstChild);button.addEventListener('click',()=>{openSessionReport(session.id);});li.append(button);});if(activeSession&&Date.now()-inspectionAt>=1000)showSession();});
`;
/** The existing SSE endpoint remains the authoritative visualization channel. */
export function dashboard(sensor: Sensor, collector: LocalCollector, internalUrl: string, _demoUrl: () => string) {
  let port = 0;
  const controlToken = randomBytes(32).toString('hex');
  const send = (res: ServerResponse, content: string, type: string, status = 200) => { res.writeHead(status, { 'Content-Type': type, 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'no-referrer', 'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'" }); res.end(content); };
  const server = createServer((req, res) => {
    const host = `127.0.0.1:${port}`;
    const url = new URL(req.url ?? '/', `http://${host}`);
    const reset = req.method === 'POST' && url.pathname === '/web/reset';
    if (req.headers.host !== host || (!reset && req.method !== 'GET') || req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== `http://${host}`) || (reset && (req.headers.origin !== `http://${host}` || req.headers['x-spiderbrain-control'] !== controlToken || req.headers['content-type'] !== 'application/json'))) { send(res, '{"error":"Local dashboard access only"}', 'application/json', 403); return; }
    if (reset) { req.resume(); const ok = collector.resetObservation(); send(res, JSON.stringify({ reset: ok }), 'application/json', ok ? 200 : 503); return; }
    if (url.pathname === '/web/control-token') { send(res, JSON.stringify({ token: controlToken }), 'application/json'); return; }
    if (url.pathname === '/web/significant') { send(res, JSON.stringify({ incident: collector.lastSignificant() }), 'application/json'); return; }
    if (url.pathname === '/') { res.writeHead(302, { Location: '/web' }); res.end(); return; }
    if (url.pathname === '/web') { send(res, page.replace('<section class="metrics"', presentationPanel + '<section class="metrics"').replace('</aside>', incidentsPanel + '</aside>').replace('</main>', panel + incidentDialog + resetDialog + '</main>'), 'text/html; charset=utf-8'); return; }
    if (url.pathname === '/web.css') { send(res, css + extraCss + incidentCss + polishCss, 'text/css; charset=utf-8'); return; }
    if (url.pathname === '/web.js') { send(res, script + extraScript + incidentScript + polishScript, 'text/javascript; charset=utf-8'); return; }
    if (url.pathname === '/web/incidents') { send(res, JSON.stringify({ incidents: collector.incidents.recent(url.searchParams.get('route') ?? undefined, url.searchParams.get('session') ?? undefined), limits: { maxReports: 128, retentionMs: 900_000 } }), 'application/json'); return; }
    if (/^\/web\/incidents\/SB-IR-[a-f0-9-]{36}(?:\/export)?$/.test(url.pathname)) {
      const id = url.pathname.split('/')[3]!, report = collector.incidents.get(id) ?? (collector.lastSignificant()?.id === id ? collector.lastSignificant()! : undefined);
      if (report && url.pathname.endsWith('/export')) res.setHeader('Content-Disposition', `attachment; filename="spiderbrain-incident-${id}-${new Date(report.timestamp).toISOString().slice(0, 10)}.json"`);
      send(res, JSON.stringify(report ?? { error: 'Report expired' }), 'application/json', report ? 200 : 404); return;
    }
    if (url.pathname === '/web/route-report') { send(res, JSON.stringify(collector.routeEvidence(url.searchParams.get('route') ?? '/')), 'application/json'); return; }
    if (url.pathname === '/web/collector') { send(res, JSON.stringify(collector.counters()), 'application/json'); return; }
    if (/^\/web\/session\/SB-[a-f0-9]{24}$/.test(url.pathname)) {
      const id = url.pathname.slice('/web/session/'.length), view = sensor.inspect(id);
      send(res, JSON.stringify(view ? { ...view, requests: collector.session(id) } : { error: 'Session expired' }), 'application/json', view ? 200 : 404); return;
    }
    if (!['/web/events', '/web/snapshot'].includes(url.pathname)) { send(res, '{"error":"Not found"}', 'application/json', 404); return; }
    const upstream = request(new URL(url.pathname, internalUrl), { method: 'GET' }, incoming => {
      res.writeHead(incoming.statusCode ?? 503, { 'Content-Type': incoming.headers['content-type'] ?? 'application/json', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' }); incoming.pipe(res);
    });
    upstream.on('error', () => { if (!res.headersSent) send(res, '{"error":"Telemetry unavailable"}', 'application/json', 503); else res.destroy(); });
    res.on('close', () => upstream.destroy()); upstream.end();
  });
  server.requestTimeout = 5000; server.headersTimeout = 5000; server.maxConnections = 16;
  return { server, setPort: (value: number) => { port = value; } };
}
