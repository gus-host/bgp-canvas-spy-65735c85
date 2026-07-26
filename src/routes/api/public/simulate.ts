import { createFileRoute } from "@tanstack/react-router";
import { simulateResponse } from "@/lib/bgp/stream";

/** Public alias of /api/simulate for external harnesses (read-only, no PII). */
export const Route = createFileRoute("/api/public/simulate")({
  server: {
    handlers: {
      GET: async ({ request }) => simulateResponse(request),
      POST: async ({ request }) => simulateResponse(request),
    },
  },
});
