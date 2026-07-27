// Shared, browser-safe types for the BGP convergence engine and visualizer.

export type RouteStatus =
  | "active-best"
  | "backup-known"
  | "withdrawn"
  | "oscillating"
  | "rr-relay-only";

export interface NodeSpec {
  /** Router ID string, e.g. "10.0.0.1" — canonical tie-break key. */
  routerId: string;
  asn: number;
  /** Tier index: 0 = outermost logical ring for flat topologies. */
  tier: number;
  /** Route reflector flag (iBGP clusters). */
  reflector?: boolean;
  /** iBGP cluster identifier; peers sharing a cluster are iBGP peers. */
  cluster?: string;
  /**
   * Cyclic policy trap: routes whose AS_PATH traverses this ASN get a
   * LOCAL_PREF boost, which is what makes BAD GADGET diverge.
   */
  preferVia?: number;
}

export interface EdgeSpec {
  from: string; // routerId
  to: string; // routerId
  /** iBGP when both ends share a cluster, eBGP otherwise. */
  ibgp: boolean;
  /** MRAI timer in ticks for advertisements sent on this adjacency. */
  mrai: number;
  /** LOCAL_PREF applied by `to` on routes learned from `from`. */
  localPref: number;
}

export interface Topology {
  name: string;
  /** Stable scenario identifier, e.g. "BAD_GADGET" or "RANDOM-42". */
  id: string;
  seed: number;
  nodes: NodeSpec[];
  edges: EdgeSpec[];
  /** routerId that originates the measured prefix. */
  origin: string;
  prefix: string;
}

export interface BgpRoute {
  prefix: string;
  nextHop: string; // routerId
  asPath: number[];
  localPref: number;
  med: number;
  origin: "IGP" | "EGP" | "INCOMPLETE";
  /** Set when learned from an iBGP peer via a route reflector. */
  originatorId?: string;
  clusterList?: string[];
}

export type EventType =
  | "meta"
  | "node"
  | "edge"
  | "update"
  | "withdraw"
  | "best"
  | "status"
  | "oscillation"
  | "converged";

export interface SimEvent {
  /** Monotonic Lamport sequence number for causally linked steps. */
  seq: number;
  tick: number;
  type: EventType;
  node?: string;
  edge?: [string, string];
  /** 0-indexed rank of this edge in the sender's sorted outgoing edge list. */
  edgeRank?: number;
  status?: RouteStatus;
  route?: BgpRoute;
  payload?: Record<string, unknown>;
}
