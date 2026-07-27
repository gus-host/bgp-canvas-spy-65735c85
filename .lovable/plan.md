## Goal

Produce every fixture file your `tests/fixtures/` needs as a **downloadable bundle in chat only** — nothing added to the repo. Output goes to `/mnt/documents/bgp-task-fixtures/` plus a single zip.

## What gets generated

All values are computed by running the existing engine/layout code once (headless, via a throwaway script under `/tmp`) and freezing the output to static JSON — the verifier never executes engine code.

```text
bgp-task-fixtures/
  ground_truth_params.json        pop {A,zeta,omega,phi,durationTicks},
                                  pulse bezier tuple + duration, stagger=8,
                                  tier radii 130/115, angle offset PI/7, canvas 1200x800
  status_colors.json              exact STATUS_COLORS map from visual-rules.ts
  transport_contract.json         exact /api/simulate headers + method list
  holdout_seeds.json              6 fixed seeds, each labelled oscillating|convergent
  sample_ticks.json               per scenario: arrival / pulse / stagger /
                                  interruption tick picks, each with the seq it came from
  oracle_ribs/{BAD_GADGET,DISAGREE,IBGP_RR,RANDOM-<seed> x6}.json
                                  final local-RIB per router + converged payload
                                  + oscillation_profile (when oscillating)
  oscillation_profiles/BAD_GADGET.json (+ oscillating holdouts)
  causal_order/{scenario}.json    required (seq_before, seq_after) precedence pairs
                                  extracted from the event trace
  expected_positions/{scenario}.json   {routerId: {x,y,tier,indexInTier}} from layoutNodes()
  pop_fit_sample.json             one (scenario, node, arrival tick) triple
  stagger_fit_sample.json         one (scenario, sender, ranked edge list, ticks) triple
  interruption_sample.json        one (scenario, edge, interrupting tick) triple
  events/{scenario}.ndjson        full trace, so you can cross-check my tick picks
  reference_frames/{scenario}/{tick}.png   6 ticks per scenario, 1200x800 crops
```

## How each piece is produced

1. **Engine oracles** — a Node/tsx script imports `getTopology` + `runEngine` for the 3 named scenarios and the 6 holdout seeds, writes `events/*.ndjson` and the final `converged` payload (`localRib`, `oscillationDetected`, `cycleProfile`) into `oracle_ribs/`.
2. **Causal order** — derived from the same traces: for each `best`/`update` event, the pairs `(update.seq -> resulting best.seq)` and `(best.seq -> downstream update.seq)` that any correct re-implementation must preserve.
3. **Positions** — call `layoutNodes()` on each scenario's meta node list; round to 6 decimals.
4. **Sample ticks** — chosen programmatically: first `node` arrival for pop; a `best` event with ≥2 outgoing edges for stagger (rank 0/1/2 tick offsets recorded); an edge that receives a second `update` while a prior pulse is still within its 30-tick window for interruption.
5. **Reference frames** — dev server on :8080 + Playwright (Chromium, already in the sandbox) drives the existing scrubber the same way `tools/capture-reference.mjs` does, screenshotting the pinned 1200x800 canvas at exactly the ticks in `sample_ticks.json`, per scenario, with `?scenario=` honoured (already fixed).

## Defaults I'm committing to (say now if you want different)

- Holdout seeds: `[7, 19, 23, 41, 58, 77]`, each labelled after the run.
- 6 reference frames per scenario (arrival, mid-pulse, stagger spread, interruption, oscillation/convergence, final).
- Transport contract recorded verbatim: `Content-Type: application/x-ndjson`, `Transfer-Encoding: chunked`, `Cache-Control: no-store, no-transform`, `X-Accel-Buffering: no`, `Access-Control-Allow-Origin: *`; GET/POST/OPTIONS on `/api/simulate`, GET/POST on `/api/public/simulate`.

## Verification before delivery

Every generated PNG is inspected (no blank/clipped frames, correct topology per scenario — the DISAGREE/IBGP mismatch you hit is exactly what I re-check), and each JSON is re-read and key-shape-summarised in my reply so you can lock `test_outputs.py` to real key names.

## Repo impact

None. Only `/tmp` scratch and `/mnt/documents` artifacts; no project files created or modified.
