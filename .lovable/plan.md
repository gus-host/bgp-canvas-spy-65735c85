## What I verified in the current app

- `?scenario=<id>&seed=<n>` **is** honoured by the root route (`validateSearch` in `src/routes/index.tsx`), and held-out topologies are requested as `scenario=RANDOM&seed=<n>` — matching your capture script's query building.
- `/api/simulate` and `/api/public/simulate` stream NDJSON with the exact headers your script records. GET/POST/OPTIONS exist on `/api/simulate`; GET/POST on the public alias.
- **Assumption 1 is only half true.** The stream does end with a `converged` event, but its payload today is `{ oscillationDetected, tickBoundary, cycleProfile, localRib }` — not the `{scenario_id, node_count, edge_count, oscillation_detected, final_tick, event_count, local_rib, oscillation_profile}` shape instruction.md requires. Also `oscillation` events are emitted mid-stream, never as the terminal event, so the "converged **or** oscillation" fallback never fires.
- **Assumption 3 is false.** `window.__bgpViz` does not exist anywhere in the codebase — the harness would hang on `waitForFunction`.
- Canvas is a single `<canvas>` pinned to 1200x800, so assumption on `document.querySelector('canvas')` holds.

## Work items

### 1. Generate `scenario.json` for the three named scenarios (download only)
Derived directly from `src/lib/bgp/topologies.ts` — not hand-written — by running the real `getTopology()` and serialising it, so it cannot drift from the engine that produced `oracle_ribs/*.json`. Each file contains:

```text
scenario_id, display_name, seed, prefix, origin_router
nodes[]  : routerId, asn, tier, reflector, cluster, prefer_via
edges[]  : from, to, ibgp, local_pref, mrai
policy   : med defaults, prepend rules, RR tier/cluster map
generator_rules : the exact RANDOM-<seed> contract read out of
                  randomTopology() — LCG (1664525/1013904223 mod 2^32),
                  draw order, node count 4..12, tier assignment,
                  ASN formula, routerId template, spanning-tree edge
                  pass, extra-edge pass, origin = last node
```
A `generator_rules` self-check runs the documented rules in isolation against `randomTopology(seed)` for all six holdout seeds and confirms byte-identical topologies before delivery.

### 2. Generate `expected_status_by_tick/<SCENARIO>.json` (download only)
`{tick: {routerId: status}}` per named scenario, built by replaying the real event trace with the same status-folding rule the UI uses (`best`/`withdraw` set status+route; `status` events overwrite status), emitted at every tick where any router's status changes, plus tick 0 and the final tick. Statuses use the five canonical values that key `STATUS_COLORS`.

### 3. Add the `window.__bgpViz` debug hook (repo change, required by instruction.md)
In `src/routes/index.tsx`, expose on mount:
- `__bgpViz.seek(tick)` — pauses playback and sets the tick synchronously enough for the harness (returns after a flush).
- `__bgpViz.getFrameState(tick)` — pure computation from the loaded events + `visual-rules.ts`: per-node `{x, y, tier, indexInTier, status, color, popScale}` and per-edge in-flight `{from, to, progress, color, edgeRank}`, plus `{tick, scenario, seed, converged, oscillating}`.
- `__bgpViz.ready` / `__bgpViz.maxTick` so the harness can wait properly.

Read-only and deterministic; no change to engine or rendering behaviour.

### 4. Align the terminal-event contract
Extend the engine's final `converged` event payload with the instruction.md keys (`scenario_id`, `node_count`, `edge_count`, `oscillation_detected`, `final_tick`, `event_count`, `local_rib`, `oscillation_profile`) while keeping the existing keys for backwards compatibility with fixtures already shipped. Then `capture_outputs.mjs` assumption 1 becomes literally true and its payload write needs no edits.

### 5. Reconciled `capture_outputs.mjs`
Ship a corrected copy in the bundle with the assumption block rewritten to match reality: terminal event is always `converged` (oscillation is a mid-stream marker mirrored into the payload), `scenario=RANDOM&seed=<n>` for holdouts, `__bgpViz` contract as implemented, and `holdout_seeds.json` read as `{seeds:[...]}`— I'll confirm the shipped file's actual key and match it.

## Verification before delivery
Run the harness end-to-end against the dev server: confirm every scenario writes a payload with the full key set, `__bgpViz.getFrameState` returns non-empty node maps at each sample tick, frames are 1200x800 and non-blank, and `expected_status_by_tick` agrees with the colors sampled from those frames.

## Repo impact
Only items 3 and 4 touch the repo (`src/routes/index.tsx`, `src/lib/bgp/engine.ts`). All fixtures go to `/mnt/documents/bgp-task-fixtures-v2/` plus a zip — nothing added to project files.
