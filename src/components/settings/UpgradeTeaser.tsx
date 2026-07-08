"use client";

import { useState } from "react";
import type { CheckoutResponse } from "./types";

type CheckoutState = "idle" | "loading" | "unavailable" | "error";

/**
 * Attempt-free upgrade affordance: calls nothing until clicked. If billing
 * is enabled, redirects to the checkout URL. If the endpoint reports
 * `billing_disabled` (503, expected in the zero-cost profile), falls back
 * to the quiet teaser copy in place.
 */
export function UpgradeTeaser() {
  const [state, setState] = useState<CheckoutState>("idle");

  async function handleUpgrade() {
    setState("loading");
    try {
      const res = await fetch("/api/billing/checkout", { method: "POST" });
      if (res.status === 503) {
        setState("unavailable");
        return;
      }
      if (!res.ok) throw new Error("checkout failed");
      const { url } = (await res.json()) as CheckoutResponse;
      window.location.href = url;
    } catch {
      setState("error");
    }
  }

  if (state === "unavailable" || state === "error") {
    return <FreeTeaserCopy />;
  }

  return (
    <div className="rounded-lg border border-[var(--world-frame)] bg-[var(--world-surface)] p-5">
      <p className="font-display text-lg">The Reader plan</p>
      <p className="font-ui mt-1 text-sm text-[var(--muted-foreground)]">
        Unlimited shelf, more worlds per day — arrives soon.
      </p>
      <button
        onClick={handleUpgrade}
        disabled={state === "loading"}
        className="font-ui mt-4 rounded-full bg-[var(--world-accent)] px-5 py-2 text-sm font-medium text-[var(--world-accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-60"
      >
        {state === "loading" ? "One moment…" : "Upgrade"}
      </button>
    </div>
  );
}

function FreeTeaserCopy() {
  return (
    <div className="rounded-lg border border-[var(--world-frame)] bg-[var(--world-surface)] p-5">
      <p className="font-display text-lg">The Reader plan</p>
      <p className="font-ui mt-1 text-sm text-[var(--muted-foreground)]">
        Unlimited shelf, more worlds per day — arrives soon.
      </p>
    </div>
  );
}
