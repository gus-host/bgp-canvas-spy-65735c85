import type { EdgeSpec, NodeSpec, Topology } from "./types";

export const SCENARIOS = ["BAD_GADGET", "DISAGREE", "IBGP_RR"] as const;
export type ScenarioName = (typeof SCENARIOS)[number];

function node(
  asn: number,
  routerId: string,
  tier: number,
  extra: Partial<NodeSpec> = {},
): NodeSpec {
  return { asn, routerId, tier, ...extra };
}

function edge(
  from: string,
  to: string,
  localPref: number,
  mrai: number,
  ibgp = false,
): EdgeSpec {
  return { from, to, localPref, mrai, ibgp };
}

/** 4-AS cyclic policy trap: each AS prefers the route through its neighbour. */
function badGadget(): Topology {
  const nodes = [
    node(65001, "10.0.0.1", 0, { preferVia: 65002 }),
    node(65002, "10.0.0.2", 0, { preferVia: 65003 }),
    node(65003, "10.0.0.3", 0, { preferVia: 65004 }),
    node(65004, "10.0.0.4", 0, { preferVia: 65001 }),
  ];
  const edges: EdgeSpec[] = [
    edge("10.0.0.1", "10.0.0.2", 200, 6),
    edge("10.0.0.2", "10.0.0.1", 100, 6),
    edge("10.0.0.2", "10.0.0.3", 200, 6),
    edge("10.0.0.3", "10.0.0.2", 100, 6),
    edge("10.0.0.3", "10.0.0.4", 200, 6),
    edge("10.0.0.4", "10.0.0.3", 100, 6),
    edge("10.0.0.4", "10.0.0.1", 200, 6),
    edge("10.0.0.1", "10.0.0.4", 100, 6),
  ];
  return {
    name: "BAD GADGET",
    seed: 1,
    nodes,
    edges,
    origin: "10.0.0.1",
    prefix: "203.0.113.0/24",
  };
}

/** DISAGREE: conflicting policies in a mesh that still settles via timing. */
function disagree(): Topology {
  const nodes = [
    node(65010, "10.1.0.4", 0),
    node(65011, "10.1.0.1", 0),
    node(65012, "10.1.0.3", 0),
    node(65013, "10.1.0.2", 0),
    node(65014, "10.1.0.5", 0),
  ];
  const ids = nodes.map((n) => n.routerId);
  const edges: EdgeSpec[] = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      if ((i + j) % 3 === 0 && i !== 0) continue;
      edges.push(edge(ids[i], ids[j], 100 + ((i * 7 + j) % 3) * 50, 5 + ((i + j) % 3)));
      edges.push(edge(ids[j], ids[i], 100 + ((j * 5 + i) % 3) * 50, 5 + ((i + j) % 4)));
    }
  }
  return {
    name: "DISAGREE",
    seed: 2,
    nodes,
    edges,
    origin: "10.1.0.4",
    prefix: "198.51.100.0/24",
  };
}

/** Multi-tier route reflector clusters, with a deliberate same-tier degree tie. */
function ibgpRr(): Topology {
  const nodes = [
    node(65100, "10.2.0.1", 0, { reflector: true, cluster: "core" }),
    node(65100, "10.2.0.2", 0, { reflector: true, cluster: "core" }),
    node(65100, "10.2.1.1", 1, { reflector: true, cluster: "edge-a" }),
    node(65100, "10.2.1.2", 1, { reflector: true, cluster: "edge-b" }),
    node(65100, "10.2.2.1", 2, { cluster: "edge-a" }),
    node(65100, "10.2.2.2", 2, { cluster: "edge-a" }),
    node(65100, "10.2.2.3", 2, { cluster: "edge-b" }),
    node(65200, "10.2.9.1", 2, {}),
  ];
  const edges: EdgeSpec[] = [
    edge("10.2.0.1", "10.2.0.2", 100, 4, true),
    edge("10.2.0.2", "10.2.0.1", 100, 4, true),
    edge("10.2.0.1", "10.2.1.1", 100, 4, true),
    edge("10.2.1.1", "10.2.0.1", 100, 4, true),
    edge("10.2.0.2", "10.2.1.2", 100, 4, true),
    edge("10.2.1.2", "10.2.0.2", 100, 4, true),
    edge("10.2.1.1", "10.2.2.1", 100, 4, true),
    edge("10.2.2.1", "10.2.1.1", 100, 4, true),
    edge("10.2.1.1", "10.2.2.2", 100, 4, true),
    edge("10.2.2.2", "10.2.1.1", 100, 4, true),
    edge("10.2.1.2", "10.2.2.3", 100, 4, true),
    edge("10.2.2.3", "10.2.1.2", 100, 4, true),
    edge("10.2.2.3", "10.2.9.1", 150, 4),
    edge("10.2.9.1", "10.2.2.3", 150, 4),
  ];
  return {
    name: "iBGP Route Reflector Clusters",
    seed: 3,
    nodes,
    edges,
    origin: "10.2.9.1",
    prefix: "192.0.2.0/24",
  };
}

/** Deterministic 32-bit LCG so held-out seeds reproduce exactly. */
function lcg(seed: number) {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/** Seeded random topology, 4–12 AS nodes, tier structure preserved. */
export function randomTopology(seed: number): Topology {
  const rnd = lcg(seed);
  const count = 4 + Math.floor(rnd() * 9);
  const nodes: NodeSpec[] = [];
  for (let i = 0; i < count; i++) {
    const tier = i < 2 ? 0 : rnd() < 0.5 ? 1 : 2;
    // AS numbers intentionally out of insertion order so sort keys disagree.
    const asn = 64512 + ((i * 37 + Math.floor(rnd() * 11)) % 512);
    const routerId = `10.${(seed % 200) + 20}.${tier}.${i + 1}`;
    nodes.push(node(asn, routerId, tier));
  }
  const edges: EdgeSpec[] = [];
  for (let i = 1; i < count; i++) {
    const j = Math.floor(rnd() * i);
    const lp = 100 + Math.floor(rnd() * 3) * 50;
    const mrai = 4 + Math.floor(rnd() * 4);
    edges.push(edge(nodes[i].routerId, nodes[j].routerId, lp, mrai));
    edges.push(edge(nodes[j].routerId, nodes[i].routerId, 100 + Math.floor(rnd() * 3) * 50, mrai));
  }
  const extra = Math.floor(rnd() * count);
  for (let k = 0; k < extra; k++) {
    const a = Math.floor(rnd() * count);
    const b = Math.floor(rnd() * count);
    if (a === b) continue;
    edges.push(edge(nodes[a].routerId, nodes[b].routerId, 100 + Math.floor(rnd() * 3) * 50, 5));
    edges.push(edge(nodes[b].routerId, nodes[a].routerId, 100 + Math.floor(rnd() * 3) * 50, 5));
  }
  return {
    name: `RANDOM-${seed}`,
    seed,
    nodes,
    edges,
    origin: nodes[nodes.length - 1].routerId,
    prefix: "203.0.113.0/24",
  };
}

export function getTopology(scenario: string, seed?: number): Topology {
  switch (scenario) {
    case "BAD_GADGET":
      return badGadget();
    case "DISAGREE":
      return disagree();
    case "IBGP_RR":
      return ibgpRr();
    default:
      return randomTopology(seed ?? 1);
  }
}
