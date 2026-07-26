import { useCallback, useEffect, useRef, useState } from "react";
import type { SimEvent } from "@/lib/bgp/types";

/** Incrementally parses the chunked NDJSON stream from /api/simulate. */
export function useNdjsonSimulation(scenario: string, seed: number) {
  const [events, setEvents] = useState<SimEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const load = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;
    setEvents([]);
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/simulate?scenario=${encodeURIComponent(scenario)}&seed=${seed}`,
        { signal: ctrl.signal },
      );
      if (!res.body) throw new Error("no stream body");
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      const batch: SimEvent[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          batch.push(JSON.parse(line) as SimEvent);
        }
        setEvents([...batch]);
      }
      if (buf.trim()) batch.push(JSON.parse(buf) as SimEvent);
      setEvents([...batch]);
    } catch (e) {
      if ((e as Error).name !== "AbortError") setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, [scenario, seed]);

  useEffect(() => {
    void load();
    return () => abortRef.current?.abort();
  }, [load]);

  return { events, loading, error, reload: load };
}
