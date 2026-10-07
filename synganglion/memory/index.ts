import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { clamp, round, type Fingerprint, type SessionView, type Similarity, type VibrationEvent, type HoneyInteraction, type QueueCounters } from '@spiderbrain/shared';
export interface MemoryOptions { path: string; maxEvents?: number; maxPatterns?: number; maxHoneyInteractions?: number; retentionMs?: number; onError?: () => void }
export function fingerprint(session: SessionView): Fingerprint {
  const averageInterval = session.intervals.length ? session.intervals.reduce((a, b) => a + b, 0) / session.intervals.length : 1000;
  return { id: 'SB-PATTERN-PENDING', sessionId: session.id, timestamp: session.lastSeen,
    requests: session.requests, routes: session.routes.slice(-32), intervals: session.intervals.slice(-32),
    velocity: round(Math.min(1000, 1000 / Math.max(1, averageInterval))), entropy: round(session.entropy),
    energy: round(session.energy), resonance: session.resonance, riskProgression: session.riskProgression.slice(-32), classification: session.state,
    ...(session.behavior ? { behavior: structuredClone(session.behavior) } : {}),
    ...(session.honeySequence?.length ? { honeySequence: session.honeySequence.slice(-32), honeyInterest: (session.honeyTouches ?? 0) >= 3 ? 'HIGH' as const : 'LOW' as const } : {}) };
}
/** Similarity compares behavior, never identity. Require sufficient observations. */
export function similarity(current: Fingerprint, previous: Fingerprint): number {
  if (current.requests < 5 || previous.requests < 5) return 0;
  const left = new Set(current.routes);
  const right = new Set(previous.routes);
  const intersection = [...left].filter((route) => right.has(route)).length;
  const union = new Set([...left, ...right]).size;
  const overlap = union ? intersection / union : 0;
  const proximity = (a: number, b: number) => 1 - Math.abs(a - b) / Math.max(1, Math.abs(a), Math.abs(b));
  const transitions = (routes: string[]) => new Set(routes.slice(1).map((route, i) => `${routes[i]}>${route}`));
  const a = transitions(current.routes), b = transitions(previous.routes);
  const sequence = [...a].filter((pair) => b.has(pair)).length / Math.max(1, new Set([...a, ...b]).size);
  const risk = (pattern: Fingerprint) => pattern.riskProgression.at(-1) ?? 0;
  const basic = clamp(overlap * 0.35 + sequence * 0.2 + proximity(current.velocity, previous.velocity) * 0.15 +
    proximity(current.entropy, previous.entropy) * 0.1 + proximity(current.resonance, previous.resonance) * 0.1 +
    proximity(risk(current), risk(previous)) * 0.1);
  if (current.behavior && previous.behavior) {
    const x=current.behavior,y=previous.behavior;
    const overlapSet=(a: string[],b: string[])=>{const left=new Set(a),right=new Set(b);return [...left].filter(value=>right.has(value)).length/Math.max(1,new Set([...left,...right]).size);};
    const buckets=(values:string[])=>{const counts=new Map<string,number>();for(const value of values)counts.set(value,(counts.get(value)??0)+1/Math.max(1,values.length));return counts;};
    const a=buckets(x.timingBuckets),b=buckets(y.timingBuckets);let distance=0;for(const name of new Set([...a.keys(),...b.keys()]))distance+=Math.abs((a.get(name)??0)-(b.get(name)??0));
    const eyeNames=new Set([...Object.keys(x.eyeProfile),...Object.keys(y.eyeProfile)]);let eyeScore=0;for(const eye of eyeNames)eyeScore+=proximity(x.eyeProfile[eye as keyof typeof x.eyeProfile]??0,y.eyeProfile[eye as keyof typeof y.eyeProfile]??0);
    const profile=x.velocityProfile.reduce((sum,value,i)=>sum+Math.abs(value-(y.velocityProfile[i]??0)),0);
    return round(clamp(.25*overlapSet(x.categories,y.categories)+.2*overlapSet(x.transitionShape,y.transitionShape)+.15*(1-distance/2)+.1*(1-profile/2)+.15*(eyeNames.size?eyeScore/eyeNames.size:1)+.1*(x.honeyInterest===y.honeyInterest?1:0)+.05*proximity(Math.log1p(x.durationMs),Math.log1p(y.durationMs))));
  }
  if (!current.honeySequence?.length && !previous.honeySequence?.length) return round(basic);
  const honey = (pattern: Fingerprint) => new Set((pattern.honeySequence ?? []).map((item) => item.resource + ':' + item.interaction));
  const currentHoney = honey(current), previousHoney = honey(previous);
  const honeyOverlap = [...currentHoney].filter((item) => previousHoney.has(item)).length / Math.max(1, new Set([...currentHoney, ...previousHoney]).size);
  return round(clamp(basic * 0.8 + honeyOverlap * 0.2));
}
export class WebMemory {
  private readonly db: DatabaseSync;
  private readonly maxEvents: number;
  private readonly maxPatterns: number;
  private readonly maxHoneyInteractions: number;
  private hasHoney = false;
  private readonly retentionMs: number;
  private pending: { timestamp?: number; data?: string; sessionId?: string; route?: string; critical?: boolean; lowValue?: boolean; honey?: HoneyInteraction[]; pattern?: Fingerprint }[] = [];
  private readonly statements: Record<string, ReturnType<DatabaseSync['prepare']>>;
  private processed = 0;
  private coalesced = 0;
  private enqueued = 0;
  private maximumDepth = 0;
  private timer: NodeJS.Timeout | undefined;
  private immediate: NodeJS.Immediate | undefined;
  private available = true;
  private closed = false;
  dropped = 0;
  constructor(private readonly options: MemoryOptions) {
    this.maxEvents = options.maxEvents ?? 10_000;
    this.maxPatterns = options.maxPatterns ?? 1000;
    this.maxHoneyInteractions = options.maxHoneyInteractions ?? 10_000;
    this.retentionMs = options.retentionMs ?? 86_400_000;
    for (const n of [this.maxEvents, this.maxPatterns, this.maxHoneyInteractions, this.retentionMs]) {
      if (!Number.isSafeInteger(n) || n < 1) throw new Error('Invalid memory retention bound');
    }
    if (options.path !== ':memory:') mkdirSync(dirname(options.path), { recursive: true });
    this.db = new DatabaseSync(options.path);
    try {
      this.db.exec(`PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA busy_timeout=0;
        CREATE TABLE IF NOT EXISTS events (seq INTEGER PRIMARY KEY, timestamp INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS event_time ON events(timestamp);
        CREATE TABLE IF NOT EXISTS patterns (session_id TEXT PRIMARY KEY, pattern_id TEXT NOT NULL, timestamp INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS pattern_time ON patterns(timestamp);
        CREATE TABLE IF NOT EXISTS honey (seq INTEGER PRIMARY KEY, timestamp INTEGER NOT NULL, data TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS honey_time ON honey(timestamp);
        CREATE TABLE IF NOT EXISTS memory_meta (key TEXT PRIMARY KEY, value INTEGER NOT NULL);
        INSERT OR IGNORE INTO memory_meta(key,value) VALUES ('pattern_seq',0);`);
      this.statements = Object.fromEntries(Object.entries({
        event:'INSERT INTO events(timestamp,data) VALUES (?,?)', honey:'INSERT INTO honey(timestamp,data) VALUES (?,?)',
        pattern:`INSERT INTO patterns(session_id,pattern_id,timestamp,data) VALUES (?,?,?,?) ON CONFLICT(session_id) DO UPDATE SET timestamp=excluded.timestamp,data=excluded.data,pattern_id=patterns.pattern_id`,
        patternId:'SELECT pattern_id FROM patterns WHERE session_id=?', nextId:"UPDATE memory_meta SET value=value+1 WHERE key='pattern_seq' RETURNING value",
        expireEvents:'DELETE FROM events WHERE timestamp < ?', expirePatterns:'DELETE FROM patterns WHERE timestamp < ?', expireHoney:'DELETE FROM honey WHERE timestamp < ?',
        capEvents:'DELETE FROM events WHERE seq < COALESCE((SELECT seq FROM events ORDER BY seq DESC LIMIT 1 OFFSET ?), -1)',
        capHoney:'DELETE FROM honey WHERE seq < COALESCE((SELECT seq FROM honey ORDER BY seq DESC LIMIT 1 OFFSET ?), -1)',
        capPatterns:'DELETE FROM patterns WHERE session_id NOT IN (SELECT session_id FROM patterns ORDER BY timestamp DESC LIMIT ?)',
        readEvents:'SELECT data FROM events ORDER BY timestamp DESC,seq DESC LIMIT ?', readPatterns:'SELECT data FROM patterns ORDER BY timestamp DESC LIMIT ?', readHoney:'SELECT data FROM honey ORDER BY timestamp DESC,seq DESC LIMIT ?',
        sessionEvents:"SELECT data FROM events WHERE json_extract(data,'$.observation.sessionId')=? ORDER BY timestamp DESC,seq DESC LIMIT ?"
      }).map(([key,sql])=>[key,this.db.prepare(sql)]));
      this.hasHoney = Boolean(this.db.prepare('SELECT 1 FROM honey LIMIT 1').get());
      this.prune(Date.now());
    } catch (error) { this.db.close(); throw error; }
  }
  get online(): boolean { return this.available && !this.closed; }
  get counters(): QueueCounters { return { queued:this.pending.length,processed:this.processed,coalesced:this.coalesced,dropped:this.dropped,enqueued:this.enqueued,maximumDepth:this.maximumDepth }; }
  append(event: VibrationEvent, session?: SessionView): void {
    if (!this.online) return;
    const critical=!!event.observation.honey?.length,lowValue=!critical&&event.signals.length===0&&event.decision.state==='CALM'&&event.decision.risk<2;
    if (this.pending.length >= 256) {
      const victim=this.pending.findIndex(item=>!item.critical);
      if(victim<0&&!critical){this.dropped++;return;}
      const index=victim<0?0:victim;
      if(lowValue&&this.pending[index]?.lowValue&&this.pending[index]?.sessionId===event.observation.sessionId)this.coalesced++;
      this.pending.splice(index,1);this.dropped++;
    }
    // Serialize once while ownership is clear; later caller/subscriber mutation cannot alter stored evidence.
    const honey=event.observation.honey?.map(item=>({canaryId:item.canaryId,resource:item.resource,interaction:item.interaction,sessionId:event.observation.sessionId,timestamp:event.observation.timestamp}));
    this.pending.push({timestamp:event.observation.timestamp,data:JSON.stringify(event),sessionId:event.observation.sessionId,route:event.observation.route,critical,lowValue,...(honey?.length?{honey}:{}),...(session?{pattern:fingerprint(session)}:{})});
    this.enqueued++;this.maximumDepth=Math.max(this.maximumDepth,this.pending.length);
    // Batch writes off the response callback. No periodic work when idle.
    if (this.pending.length >= 128 && !this.immediate) {
      if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
      this.immediate = setImmediate(() => this.flush(64));
      this.immediate.unref();
    } else if (!this.timer && !this.immediate) { this.timer = setTimeout(() => this.flush(64), 250); this.timer.unref(); }
  }
  remember(session: SessionView): void {
    if (!this.online) return;
    // Close-time snapshots flush in bounded batches without discarding queued events.
    if (this.pending.length >= 256) this.flush();
    if (this.online) this.pending.push({ pattern: fingerprint(session) });
  }
  flush(limit = 256): void {
    if (this.timer) { clearTimeout(this.timer); this.timer = undefined; }
    if (this.immediate) { clearImmediate(this.immediate); this.immediate = undefined; }
    if (!this.online || !this.pending.length) return;
    const batch = this.pending.splice(0, Math.max(1, Math.min(256,limit)));
    try {
      this.db.exec('BEGIN');
      for (const { timestamp, data, honey, pattern } of batch) {
        if (data) this.statements['event']!.run(timestamp!,data);
        for(const item of honey??[]){this.statements['honey']!.run(item.timestamp,JSON.stringify(item));this.hasHoney=true;}
        if (pattern) {
          const existing = this.statements['patternId']!.get(pattern.sessionId);
          pattern.id = existing ? String(existing['pattern_id']) : 'SB-PATTERN-'+String(this.statements['nextId']!.get()!['value']).padStart(4,'0');
          this.statements['pattern']!.run(pattern.sessionId, pattern.id, pattern.timestamp, JSON.stringify(pattern));
        }
      }
      this.prune(Date.now());
      this.db.exec('COMMIT');
      this.processed+=batch.filter(item=>item.data).length;
      if(this.pending.length){this.immediate=setImmediate(()=>this.flush(64));this.immediate.unref();}
    } catch {
      try { this.db.exec('ROLLBACK'); } catch { /* no transaction */ }
      this.dropped += batch.length;
      this.fail();
    }
  }
  private prune(now: number): void {
    this.statements['expireEvents']!.run(now - this.retentionMs);
    this.statements['expirePatterns']!.run(now - this.retentionMs);
    this.statements['capEvents']!.run(this.maxEvents - 1);
    this.statements['capPatterns']!.run(this.maxPatterns);
    if (this.hasHoney) {
      this.statements['expireHoney']!.run(now - this.retentionMs);
      this.statements['capHoney']!.run(this.maxHoneyInteractions - 1);
    }
  }
  private read<T>(table: 'events' | 'patterns' | 'honey', limit: number): T[] {
    if (!this.online) return [];
    this.flush();
    if (!this.online) return [];
    try {
      this.prune(Date.now());
      const rows = this.statements[table==='events'?'readEvents':table==='honey'?'readHoney':'readPatterns']!.all(Math.max(1, Math.min(1000, Math.trunc(limit) || 20)));
      return rows.map((row) => JSON.parse(String(row['data'])) as T);
    } catch { this.fail(); return []; }
  }
  events(limit = 20): VibrationEvent[] { return this.read('events', limit); }
  patterns(limit = 20): Fingerprint[] { return this.read('patterns', limit); }
  honeyInteractions(limit = 20): HoneyInteraction[] { return this.read('honey', limit); }
  sessionEvents(id: string, limit = 64): VibrationEvent[] {
    if(!this.online)return [];this.flush();if(!this.online)return [];
    try{this.prune(Date.now());return this.statements['sessionEvents']!.all(id,Math.max(1,Math.min(128,Math.trunc(limit)||64))).map(row=>JSON.parse(String(row['data'])) as VibrationEvent).reverse();}catch{this.fail();return [];}
  }
  compare(current: Fingerprint): Similarity | null {
    let best: Similarity | null = null;
    for (const pattern of this.patterns(this.maxPatterns)) {
      if (pattern.sessionId === current.sessionId) continue;
      const value = similarity(current, pattern);
      if (value > 0 && (!best || value > best.similarity)) best = { patternId: pattern.id, similarity: value, meaning: 'behavioral similarity only' };
    }
    return best;
  }
  private fail(): void {
    this.available = false;
    try { this.options.onError?.(); } catch { /* fail open */ }
  }
  close(): void {
    if (this.closed) return;
    this.flush();
    this.closed = true;
    if (this.timer) clearTimeout(this.timer);
    if (this.immediate) clearImmediate(this.immediate);
    this.pending = [];
    try { this.db.close(); } catch { this.fail(); }
  }
}
