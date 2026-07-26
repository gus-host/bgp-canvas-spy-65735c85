# Reference capture pipeline

1. `bun run dev` (or serve a production build) so `/api/simulate` is reachable.
2. `npm i -D puppeteer` (capture-only dependency).
3. `node tools/capture-reference.mjs BAD_GADGET http://localhost:8080 out/`
   Repeat for `DISAGREE` and `IBGP_RR`.

Each run writes:

- `out/<SCENARIO>/frames/%06d.png` — one PNG per tick, cropped to the canvas
  capture region (1200x800).
- `out/<SCENARIO>/tick_index.json` — frame -> tick mapping plus capture-region
  pixel dimensions.
- `out/<SCENARIO>/events.ndjson` — the paired event log (Lamport `seq`, `tick`).

Mux to a lossless master at 60 FPS (1 tick = 1 frame):

```
ffmpeg -framerate 60 -i frames/%06d.png -c:v ffv1 -level 3 -pix_fmt rgb24 SCENARIO.mkv
ffmpeg -framerate 60 -i frames/%06d.png -c:v prores_ks -profile:v 4444 -pix_fmt yuva444p10le SCENARIO.mov
```

Ground-truth values a solver must recover (kept out of the delivered bundle):

| Rule | Value |
| --- | --- |
| Layout sort key | ascending Router ID string |
| Tier radii | 130 + 115 * tier, angular offset PI/7 per tier |
| Pop | A=0.42, zeta=0.23, omega=0.55, phi=0, 48 ticks |
| Pulse Bezier | (0.17, 0.89, 0.71, 0.06), 30 ticks |
| Stagger | 8 ticks * outgoing edge rank |
| Colors | see `STATUS_COLORS` in `src/lib/viz/visual-rules.ts` |
