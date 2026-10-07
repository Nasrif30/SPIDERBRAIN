import { clamp, round, type RouteGraphView } from '@spiderbrain/shared';
import { decay } from '../physics/decay.js';
import { diffuse, diffusionConfig, type DiffusionOptions } from '../physics/diffusion.js';
export interface GraphOptions { maxNodes?: number; maxEdges?: number; retentionMs?: number; decay?: number; diffusion?: DiffusionOptions }
interface Node { route: string; visits: number; energy: number; awareness: number; energyAt: number; awarenessAt: number; lastActivity: number; neighbors: Set<string> }
interface Edge { from: string; to: string; transitions: number; lastActivity: number }
export class RouteGraph {
  private readonly nodes = new Map<string, Node>();
  private readonly edges = new Map<string, Edge>();
  readonly maxNodes: number;
  readonly maxEdges: number;
  readonly retentionMs: number;
  readonly decayRate: number;
  readonly diffusion;
  private evictedNodes = 0;
  private evictedEdges = 0;
  constructor(options: GraphOptions = {}) {
    this.maxNodes = options.maxNodes ?? 256;
    this.maxEdges = options.maxEdges ?? 1024;
    this.retentionMs = options.retentionMs ?? 900_000;
    this.decayRate = options.decay ?? 0.025;
    this.diffusion = diffusionConfig(options.diffusion);
    if (!Number.isInteger(this.maxNodes) || this.maxNodes < 1 || this.maxNodes > 4096 ||
      !Number.isInteger(this.maxEdges) || this.maxEdges < 0 || this.maxEdges > 16_384 ||
      !Number.isSafeInteger(this.retentionMs) || this.retentionMs < 1000 ||
      !Number.isFinite(this.decayRate) || this.decayRate < 0.005 || this.decayRate > 1) throw new Error('Invalid graph bounds');
  }
  private key(from: string, to: string) { return JSON.stringify([from, to]); }
  private removeEdge(key: string): void {
    const edge = this.edges.get(key);
    if (!edge) return;
    this.edges.delete(key);
    this.evictedEdges++;
    if (!this.edges.has(this.key(edge.to, edge.from))) {
      this.nodes.get(edge.from)?.neighbors.delete(edge.to);
      this.nodes.get(edge.to)?.neighbors.delete(edge.from);
    }
  }
  private removeNode(route: string): void {
    this.nodes.delete(route);
    this.evictedNodes++;
    for (const [key, edge] of this.edges) if (edge.from === route || edge.to === route) this.removeEdge(key);
  }
  prune(now: number): void {
    for (const [route, node] of this.nodes) {
      if (now - node.lastActivity <= this.retentionMs) break;
      this.removeNode(route);
    }
    for (const [key, edge] of this.edges) {
      if (now - edge.lastActivity <= this.retentionMs) break;
      this.removeEdge(key);
    }
  }
  rarity(route: string, previous: string | undefined): { route: number; transition: number } {
    return { route: 1 / (1 + (this.nodes.get(route)?.visits ?? 0)),
      transition: 1 / (1 + (previous ? this.edges.get(this.key(previous, route))?.transitions ?? 0 : 0)) };
  }
  observe(route: string, previous: string | undefined, now: number): void {
    this.prune(now);
    let node = this.nodes.get(route);
    if (!node) {
      if (this.nodes.size >= this.maxNodes) this.removeNode(this.nodes.keys().next().value!);
      node = { route, visits: 0, energy: 0, awareness: 0, energyAt: now, awarenessAt: now, lastActivity: now, neighbors: new Set() };
    }
    node.visits++;
    node.lastActivity = now;
    this.nodes.delete(route); this.nodes.set(route, node);
    if (!previous || previous === route || !this.nodes.has(previous) || !this.maxEdges) return;
    const key = this.key(previous, route);
    let edge = this.edges.get(key);
    if (!edge) {
      if (this.edges.size >= this.maxEdges) this.removeEdge(this.edges.keys().next().value!);
      edge = { from: previous, to: route, transitions: 0, lastActivity: now };
    }
    edge.transitions++;
    edge.lastActivity = now;
    this.edges.delete(key); this.edges.set(key, edge);
    this.nodes.get(previous)!.neighbors.add(route); node.neighbors.add(previous);
  }
  awareness(route: string, now: number): number {
    const node = this.nodes.get(route);
    return node ? decay(node.awareness, now - node.awarenessAt, this.diffusion.decay) : 0;
  }
  energize(route: string, impulse: number, now: number): void {
    const node = this.nodes.get(route);
    if (!node) return;
    node.energy = clamp(decay(node.energy, now - node.energyAt, this.decayRate) + impulse * 0.35, 0, 30);
    node.energyAt = now;
    // Only the new local impulse propagates. Received awareness is never re-emitted.
    const awareness = diffuse(route, impulse, (item) => [...(this.nodes.get(item)?.neighbors ?? [])], this.diffusion);
    for (const [recipient, amount] of awareness) {
      const adjacent = this.nodes.get(recipient);
      if (!adjacent) continue;
      adjacent.awareness = clamp(this.awareness(recipient, now) + amount, 0, this.diffusion.maxContribution);
      adjacent.awarenessAt = now;
    }
  }
  get size() { return { nodes: this.nodes.size, edges: this.edges.size }; }
  snapshot(now: number, maxNodes = this.maxNodes, maxEdges = this.maxEdges): RouteGraphView {
    this.prune(now);
    const nodes = [...this.nodes.values()].slice(-maxNodes);
    const visible = new Set(nodes.map((node) => node.route));
    return { nodes: nodes.map((node) => ({ route: node.route, visits: node.visits,
      energy: round(decay(node.energy, now - node.energyAt, this.decayRate)), awareness: round(this.awareness(node.route, now)),
      lastActivity: node.lastActivity, neighbors: [...node.neighbors].sort() })),
      edges: [...this.edges.values()].filter((edge) => visible.has(edge.from) && visible.has(edge.to)).slice(-maxEdges).map((edge) => ({ ...edge })),
      limits: { maxNodes: this.maxNodes, maxEdges: this.maxEdges, retentionMs: this.retentionMs },
      evictedNodes: this.evictedNodes, evictedEdges: this.evictedEdges, totalNodes: this.nodes.size, totalEdges: this.edges.size };
  }
  close(): void { this.nodes.clear(); this.edges.clear(); }
}
