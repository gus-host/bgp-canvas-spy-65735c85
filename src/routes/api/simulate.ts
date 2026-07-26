import { createFileRoute } from "@tanstack/react-router";
import { simulateResponse } from "@/lib/bgp/stream";

export const Route = createFileRoute("/api/simulate")({
  server: {
    handlers: {
      GET: async ({ request }) => simulateResponse(request),
      POST: async ({ request }) => simulateResponse(request),
      OPTIONS: async () =>
        new Response(null, {
          status: 204,
          headers: {
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
            "Access-Control-Allow-Headers": "*",
          },
        }),
    },
  },
});
