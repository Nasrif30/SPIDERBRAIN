#!/usr/bin/env node
import { DatabaseSync } from 'node:sqlite';
import { startDashboard } from './start.js';
import { startMonitor } from '../sdk/proxy.js';
import { openBrowser } from './open.js';
import { terminalBanner, attribution } from './guardian/banner.js';

const version = '0.1.1';
const args = process.argv.slice(2), command = args[0] ?? '--help';
const help = `SPIDERBRAIN ${version} — Feel the web.

spiderbrain start [--open]
spiderbrain monitor <http://localhost:3000> [--open] [--open-site]
spiderbrain status [--url http://127.0.0.1:5173]
spiderbrain doctor
spiderbrain --version | --help

Options: --port <dashboard/gateway port> --dashboard-port <port>
         --allow-remote (explicit authorization for a remote target)
Legacy research tools: init, watch, web, inspect, memory, sense

Only monitor websites and applications you own or are authorized to test.
Start opens the dashboard only. Monitor observes the supplied target.
Traffic must pass through the local gateway or an integrated sensor.`;
function port(flag: string, fallback: number): number {
  const index = args.indexOf(flag);
  if (index < 0) return fallback;
  const value = args[index + 1];
  if (!value || !/^\d+$/.test(value) || Number(value) > 65535) throw new Error('Invalid port option');
  return Number(value);
}
async function main() {
  if (['--help', 'help', '-h'].includes(command)) { console.log(help); return; }
  if (['--version', '-v'].includes(command)) { console.log(version); return; }
  if (command === 'doctor') {
    const db = new DatabaseSync(':memory:'); db.exec('SELECT 1'); db.close();
    console.log(`SPIDERBRAIN ${version}\nNode ${process.versions.node}\nSQLite: available\nLoopback defaults: enabled\nPublic startup: dashboard only\nNo target discovery or port scanning performed.`); return;
  }
  if (command === 'status') {
    const at = args.indexOf('--url'), url = new URL(at >= 0 ? args[at + 1]! : 'http://127.0.0.1:5173');
    if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || url.username || url.password || url.pathname !== '/' || url.search || url.hash) throw new Error('Use a loopback dashboard origin');
    const response = await fetch(url.origin + '/web/snapshot', { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error('Dashboard unavailable');
    const result = await response.json() as { status: unknown }; console.log(JSON.stringify(result.status, null, 2)); return;
  }
  if (!['start', 'monitor'].includes(command)) {
    if (['init', 'watch', 'web', 'inspect', 'memory', 'sense'].includes(command)) { await import('./guardian/index.js'); return; }
    throw new Error('Unknown command. Use spiderbrain --help');
  }
  const known = new Set(['--open', '--open-site', '--allow-remote', '--port', '--dashboard-port']);
  for (let i = command === 'monitor' ? 2 : 1; i < args.length; i++) {
    if (!known.has(args[i]!)) throw new Error('Unknown startup option');
    if (['--port', '--dashboard-port'].includes(args[i]!)) i++;
  }
  let app: { siteUrl?: string; dashboardUrl: string | null; close(): Promise<void> } | undefined;
  let stopping = false;
  const stop = async () => { if (stopping) return; stopping = true; if (app) { await app.close(); process.exit(0); } };
  process.once('SIGINT', () => { void stop(); }); process.once('SIGTERM', () => { void stop(); });
  if (command === 'monitor') {
    if (!args[1] || args[1].startsWith('--')) throw new Error('monitor requires a target URL');
    app = await startMonitor(args[1], { gatewayPort: port('--port', 8787), dashboardPort: port('--dashboard-port', 5173), allowRemote: args.includes('--allow-remote') });
  } else {
    app = await startDashboard({ dashboardPort: port('--dashboard-port', port('--port', 5173)) });
  }
  if (stopping) { await app.close(); process.exit(0); }
  console.log(terminalBanner());
  console.log(attribution);
  const targetInfo = command === 'monitor' ? `Target\n${new URL(args[1]!).href}\n\nMonitoring Gateway\n${app.siteUrl}\n\n` : '';
  console.log(`SPIDERBRAIN ONLINE\nFeel the web.\n\n${targetInfo}Dashboard\n${app.dashboardUrl ?? 'unavailable; application monitoring continues'}\n\nSynGanglion       ONLINE\nSensor            ONLINE\nIncident Engine   ONLINE\n\nOnly monitor websites and applications you own or are authorized to test.\nAll listeners use 127.0.0.1. Press Ctrl+C to stop.`);
  if (args.includes('--open') || args.includes('--open-site')) {
    if (app.dashboardUrl && !await openBrowser(app.dashboardUrl)) console.log(`Open dashboard manually: ${app.dashboardUrl}`);
    if (args.includes('--open-site') && app.siteUrl && !await openBrowser(app.siteUrl)) console.log(`Open monitored site manually: ${app.siteUrl}`);
  }
}
void main().catch(error => { console.error(`[SPIDERBRAIN] ${error instanceof Error ? error.message : 'Startup unavailable'}`); process.exitCode = 1; });
