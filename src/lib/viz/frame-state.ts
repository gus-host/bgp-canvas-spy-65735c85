import type { RouteStatus, SimEvent } from "../bgp/types";
import {
  CANVAS_H,
  CANVAS_W,
  beginPop,
  beginPulse,
  currentPopScale,
  currentPulseProgress,
  layoutNodes,
  statusColor,
  staggerTicks,
  type PopAnim,
  type PulseAnim,
} from "./visual-rules";

/**
 * Pure, deterministic frame state for a given tick — the exact same replay the
 * canvas renderer performs, exposed for harnesses via window.__bgpViz.
 */

export interface FrameNodeState {
  routerId: string;
  asn: number;
  tier: number;
  indexInTier: number;
  x: number;
  y: number;
  reflector: boolean;
  cluster: string | null;
  status: RouteStatus;
  color: string;
  popScale: number;
  visible: boolean;
}

export interface FramePulseState {
  from: string;
  to: string;
  edgeRank: number;
  startTick: number;
  progress: number;
  x: number;
  y: number;
  color: string;
}

export interface FrameState {
  tick: number;
  canvas: { width: number; height: number };
  nodes: Record<string, FrameNodeState>;
  pulses: FramePulseState[];
  converged: boolean;
  oscillating: boolean;
}

interface MetaNode {
  routerId: string;
  asn: number;
  tier: number;
  reflector: boolean;
  cluster: string | null;
}

export function computeFrameState(events: SimEvent[], tick: number): FrameState {
  const meta = events.find((e) => e.type === "meta");
  const metaNodes = (meta?.payload?.nodes as MetaNode[]) ?? [];
  const laid = layoutNodes(metaNodes);
  const pos = new Map(laid.map((n) => [n.routerId, n]));

  const pops = new Map<string, PopAnim>();
  const pulses = new Map<string, PulseAnim & { edgeRank: number }>();
  const status = new Map<string, RouteStatus>();
  const born = new Set<string>();
  let converged = false;
  let oscillating = false;

  for (const e of events) {
    if (e.tick > tick) break;
    if (e.type === "converged") converged = true;
    if (e.type === "oscillation") oscillating = true;
    if (e.type === "node" && e.node) {
      born.add(e.node);
      pops.set(e.node, beginPop(pops.get(e.node), e.tick));
      status.set(e.node, "withdrawn");
    }
    if ((e.type === "update" || e.type === "withdraw") && e.edge) {
      const key = e.edge.join(">");
      const rank = e.edgeRank ?? 0;
      const startTick = e.tick + staggerTicks(rank);
      const color = statusColor(e.type === "withdraw" ? "withdrawn" : "active-best");
      pulses.set(key, {
        ...beginPulse(pulses.get(key), startTick, e.edge[0], e.edge[1], color),
        edgeRank: rank,
      });
    }
    if (e.node && e.status) {
      const prev = status.get(e.node);
      status.set(e.node, e.status);
      if (prev !== e.status) pops.set(e.node, beginPop(pops.get(e.node), e.tick));
    }
  }

  const nodes: Record<string, FrameNodeState> = {};
  for (const n of laid) {
    const s = status.get(n.routerId) ?? "withdrawn";
    nodes[n.routerId] = {
      routerId: n.routerId,
      asn: n.asn,
      tier: n.tier,
      indexInTier: n.indexInTier,
      x: n.x,
      y: n.y,
      reflector: n.reflector,
      cluster: n.cluster,
      status: s,
      color: statusColor(s),
      popScale: currentPopScale(pops.get(n.routerId), tick),
      visible: born.has(n.routerId),
    };
  }

  const live: FramePulseState[] = [];
  pulses.forEach((p) => {
    const a = pos.get(p.from);
    const b = pos.get(p.to);
    if (!a || !b) return;
    if (tick < p.startTick) return;
    const progress = currentPulseProgress(p, tick);
    if (progress >= 1) return;
    live.push({
      from: p.from,
      to: p.to,
      edgeRank: p.edgeRank,
      startTick: p.startTick,
      progress,
      x: a.x + (b.x - a.x) * progress,
      y: a.y + (b.y - a.y) * progress,
      color: p.color,
    });
  });
  live.sort((x, y) => `${x.from}>${x.to}`.localeCompare(`${y.from}>${y.to}`));

  return {
    tick,
    canvas: { width: CANVAS_W, height: CANVAS_H },
    nodes,
    pulses: live,
    converged,
    oscillating,
  };
}
