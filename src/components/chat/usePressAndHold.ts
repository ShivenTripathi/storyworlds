"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Press-and-hold gesture: hold a pointer down for `durationMs` to fire
 * `onComplete`. Exposes live `progress` (0–1) for a ring/bar, and cancels
 * cleanly on pointer-up/leave before completion. Shared by the chat
 * spoiler-acknowledgement panel and SpoilerVeil.
 */
export function usePressAndHold(onComplete: () => void, durationMs = 600) {
  const [progress, setProgress] = useState(0);
  const [pressing, setPressing] = useState(false);
  const startRef = useRef<number | null>(null);
  const rafRef = useRef<number | null>(null);
  const doneRef = useRef(false);

  const clear = useCallback(() => {
    if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    rafRef.current = null;
    startRef.current = null;
  }, []);

  // Holds the latest `tick` so it can recursively schedule itself via
  // requestAnimationFrame without being referenced before its own
  // declaration finishes (mirrors the runFetchRef pattern in useOverlay).
  const tickRef = useRef<() => void>(() => {});

  const tick = useCallback(() => {
    if (startRef.current == null) return;
    const elapsed = performance.now() - startRef.current;
    const next = Math.min(1, elapsed / durationMs);
    setProgress(next);
    if (next >= 1) {
      if (!doneRef.current) {
        doneRef.current = true;
        clear();
        setPressing(false);
        onComplete();
      }
      return;
    }
    rafRef.current = requestAnimationFrame(() => tickRef.current());
  }, [clear, durationMs, onComplete]);

  useEffect(() => {
    tickRef.current = tick;
  }, [tick]);

  const start = useCallback(() => {
    doneRef.current = false;
    startRef.current = performance.now();
    setPressing(true);
    setProgress(0);
    rafRef.current = requestAnimationFrame(() => tickRef.current());
  }, []);

  const cancel = useCallback(() => {
    if (doneRef.current) return;
    clear();
    setPressing(false);
    setProgress(0);
  }, [clear]);

  useEffect(() => clear, [clear]);

  const handlers = {
    onPointerDown: (e: React.PointerEvent) => {
      e.preventDefault();
      start();
    },
    onPointerUp: cancel,
    onPointerLeave: cancel,
    onPointerCancel: cancel,
  };

  return { progress, pressing, handlers };
}
