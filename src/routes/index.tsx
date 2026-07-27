import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import { BgpCanvas } from "@/components/BgpCanvas";
import { useNdjsonSimulation } from "@/hooks/use-ndjson-simulation";
import { STATUS_COLORS } from "@/lib/viz/visual-rules";
import type { BgpRoute, RouteStatus } from "@/lib/bgp/types";

const TITLE = "BGP Convergence Visualizer — RFC 4271 Tick Engine";
const DESC =
  "Deterministic RFC 4271 BGP simulation streamed as chunked NDJSON and rendered on canvas: BAD GADGET, DISAGREE and iBGP route-reflector convergence, tick by tick.";

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>) => ({
    scenario:
      typeof search.scenario === "string" && search.scenario ? search.scenario : undefined,
    seed: search.seed != null && !Number.isNaN(Number(search.seed))
      ? Number(search.seed)
      : undefined,
  }),
  head: () => ({
    meta: [
      { title: TITLE },
      { name: "description", content: DESC },
      { property: "og:title", content: TITLE },
      { property: "og:description", content: DESC },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Index,
});

const SCENARIOS = [
  { id: "BAD_GADGET", label: "BAD GADGET" },
  { id: "DISAGREE", label: "DISAGREE" },
  { id: "IBGP_RR", label: "iBGP RR Clusters" },
  { id: "RANDOM", label: "Held-out (seeded)" },
];

function Index() {
  const search = Route.useSearch();
  // URL params drive the reference-capture harness; UI buttons override them.
  const [scenario, setScenario] = useState(search.scenario ?? "BAD_GADGET");
  const [seed, setSeed] = useState(search.seed ?? 7);

  const [tick, setTick] = useState(0);
  const [playing, setPlaying] = useState(true);
  const { events, loading, error, reload } = useNdjsonSimulation(scenario, seed);
  const raf = useRef<number | null>(null);

  const maxTick = useMemo(
    () => (events.length ? events[events.length - 1].tick + 90 : 0),
    [events],
  );

  useEffect(() => setTick(0), [scenario, seed]);

  useEffect(() => {
    if (!playing || maxTick === 0) return;
    // 1 tick = 1 frame at 60 FPS, matching the reference capture contract.
    const step = () => {
      setTick((t) => (t >= maxTick ? t : t + 1));
      raf.current = requestAnimationFrame(step);
    };
    raf.current = requestAnimationFrame(step);
    return () => {
      if (raf.current) cancelAnimationFrame(raf.current);
    };
  }, [playing, maxTick]);

  const converged = useMemo(
    () => events.find((e) => e.type === "converged" && e.tick <= tick),
    [events, tick],
  );
  const oscillating = useMemo(
    () => events.some((e) => e.type === "oscillation" && e.tick <= tick),
    [events, tick],
  );

  const rib = useMemo(() => {
    const map = new Map<string, { status: RouteStatus; route?: BgpRoute }>();
    for (const e of events) {
      if (e.tick > tick) break;
      if (!e.node) continue;
      if (e.type === "best" || e.type === "withdraw") {
        map.set(e.node, { status: e.status ?? "withdrawn", route: e.route });
      } else if (e.type === "status" && e.status) {
        map.set(e.node, { status: e.status, route: map.get(e.node)?.route });
      }
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [events, tick]);

  const log = useMemo(
    () => events.filter((e) => e.tick <= tick).slice(-140).reverse(),
    [events, tick],
  );

  return (
    <main className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto flex max-w-[1600px] flex-wrap items-center gap-4 px-6 py-4">
          <div>
            <h1 className="font-mono text-lg font-semibold tracking-tight">
              BGP Convergence Visualizer
            </h1>
            <p className="text-xs text-muted-foreground">
              RFC 4271 integer-tick engine · chunked NDJSON transport · canvas render pipeline
            </p>
          </div>
          <div className="ml-auto flex flex-wrap items-center gap-2">
            {SCENARIOS.map((s) => (
              <button
                key={s.id}
                onClick={() => setScenario(s.id)}
                className={`rounded-md border px-3 py-1.5 font-mono text-xs transition-colors ${
                  scenario === s.id
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-secondary text-secondary-foreground hover:bg-muted"
                }`}
              >
                {s.label}
              </button>
            ))}
            {scenario === "RANDOM" && (
              <input
                type="number"
                value={seed}
                onChange={(e) => setSeed(Number(e.target.value) || 1)}
                className="w-20 rounded-md border border-input bg-secondary px-2 py-1.5 font-mono text-xs"
                aria-label="Seed"
              />
            )}
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-[1600px] gap-6 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        <section>
          <BgpCanvas events={events} tick={tick} />
          <div className="mt-3 flex flex-wrap items-center gap-3">
            <button
              data-viz-playpause=""
              onClick={() => setPlaying((p) => !p)}

              className="rounded-md bg-primary px-4 py-2 font-mono text-xs font-semibold text-primary-foreground"
            >
              {playing ? "Pause" : "Play"}
            </button>
            <button
              onClick={() => {
                setTick(0);
                void reload();
              }}
              className="rounded-md border border-border bg-secondary px-4 py-2 font-mono text-xs"
            >
              Restart stream
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(maxTick, 1)}
              value={tick}
              onChange={(e) => setTick(Number(e.target.value))}
              className="h-1 flex-1 min-w-40 accent-[var(--color-primary)]"
              aria-label="Tick scrubber"
            />
            <span className="font-mono text-xs text-muted-foreground">
              tick {tick} / {maxTick}
            </span>
          </div>

          <div className="mt-3 flex flex-wrap gap-3 font-mono text-[11px] text-muted-foreground">
            {Object.entries(STATUS_COLORS).map(([k, v]) => (
              <span key={k} className="flex items-center gap-1.5">
                <span
                  className="inline-block h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: v }}
                />
                {k}
              </span>
            ))}
          </div>
        </section>

        <aside className="flex min-w-0 flex-col gap-4">
          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Scheduler state
            </h2>
            <p className="mt-2 font-mono text-sm">
              {loading
                ? "streaming NDJSON…"
                : error
                  ? `stream error: ${error}`
                  : oscillating
                    ? "OSCILLATION DETECTED"
                    : converged
                      ? "CONVERGED (scheduler exhausted)"
                      : "converging…"}
            </p>
            <p className="mt-1 font-mono text-[11px] text-muted-foreground">
              {events.length} events · Lamport-ordered
            </p>
          </div>

          <div className="rounded-xl border border-border bg-card p-4">
            <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              Local-RIB
            </h2>
            <div className="mt-2 space-y-1.5">
              {rib.map(([id, v]) => (
                <div key={id} className="flex items-center gap-2 font-mono text-[11px]">
                  <span
                    className="inline-block h-2 w-2 shrink-0 rounded-full"
                    style={{ backgroundColor: STATUS_COLORS[v.status] }}
                  />
                  <span className="w-20 shrink-0">{id}</span>
                  <span className="truncate text-muted-foreground">
                    {v.route ? `via ${v.route.nextHop} · lp ${v.route.localPref} · ${v.route.asPath.join(" ")}` : "no route"}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="min-h-0 rounded-xl border border-border bg-card p-4">
            <h2 className="font-mono text-xs uppercase tracking-widest text-muted-foreground">
              NDJSON event log
            </h2>
            <div className="mt-2 max-h-96 overflow-auto font-mono text-[11px] leading-relaxed">
              {log.map((e) => (
                <div key={e.seq} className="flex gap-2 border-b border-border/40 py-0.5">
                  <span className="w-10 shrink-0 text-muted-foreground">{e.tick}</span>
                  <span className="w-16 shrink-0 text-accent">{e.type}</span>
                  <span className="truncate">
                    {e.node ?? ""}
                    {e.edge ? ` ${e.edge[0]}→${e.edge[1]}` : ""}
                    {e.edgeRank != null ? ` r${e.edgeRank}` : ""}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </main>
  );
}
