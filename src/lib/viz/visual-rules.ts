import type { RouteStatus, SimEvent } from "../bgp/types";

/** Canvas render size — the graded capture region. */
export const CANVAS_W = 1200;
export const CANVAS_H = 800;

/* ------------------------------------------------------------------ *
 * 2.2 Layout — closed-form, pure function of (tier, index_within_tier)
 * ------------------------------------------------------------------ */
export const TIER_BASE_RADIUS = 130;
export const TIER_RADIUS_STEP = 115;
/** Fixed angular offset applied per tier so adjacent rings never align. */
export const TIER_ANGLE_OFFSET = Math.PI / 7;

export interface LayoutNode {
  routerId: string;
  asn: number;
  tier: number;
  reflector: boolean;
  cluster: string | null;
  x: number;
  y: number;
  indexInTier: number;
  tierCount: number;
}

/** Sort key: ascending Router ID string (tie rule and primary key alike). */
export function layoutNodes(
  nodes: {
    routerId: string;
    asn: number;
    tier: number;
    reflector: boolean;
    cluster: string | null;
  }[],
): LayoutNode[] {
  const byTier = new Map<number, typeof nodes>();
  nodes.forEach((n) => {
    const arr = byTier.get(n.tier) ?? [];
    arr.push(n);
    byTier.set(n.tier, arr);
  });
  const out: LayoutNode[] = [];
  const cx = CANVAS_W / 2;
  const cy = CANVAS_H / 2;
  [...byTier.keys()]
    .sort((a, b) => a - b)
    .forEach((tier) => {
      const arr = [...byTier.get(tier)!].sort((a, b) =>
        a.routerId.localeCompare(b.routerId),
      );
      const r = TIER_BASE_RADIUS + TIER_RADIUS_STEP * tier;
      arr.forEach((n, i) => {
        const theta =
          -Math.PI / 2 + TIER_ANGLE_OFFSET * tier + (2 * Math.PI * i) / arr.length;
        out.push({
          ...n,
          indexInTier: i,
          tierCount: arr.length,
          x: cx + r * Math.cos(theta),
          y: cy + r * Math.sin(theta),
        });
      });
    });
  return out;
}

/* ------------------------------------------------------------------ *
 * 2.3.1 Node arrival "pop" — damped harmonic oscillation
 * scale(t) = 1 + A e^(-ζωt) cos(ω√(1-ζ²) t + φ)
 * Constants are global (shared by every node in every scenario).
 * ------------------------------------------------------------------ */
export const POP = { A: 0.42, zeta: 0.23, omega: 0.55, phi: 0.0, durationTicks: 48 };

export function popScale(dt: number): number {
  if (dt < 0) return 1;
  if (dt > POP.durationTicks) return 1;
  const { A, zeta, omega, phi } = POP;
  const damped = omega * Math.sqrt(1 - zeta * zeta);
  return 1 + A * Math.exp(-zeta * omega * dt) * Math.cos(damped * dt + phi);
}

/* ------------------------------------------------------------------ *
 * 2.3.2 Pulse travel — fixed, non-preset cubic Bézier easing
 * ------------------------------------------------------------------ */
export const PULSE_BEZIER = { x1: 0.17, y1: 0.89, x2: 0.71, y2: 0.06 } as const;
export const PULSE_DURATION_TICKS = 30;

function bezierAxis(t: number, p1: number, p2: number): number {
  const mt = 1 - t;
  return 3 * mt * mt * t * p1 + 3 * mt * t * t * p2 + t * t * t;
}

/** Solve y for given x on the cubic Bézier (Newton + bisection fallback). */
export function pulseEase(x: number): number {
  const cx = Math.min(1, Math.max(0, x));
  let lo = 0;
  let hi = 1;
  let t = cx;
  for (let i = 0; i < 24; i++) {
    const val = bezierAxis(t, PULSE_BEZIER.x1, PULSE_BEZIER.x2);
    if (Math.abs(val - cx) < 1e-6) break;
    if (val < cx) lo = t;
    else hi = t;
    t = (lo + hi) / 2;
  }
  return bezierAxis(t, PULSE_BEZIER.y1, PULSE_BEZIER.y2);
}

/* ------------------------------------------------------------------ *
 * 2.3.3 Discrete hop-indexed stagger: 8 ticks per outgoing edge rank
 * ------------------------------------------------------------------ */
export const STAGGER_TICKS_PER_RANK = 8;
export function staggerTicks(edgeRank: number): number {
  return STAGGER_TICKS_PER_RANK * Math.max(0, Math.trunc(edgeRank));
}

/* ------------------------------------------------------------------ *
 * 2.4 Color — deterministic function of route status
 * ------------------------------------------------------------------ */
export const STATUS_COLORS: Record<RouteStatus, string> = {
  "active-best": "#33e6a0",
  "backup-known": "#3f9bff",
  withdrawn: "#54607a",
  oscillating: "#ff5c47",
  "rr-relay-only": "#f5c451",
};

export function statusColor(s: RouteStatus | undefined): string {
  return STATUS_COLORS[s ?? "withdrawn"];
}

/* ------------------------------------------------------------------ *
 * 2.3.4 Mid-flight interruption blending
 * ------------------------------------------------------------------ */
export interface PopAnim {
  startTick: number;
  /** Scale carried over from an interrupted animation (blend offset). */
  blendOffset: number;
}

export function beginPop(prev: PopAnim | undefined, tick: number): PopAnim {
  if (!prev) return { startTick: tick, blendOffset: 0 };
  const current = currentPopScale(prev, tick);
  // Continue from the current interpolated scale rather than resetting to rest.
  const offset = current - popScale(0);
  return { startTick: tick, blendOffset: Math.max(-0.6, Math.min(0.6, offset)) };
}

export function currentPopScale(a: PopAnim | undefined, tick: number): number {
  if (!a) return 1;
  const dt = tick - a.startTick;
  const decay = dt >= POP.durationTicks ? 0 : 1 - dt / POP.durationTicks;
  // Rendered scale is clamped so blended state can never invert the geometry.
  return Math.max(0.05, popScale(dt) + a.blendOffset * decay);
}

export interface PulseAnim {
  from: string;
  to: string;
  startTick: number;
  /** Travel progress inherited from an interrupted pulse on the same edge. */
  blendProgress: number;
  color: string;
}

export function beginPulse(
  prev: PulseAnim | undefined,
  tick: number,
  from: string,
  to: string,
  color: string,
): PulseAnim {
  const inherited = prev ? currentPulseProgress(prev, tick) : 0;
  return { from, to, startTick: tick, blendProgress: inherited, color };
}

export function currentPulseProgress(a: PulseAnim, tick: number): number {
  const raw = (tick - a.startTick) / PULSE_DURATION_TICKS;
  if (raw < 0) return a.blendProgress;
  const eased = pulseEase(Math.min(1, raw));
  // Blend from the interrupted position toward the new travel curve.
  return Math.min(1, a.blendProgress + (1 - a.blendProgress) * eased);
}

export function isEventVisible(e: SimEvent): boolean {
  return e.type !== "meta";
}
