import { useEffect, useMemo, useRef } from "react";
import type { RouteStatus, SimEvent } from "@/lib/bgp/types";
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
  type LayoutNode,
  type PopAnim,
  type PulseAnim,
} from "@/lib/viz/visual-rules";

interface Props {
  events: SimEvent[];
  tick: number;
}

interface MetaNode {
  routerId: string;
  asn: number;
  tier: number;
  reflector: boolean;
  cluster: string | null;
}

export function BgpCanvas({ events, tick }: Props) {
  const ref = useRef<HTMLCanvasElement | null>(null);

  const meta = useMemo(() => {
    const m = events.find((e) => e.type === "meta");
    const nodes = (m?.payload?.nodes as MetaNode[]) ?? [];
    const edges = (m?.payload?.edges as { from: string; to: string; ibgp: boolean }[]) ?? [];
    return { nodes: layoutNodes(nodes), edges };
  }, [events]);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const pos = new Map<string, LayoutNode>();
    meta.nodes.forEach((n) => pos.set(n.routerId, n));

    // Replay every event up to `tick`, carrying mid-flight animation state.
    const pops = new Map<string, PopAnim>();
    const pulses = new Map<string, PulseAnim>();
    const status = new Map<string, RouteStatus>();
    const born = new Map<string, number>();
    const edgeLive = new Set<string>();

    for (const e of events) {
      if (e.tick > tick) break;
      if (e.type === "node" && e.node) {
        born.set(e.node, e.tick);
        pops.set(e.node, beginPop(pops.get(e.node), e.tick));
        status.set(e.node, "withdrawn");
      }
      if (e.type === "edge" && e.edge) edgeLive.add(e.edge.join(">"));
      if ((e.type === "update" || e.type === "withdraw") && e.edge) {
        const key = e.edge.join(">");
        const startTick = e.tick + staggerTicks(e.edgeRank ?? 0);
        const color = statusColor(e.type === "withdraw" ? "withdrawn" : "active-best");
        pulses.set(key, beginPulse(pulses.get(key), startTick, e.edge[0], e.edge[1], color));
      }
      if (e.node && e.status) {
        const prev = status.get(e.node);
        status.set(e.node, e.status);
        if (prev !== e.status) pops.set(e.node, beginPop(pops.get(e.node), e.tick));
      }
    }

    ctx.clearRect(0, 0, CANVAS_W, CANVAS_H);
    ctx.fillStyle = "#0a0f1c";
    ctx.fillRect(0, 0, CANVAS_W, CANVAS_H);

    // Grid
    ctx.strokeStyle = "rgba(120,150,200,0.06)";
    ctx.lineWidth = 1;
    for (let x = 0; x <= CANVAS_W; x += 50) {
      ctx.beginPath();
      ctx.moveTo(x + 0.5, 0);
      ctx.lineTo(x + 0.5, CANVAS_H);
      ctx.stroke();
    }
    for (let y = 0; y <= CANVAS_H; y += 50) {
      ctx.beginPath();
      ctx.moveTo(0, y + 0.5);
      ctx.lineTo(CANVAS_W, y + 0.5);
      ctx.stroke();
    }

    // Edges
    meta.edges.forEach((e) => {
      const a = pos.get(e.from);
      const b = pos.get(e.to);
      if (!a || !b) return;
      if (!edgeLive.has(`${e.from}>${e.to}`)) return;
      ctx.beginPath();
      ctx.strokeStyle = e.ibgp ? "rgba(245,196,81,0.22)" : "rgba(120,160,220,0.28)";
      ctx.lineWidth = e.ibgp ? 1.5 : 2;
      if (e.ibgp) ctx.setLineDash([6, 6]);
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      ctx.setLineDash([]);
    });

    // Pulses
    pulses.forEach((p) => {
      const a = pos.get(p.from);
      const b = pos.get(p.to);
      if (!a || !b) return;
      if (tick < p.startTick) return;
      const prog = currentPulseProgress(p, tick);
      if (prog >= 1) return;
      const x = a.x + (b.x - a.x) * prog;
      const y = a.y + (b.y - a.y) * prog;
      const grad = ctx.createRadialGradient(x, y, 0, x, y, 14);
      grad.addColorStop(0, p.color);
      grad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = p.color;
      ctx.beginPath();
      ctx.arc(x, y, 4, 0, Math.PI * 2);
      ctx.fill();
    });

    // Nodes
    meta.nodes.forEach((n) => {
      if (!born.has(n.routerId)) return;
      const scale = currentPopScale(pops.get(n.routerId), tick);
      const color = statusColor(status.get(n.routerId));
      const r = 22 * scale;
      ctx.beginPath();
      ctx.fillStyle = "#101828";
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.lineWidth = n.reflector ? 4 : 2.5;
      ctx.strokeStyle = color;
      ctx.stroke();

      ctx.globalAlpha = 0.18;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      ctx.fillStyle = "#e6edf7";
      ctx.font = "600 13px ui-monospace, monospace";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(`AS${n.asn}`, n.x, n.y - 1);
      ctx.fillStyle = "rgba(200,215,235,0.6)";
      ctx.font = "10px ui-monospace, monospace";
      ctx.fillText(n.routerId, n.x, n.y + 34);
    });

    // HUD
    ctx.fillStyle = "rgba(200,215,235,0.75)";
    ctx.font = "12px ui-monospace, monospace";
    ctx.textAlign = "left";
    ctx.fillText(`tick ${tick}`, 16, 22);
  }, [events, tick, meta]);

  return (
    <canvas
      ref={ref}
      width={CANVAS_W}
      height={CANVAS_H}
      data-viz-canvas="bgp"
      className="w-full rounded-xl border border-border bg-card"
    />
  );
}
