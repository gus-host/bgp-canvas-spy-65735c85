import { runEngine } from "@/lib/bgp/engine";
import { getTopology } from "@/lib/bgp/topologies";

/**
 * Streams the simulation as chunked newline-delimited JSON.
 * One JSON object per line, flushed incrementally — no WebSocket upgrade.
 */
export function simulateResponse(request: Request): Response {
  const url = new URL(request.url);
  const scenario = url.searchParams.get("scenario") ?? "BAD_GADGET";
  const seed = Number(url.searchParams.get("seed") ?? "1");
  const rate = Math.max(0, Number(url.searchParams.get("rate_ms") ?? "0"));

  const topo = getTopology(scenario, seed);
  const { events } = runEngine(topo);
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      for (const ev of events) {
        controller.enqueue(encoder.encode(JSON.stringify(ev) + "\n"));
        if (rate > 0) await new Promise((r) => setTimeout(r, rate));
      }
      controller.close();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson",
      "Transfer-Encoding": "chunked",
      "Cache-Control": "no-store, no-transform",
      "X-Accel-Buffering": "no",
      "Access-Control-Allow-Origin": "*",
    },
  });
}
