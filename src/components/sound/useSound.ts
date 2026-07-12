"use client";

import { useCallback, useEffect, useState } from "react";
import { initSound, isMuted, playCue, setMuted, type Cue } from "@/lib/sound";

/** React access to the sound engine: current mute state, a toggle, and play(). */
export function useSound() {
  const [muted, setMutedState] = useState(true);

  useEffect(() => {
    // Read the persisted/localStorage preference only after mount to stay
    // hydration-safe — same post-mount sync convention used elsewhere in this
    // codebase (e.g. ShareButton, Reader).
    initSound();
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setMutedState(isMuted());
  }, []);

  const toggle = useCallback(() => {
    const next = !isMuted();
    setMuted(next); // plays a confirmation cue when un-muting
    setMutedState(next);
  }, []);

  const play = useCallback((cue: Cue) => playCue(cue), []);

  return { muted, toggle, play };
}
