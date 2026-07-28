
# Re-scoping `dynamo/bgp-visual-rules` to a 1–3 hour task

## What the review actually says

Both trials failed for the same reason: the agents spent their hour on **measurement logistics** (ffmpeg extraction, peak detection, guessing) and never got to honest fitting. Nothing about the grading or the golden values is wrong — six correct answers exist, tolerances are generous relative to the errors (10–70x over tol), and no test is flaky.

So the fix is not "make it easier to be right", it is **"remove the hours that aren't the crux"**: video decoding, frame selection, finding where a status is even visible, and guessing which functional family each curve belongs to. What stays hard: recovering the exact constants, the per-tier angle offset, the integer stagger, and continue-not-reset blending.

Golden parameters, expected fixture values, and the verifier's numeric checks stay **byte-identical** — so no re-validation of ground truth is needed.

## Changes

### 1. Ship pre-extracted, labeled frames (biggest time saver)

Add to `environment/data/<SCENARIO>/`:

- `frames/tick_%06d.png` — a curated subset, not every tick:
  - **settled frames** (well after all pops finish) for each scenario — the frames positions must be measured from;
  - **one dense pop window**: every tick 0..48 after a single named arrival;
  - **one dense pulse window**: every tick 0..30 of a single named edge traversal;
  - **one interruption window** covering the prior pulse + the interrupting pulse.
- `measurement_index.json` — names those windows explicitly:
  ```json
  {
    "settled_ticks": {"BAD_GADGET": 520, "DISAGREE": 300, "IBGP_RR": 340},
    "pop_window":   {"scenario": "...", "routerId": "...", "arrival_tick": N, "ticks": [...]},
    "pulse_window": {"scenario": "...", "edge": ["...","..."], "start_tick": N, "ticks": [...]},
    "interrupt_window": {"scenario": "...", "edge": [...], "prior_start_tick": 21, "interrupt_tick": 38}
  }
  ```

This directly kills failure modes 1 and 6 from the review (sampling during pop overshoot; not knowing which frames are stable) without revealing a single numeric answer.

`video.mp4` stays for context but is no longer required; instruction says the frames are the canonical measurement surface. BAD_GADGET's capture is truncated to the first ~600 ticks (its 1418-event oscillating tail adds runtime, not signal).

### 2. Labeled color probes instead of colour hunting

Add `environment/data/color_probes.json`: for each of the five statuses, a `(scenario, tick, routerId)` triple where that status is on screen in a supplied settled frame. The agent still has to compute the node's position and sample the pixel — but no longer has to hunt three videos for where `rr-relay-only` ever appears. Instruction gains one hard line: *"every colour must be pixel-sampled; semantically plausible colours will not match."* This kills failure mode 2, which cost both agents an entire test for zero conceptual reason.

### 3. Disclose functional *forms*, never constants

`instruction.md` gains a "Model forms" section:

- layout: `r = a + b*tier`, `theta = theta0 + c*tier + 2*PI*i/n`, `(x, y) = (600, 400) + r*(cos, sin)` — `a`, `b`, `c`, `theta0`, and the within-tier sort key are for the agent to recover;
- pop: `scale(t) = 1 + A*exp(-zeta*omega*t)*cos(omega*sqrt(1-zeta^2)*t + phi)`, finite duration then rest — `A`, `zeta`, `omega`, `phi`, duration unknown;
- pulse: a single cubic-Bezier easing `(x1,y1,x2,y2)` over a fixed tick duration, **not** a CSS preset;
- stagger: exact non-negative integer, linear in `edgeRank`;
- interruption: continue-not-reset composition of the same easing.

This converts an open-ended "what family is this?" search into a **parameter-fitting** job — the part the review found genuinely discriminating (both agents were 12–70x over tolerance on the constants even when they knew the shape). It is the main lever taking expert time from 18h to ~2h.

### 4. Point the stagger at the data

Instruction states explicitly that `events.ndjson` fan-out events carry an `edgeRank` and share a causal tick origin, so the delay is measurable as a tick difference rather than guessed (both agents guessed: 3 and 1 vs golden 8).

### 5. task.toml

- `expert_time_estimate_hours = 18` -> `3`
- rewrite `difficulty_explanation` to claim precision-of-fit and cross-topology generalization (the true crux) rather than "must discover the functional family"
- rewrite `solution_explanation` to describe the shortened measurement path
- `verification_explanation` unchanged in substance (static diff against frozen fixtures)
- `[agent] timeout_sec = 3600` unchanged; `[environment] build_timeout_sec` unchanged — image only gains a few hundred small PNGs, and no build step runs in it.

### 6. Tolerances

Unchanged: `position_px = 1.5`, `scale = 0.02`, `progress = 0.02`, colour exact. The review explicitly found tolerances are not doing the discriminating work, and an honest fit lands well inside them.

## Files changed

| File | Change |
| --- | --- |
| `task/instruction.md` | rewrite: frames-first measurement surface, model-form section, colour-probe pointer, stagger-from-events pointer |
| `task/environment/data/<SCENARIO>/frames/*.png` | new curated frame sets |
| `task/environment/data/<SCENARIO>/measurement_index.json` | new |
| `task/environment/data/color_probes.json` | new |
| `task/environment/data/BAD_GADGET/{video.mp4,events.ndjson,tick_index.json}` | truncated to first ~600 ticks |
| `task/environment/Dockerfile` | unchanged apart from comment noting the frames payload |
| `task/task.toml` | time estimate + difficulty/solution explanations |
| `task/tests/**` | **unchanged** (verifier + fixtures stay as-is) |
| `task/solution/**` | `solve.sh` / `visual-rules.mjs` / `dump_evaluations.mjs` unchanged; oracle still passes |

## How the frames get produced

Regenerated in this repo from the existing engine + canvas (`src/lib/bgp/engine.ts`, `src/components/BgpCanvas.tsx`, `window.__bgpViz.seek`) with the existing Playwright/Puppeteer capture path, so every frame is pixel-identical to the videos already shipped and to the golden fixture values.

## Delivery

Rebuild the full `dynamo-1a40bbc-software-engineering/task/` tree with these edits (git metadata and `jobs/` excluded) and hand back a downloadable `bgp-visual-rules-task-v3.zip`, plus a written summary of every file changed and why, mapped back to the review's numbered failure modes.
