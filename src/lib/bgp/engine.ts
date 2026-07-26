import type {
  BgpRoute,
  EdgeSpec,
  NodeSpec,
  RouteStatus,
  SimEvent,
  Topology,
} from "./types";

/**
 * Integer-tick RFC 4271 decision-process engine.
 *
 * Every ordering decision is deterministic: the scheduler processes messages by
 * (tick, lamport seq), the decision process falls through the RFC 4271 9.1.2.2
 * ladder, and the final tie-break is the ascending Router ID string.
 */

export const ENGINE_TICK_LIMIT = 900;
/** Oscillation is declared when the same best-path signature recurs this often. */
const OSC_REPEAT_THRESHOLD = 4;

interface Message {
  tick: number;
  seq: number;
  from: string;
  to: string;
  edgeRank: number;
  route: BgpRoute | null; // null = withdraw
}

export interface EngineResult {
  events: SimEvent[];
  localRib: Record<string, BgpRoute | null>;
  oscillation: boolean;
  cycleProfile: string[];
  ticks: number;
}

/** Canonical sort key recovered by the visual track: ascending Router ID string. */
export function sortNodes(nodes: NodeSpec[]): NodeSpec[] {
  return [...nodes].sort((a, b) =>
    a.tier !== b.tier ? a.tier - b.tier : a.routerId.localeCompare(b.routerId),
  );
}

/** Outgoing edges of a router, ranked by the peer's Router ID (ascending). */
export function outgoingEdges(topo: Topology, from: string): EdgeSpec[] {
  return topo.edges
    .filter((e) => e.from === from)
    .sort((a, b) => a.to.localeCompare(b.to));
}

function betterRoute(a: BgpRoute, b: BgpRoute): boolean {
  if (a.localPref !== b.localPref) return a.localPref > b.localPref;
  if (a.asPath.length !== b.asPath.length) return a.asPath.length < b.asPath.length;
  const originRank = { IGP: 0, EGP: 1, INCOMPLETE: 2 } as const;
  if (a.origin !== b.origin) return originRank[a.origin] < originRank[b.origin];
  if (a.med !== b.med) return a.med < b.med;
  const ac = a.clusterList?.length ?? 0;
  const bc = b.clusterList?.length ?? 0;
  if (ac !== bc) return ac < bc;
  return a.nextHop.localeCompare(b.nextHop) < 0;
}

function routeKey(r: BgpRoute | null): string {
  return r ? `${r.nextHop}|${r.asPath.join("-")}|${r.localPref}` : "-";
}

export function runEngine(topo: Topology): EngineResult {
  const events: SimEvent[] = [];
  const nodesById = new Map(topo.nodes.map((n) => [n.routerId, n]));
  const ordered = sortNodes(topo.nodes);
  let seq = 0;

  const emit = (e: Omit<SimEvent, "seq">) => {
    events.push({ seq: seq++, ...e });
  };

  emit({
    tick: 0,
    type: "meta",
    payload: {
      scenario: topo.name,
      seed: topo.seed,
      prefix: topo.prefix,
      origin: topo.origin,
      nodes: ordered.map((n) => ({
        routerId: n.routerId,
        asn: n.asn,
        tier: n.tier,
        reflector: !!n.reflector,
        cluster: n.cluster ?? null,
      })),
      edges: topo.edges.map((e) => ({ from: e.from, to: e.to, ibgp: e.ibgp })),
    },
  });

  // Node/edge arrival ticks: nodes appear in canonical order, one every 4 ticks.
  ordered.forEach((n, i) => {
    emit({ tick: i * 4, type: "node", node: n.routerId, status: "withdrawn" });
  });
  const edgeTick = ordered.length * 4;
  topo.edges.forEach((e) => {
    emit({ tick: edgeTick, type: "edge", edge: [e.from, e.to] });
  });

  // adjRibIn[to][from] = route learned from that peer
  const adjRibIn = new Map<string, Map<string, BgpRoute>>();
  const localRib = new Map<string, BgpRoute | null>();
  const lastAdvert = new Map<string, number>(); // "from>to" -> tick
  const pending: Message[] = [];
  topo.nodes.forEach((n) => {
    adjRibIn.set(n.routerId, new Map());
    localRib.set(n.routerId, null);
  });

  const bestHistory = new Map<string, string[]>();
  let oscillation = false;
  const cycleProfile: string[] = [];

  const start = edgeTick + 4;

  // Origin injects the prefix.
  const originNode = nodesById.get(topo.origin)!;
  const originRoute: BgpRoute = {
    prefix: topo.prefix,
    nextHop: topo.origin,
    asPath: [originNode.asn],
    localPref: 100,
    med: 0,
    origin: "IGP",
  };
  localRib.set(topo.origin, originRoute);
  emit({
    tick: start,
    type: "best",
    node: topo.origin,
    status: "active-best",
    route: originRoute,
  });

  const schedule = (tick: number, from: string, route: BgpRoute | null) => {
    outgoingEdges(topo, from).forEach((e, rank) => {
      const peer = nodesById.get(e.to)!;
      const self = nodesById.get(from)!;
      // iBGP split horizon: a non-reflector never re-advertises iBGP-learned
      // routes to another iBGP peer. Reflectors do (route reflection).
      const learnedFrom = adjRibIn.get(from)?.get(route?.nextHop ?? "");
      const learnedIbgp =
        route != null &&
        route.nextHop !== from &&
        topo.edges.some((x) => x.to === from && x.from === route.nextHop && x.ibgp);
      if (e.ibgp && learnedIbgp && !self.reflector) return;
      void learnedFrom;
      void peer;
      const key = `${from}>${e.to}`;
      const last = lastAdvert.get(key) ?? -Infinity;
      const earliest = Math.max(tick, last + e.mrai);
      lastAdvert.set(key, earliest);
      pending.push({
        tick: earliest + rank * 8,
        seq: seq++,
        from,
        to: e.to,
        edgeRank: rank,
        route,
      });
    });
  };

  schedule(start, topo.origin, originRoute);

  let tick = start;
  let guard = 0;
  while (pending.length && tick <= ENGINE_TICK_LIMIT && guard++ < 20000) {
    pending.sort((a, b) => (a.tick !== b.tick ? a.tick - b.tick : a.seq - b.seq));
    const msg = pending.shift()!;
    tick = msg.tick;
    const receiver = nodesById.get(msg.to)!;
    const sender = nodesById.get(msg.from)!;
    const link = topo.edges.find((e) => e.from === msg.from && e.to === msg.to)!;

    emit({
      tick,
      type: msg.route ? "update" : "withdraw",
      node: msg.to,
      edge: [msg.from, msg.to],
      edgeRank: msg.edgeRank,
      route: msg.route ?? undefined,
    });

    const rin = adjRibIn.get(msg.to)!;
    let dropped = false;
    if (!msg.route) {
      rin.delete(msg.from);
    } else {
      // AS_PATH loop detection (eBGP) / ORIGINATOR_ID + CLUSTER_LIST (iBGP).
      // An advertisement that fails loop detection is an implicit withdraw of
      // whatever that peer previously advertised.
      if (!link.ibgp && msg.route.asPath.includes(receiver.asn)) {
        emit({ tick, type: "status", node: msg.to, status: "withdrawn", payload: { reason: "as-path-loop" } });
        rin.delete(msg.from);
        dropped = true;
      } else if (link.ibgp && msg.route.originatorId === receiver.routerId) {
        rin.delete(msg.from);
        dropped = true;
      } else if (link.ibgp && msg.route.clusterList?.includes(receiver.cluster ?? "")) {
        rin.delete(msg.from);
        dropped = true;
      }

      const adopted: BgpRoute = {
        ...msg.route,
        nextHop: msg.from,
        asPath: link.ibgp ? msg.route.asPath : [receiver.asn, ...msg.route.asPath],
        localPref: link.ibgp
          ? msg.route.localPref
          : receiver.preferVia != null && msg.route.asPath.includes(receiver.preferVia)
            ? link.localPref + 150
            : link.localPref,
        originatorId: link.ibgp
          ? (msg.route.originatorId ?? sender.routerId)
          : undefined,
        clusterList:
          link.ibgp && sender.reflector
            ? [...(msg.route.clusterList ?? []), sender.cluster ?? sender.routerId]
            : msg.route.clusterList,
      };
      if (!dropped) rin.set(msg.from, adopted);
    }

    // Decision process over Adj-RIB-In.
    let best: BgpRoute | null = null;
    for (const cand of [...rin.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
      if (!best || betterRoute(cand[1], best)) best = cand[1];
    }
    const prev = localRib.get(msg.to) ?? null;
    if (routeKey(prev) !== routeKey(best)) {
      localRib.set(msg.to, best);
      const hist = bestHistory.get(msg.to) ?? [];
      hist.push(routeKey(best));
      bestHistory.set(msg.to, hist);

      const status: RouteStatus = best
        ? receiver.reflector && best.originatorId
          ? "rr-relay-only"
          : "active-best"
        : "withdrawn";
      emit({
        tick,
        type: best ? "best" : "withdraw",
        node: msg.to,
        status,
        route: best ?? undefined,
      });
      if (rin.size > 1 && best) {
        for (const [peer, r] of rin) {
          if (routeKey(r) !== routeKey(best)) {
            emit({ tick, type: "status", node: msg.to, status: "backup-known", payload: { via: peer } });
          }
        }
      }
      schedule(tick + 1, msg.to, best);

      // Oscillation detection: repeated best-path signature cycling.
      const counts = new Map<string, number>();
      hist.forEach((h) => counts.set(h, (counts.get(h) ?? 0) + 1));
      const maxRepeat = Math.max(...counts.values());
      if (maxRepeat >= OSC_REPEAT_THRESHOLD && !oscillation) {
        oscillation = true;
        const cyc = hist.slice(-maxRepeat * 2);
        cycleProfile.push(...cyc);
        emit({
          tick,
          type: "oscillation",
          node: msg.to,
          status: "oscillating",
          payload: { cycleProfile: cyc, detectedAt: tick },
        });
      }
      if (oscillation) {
        emit({ tick, type: "status", node: msg.to, status: "oscillating" });
      }
    }
  }

  emit({
    tick: tick + 2,
    type: "converged",
    payload: {
      oscillationDetected: oscillation,
      tickBoundary: ENGINE_TICK_LIMIT,
      cycleProfile,
      localRib: Object.fromEntries(
        [...localRib.entries()].sort((a, b) => a[0].localeCompare(b[0])),
      ),
    },
  });

  return {
    events,
    localRib: Object.fromEntries(localRib),
    oscillation,
    cycleProfile,
    ticks: tick + 2,
  };
}
