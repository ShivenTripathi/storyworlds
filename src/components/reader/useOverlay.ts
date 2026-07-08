import { useCallback, useEffect, useRef, useState } from "react";
import { fetchOverlay, WorldApiError } from "@/components/world/api";
import type { Overlay } from "@/components/world/types";

const DEBOUNCE_MS = 600;
const POLL_INTERVAL_MS = 2500;
const MAX_POLLS = 10;

export type OverlayState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "pending"; attempt: number }
  | { status: "ready"; overlay: Overlay }
  | { status: "error" }
  /** The world isn't in a state to have overlays (not completed, 404, etc.) — render nothing, no noise. */
  | { status: "unavailable" };

/**
 * Fetches (and polls for) the scene overlay of a single chunk, with an
 * in-memory cache so paging back to a page already seen this session is
 * instant. Debounces chunk-index changes so quick paging doesn't spam the
 * endpoint, and ignores responses for requests that are no longer current.
 *
 * Shared by Reader (for the inline ChapterPlate) and WorldRail's SceneView
 * (via the `preloaded` prop) so a single page never fires two overlay
 * fetches.
 */
export function useOverlay(
  bookId: string,
  chunkIdx: number,
  options?: { enabled?: boolean },
) {
  const enabled = options?.enabled ?? true;
  const [state, setState] = useState<OverlayState>({ status: "idle" });

  const cacheRef = useRef<Map<number, OverlayState>>(new Map());
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pollRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Bumped on every new fetch attempt; async callbacks check they're still
  // current before touching state, so stale/late responses are dropped.
  const requestSeq = useRef(0);

  const clearTimers = useCallback(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (pollRef.current) clearTimeout(pollRef.current);
    debounceRef.current = null;
    pollRef.current = null;
  }, []);

  // Holds the latest `runFetch` so the recursive poll timeout below can call
  // it without referencing the `const` before its declaration finishes
  // (and without re-registering the timeout every render).
  const runFetchRef = useRef<(idx: number, seq: number, attempt: number) => void>(
    () => {},
  );

  const runFetch = useCallback(
    (idx: number, seq: number, attempt: number) => {
      fetchOverlay(bookId, idx)
        .then((res) => {
          if (requestSeq.current !== seq) return; // stale
          if (res.overlay) {
            const ready: OverlayState = { status: "ready", overlay: res.overlay };
            cacheRef.current.set(idx, ready);
            setState(ready);
            return;
          }
          // still generating
          if (attempt >= MAX_POLLS) {
            const errored: OverlayState = { status: "error" };
            setState(errored);
            return;
          }
          setState({ status: "pending", attempt });
          pollRef.current = setTimeout(
            () => runFetchRef.current(idx, seq, attempt + 1),
            POLL_INTERVAL_MS,
          );
        })
        .catch((err) => {
          if (requestSeq.current !== seq) return; // stale
          const code = err instanceof WorldApiError ? err.code : undefined;
          const httpStatus = err instanceof WorldApiError ? err.status : 0;
          const terminal =
            httpStatus === 404 ||
            httpStatus === 409 ||
            code === "world_not_ready";
          const next: OverlayState = terminal
            ? { status: "unavailable" }
            : { status: "error" };
          if (terminal) cacheRef.current.set(idx, next);
          setState(next);
        });
    },
    [bookId],
  );

  useEffect(() => {
    runFetchRef.current = runFetch;
  }, [runFetch]);

  const startFetch = useCallback(
    (idx: number) => {
      const seq = ++requestSeq.current;
      setState({ status: "loading" });
      runFetch(idx, seq, 1);
    },
    [runFetch],
  );

  useEffect(() => {
    clearTimers();

    if (!enabled) {
      requestSeq.current += 1;
      // Deliberate sync of the "disabled" external state into local state,
      // not a derivation of props/state already in React.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setState({ status: "idle" });
      return;
    }

    const cached = cacheRef.current.get(chunkIdx);
    if (cached) {
      // Bump the sequence so any in-flight fetch for a previous index is
      // ignored, then serve the cached terminal state immediately.
      requestSeq.current += 1;
      setState(cached);
      return;
    }

    debounceRef.current = setTimeout(() => {
      startFetch(chunkIdx);
    }, DEBOUNCE_MS);

    return () => {
      clearTimers();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- startFetch/clearTimers are stable for a given bookId
  }, [chunkIdx, bookId, enabled]);

  useEffect(() => {
    return () => clearTimers();
  }, [clearTimers]);

  const retry = useCallback(() => {
    cacheRef.current.delete(chunkIdx);
    clearTimers();
    startFetch(chunkIdx);
  }, [chunkIdx, clearTimers, startFetch]);

  return { state, retry };
}
