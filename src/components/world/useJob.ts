"use client";

import { useEffect, useState } from "react";
import { fetchJob } from "./api";
import type { Job } from "./types";

const POLL_MS = 3000;
const MAX_STREAM_ERRORS = 2;

function isTerminal(status: Job["status"]): boolean {
  return status === "completed" || status === "failed";
}

/**
 * Tracks a background analysis job by id: opens an SSE stream at
 * /api/jobs/{id}/stream, and falls back to 3s polling of
 * GET /api/jobs/{id} if the stream errors twice in a row (or if
 * EventSource isn't available). Stops on terminal status and cleans up
 * on unmount / jobId change.
 */
export function useJob(jobId: string | null): { job: Job | null; done: boolean } {
  const [job, setJob] = useState<Job | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    // Reset immediately when the tracked jobId changes (or clears) so a
    // stale terminal job never lingers into the next one's UI.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setJob(null);
    setDone(false);

    if (!jobId) return;
    const id = jobId;

    let cancelled = false;
    let terminal = false;
    let es: EventSource | null = null;
    let pollTimer: ReturnType<typeof setTimeout> | null = null;
    let errorCount = 0;

    function applyJob(next: Job) {
      if (cancelled) return;
      setJob(next);
      if (isTerminal(next.status)) {
        terminal = true;
        setDone(true);
        cleanup();
      }
    }

    function cleanup() {
      if (es) {
        es.close();
        es = null;
      }
      if (pollTimer) {
        clearTimeout(pollTimer);
        pollTimer = null;
      }
    }

    function startPolling() {
      if (es) {
        es.close();
        es = null;
      }
      const tick = () => {
        if (cancelled) return;
        fetchJob(id)
          .then(({ job: j }) => applyJob(j))
          .catch(() => {
            // best-effort — try again on the next tick
          })
          .finally(() => {
            if (!cancelled && !terminal) {
              pollTimer = setTimeout(tick, POLL_MS);
            }
          });
      };
      tick();
    }

    if (typeof EventSource === "undefined") {
      startPolling();
    } else {
      es = new EventSource(`/api/jobs/${id}/stream`);
      es.onmessage = (event) => {
        errorCount = 0;
        try {
          const parsed = JSON.parse(event.data) as Job;
          applyJob(parsed);
        } catch {
          // malformed event — ignore, wait for the next one
        }
      };
      es.onerror = () => {
        errorCount += 1;
        if (errorCount >= MAX_STREAM_ERRORS) {
          startPolling();
        }
      };
    }

    return () => {
      cancelled = true;
      cleanup();
    };
  }, [jobId]);

  return { job, done };
}
