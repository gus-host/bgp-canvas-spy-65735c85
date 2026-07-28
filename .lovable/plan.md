## What's actually failing

`capture_outputs.mjs` gets `<!DOCTYPE html>` back from `/api/public/simulate`, so `JSON.parse` on the first NDJSON line throws.

Cause (confirmed from the build log + config):
- The build ends in `[nitro] (preset: cloudflare-module)` and emits a Cloudflare **Worker** at `.output/server/index.mjs` + `wrangler.json`.
- `npm run preview` is plain `vite preview`, which only serves the **static client assets** in `.output/public`. There is no server runtime, so every unknown path — including `/api/public/simulate` — falls through to `index.html`. That's the HTML the script parsed.
- The readiness loop hides this: it only checks `statusCode < 500`, and the HTML fallback returns 200.

Nothing is wrong with the engine, the routes, or `window.__bgpViz`. Only the way the app is served in `solve.sh`.

## Fix

Build for a Node target and run the real nitro server instead of `vite preview`.

In `solve.sh`, replace the build + preview block with:

```bash
NITRO_PRESET=node-server npm run build

PORT=8080 nohup node .output/server/index.mjs > /tmp/app.log 2>&1 &
```

`@lovable.dev/vite-tanstack-config` sets nitro's `defaultPreset: "cloudflare-module"`, which `NITRO_PRESET` overrides — so no config file change is needed and no wrangler/network is required. `node-server` output is a self-contained Node server honoring `PORT`, and it serves the TanStack server routes (`/api/simulate`, `/api/public/simulate`) plus SSR.

## Harden the readiness probe

Make the wait loop assert the endpoint really returns NDJSON, so a static-HTML regression fails loudly instead of surfacing as a JSON parse error 4 minutes later:

```bash
node -e "
  const http = require('http');
  const req = http.get('http://localhost:8080/api/public/simulate?scenario=BAD_GADGET&rate_ms=0', res => {
    const ct = res.headers['content-type'] || '';
    process.exit(res.statusCode === 200 && ct.includes('ndjson') ? 0 : 1);
  });
  req.on('error', () => process.exit(1));
  req.setTimeout(2000, () => { req.destroy(); process.exit(1); });
"
```

and after the loop, exit non-zero with `cat /tmp/app.log` if it never became ready.

## Alternative (if you'd rather not change the build target)

`npm run dev -- --port 8080` also serves the API routes correctly and skips the ~7-minute production build entirely. Downside: it's the dev pipeline, not the artifact the task nominally grades. Use it only if the oracle's runtime budget is tight.

## Optional repo change

Add a `"start": "node .output/server/index.mjs"` script so `solve.sh` doesn't hardcode the output path. I can add that if you want it in the project; otherwise this plan is purely edits to your `solve.sh`, which lives outside this repo.

## Note on capture timing

Once the API returns real NDJSON, `capture_outputs.mjs` will proceed to the Puppeteer phase. If anything fails there it'll be a separate issue (`window.__bgpViz.ready` gating) — the current traceback stops well before that.
