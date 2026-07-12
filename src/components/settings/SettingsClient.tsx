"use client";

import { useEffect, useState } from "react";
import { UserButton } from "@clerk/nextjs";
import { UsageMeter } from "./UsageMeter";
import { UpgradeTeaser } from "./UpgradeTeaser";
import type { MeResponse } from "./types";

type LoadState = "loading" | "ready" | "error";

export function SettingsClient() {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loadState, setLoadState] = useState<LoadState>("loading");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/me");
        if (!res.ok) throw new Error("Failed to load account");
        const data = (await res.json()) as MeResponse;
        if (cancelled) return;
        setMe(data);
        setLoadState("ready");
      } catch {
        if (!cancelled) setLoadState("error");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="mx-auto w-full max-w-xl">
      <div className="mb-10">
        <p className="eyebrow mb-2">YOUR ACCOUNT</p>
        <h1 className="font-display text-4xl leading-tight">Settings</h1>
      </div>

      <div className="flex flex-col gap-10">
        <section>
          <p className="eyebrow mb-3">Account</p>
          <div className="flex items-center justify-between rounded-lg border border-border bg-card p-5">
            <div>
              <p className="font-ui text-sm">
                {loadState === "ready" ? (
                  me?.user.email
                ) : loadState === "loading" ? (
                  <span className="text-muted-foreground">Loading…</span>
                ) : (
                  <span className="text-muted-foreground">
                    Email unavailable
                  </span>
                )}
              </p>
              <p className="mt-1 font-ui text-xs text-muted-foreground">
                Manage sign-in &amp; security from the avatar menu.
              </p>
            </div>
            <UserButton />
          </div>
        </section>

        <section>
          <p className="eyebrow mb-3">Your plan</p>
          {loadState === "error" ? (
            <p className="font-ui text-sm text-[var(--destructive)]">
              Account details couldn&apos;t be reached. Try refreshing.
            </p>
          ) : loadState === "loading" ? (
            <p className="font-ui text-sm text-muted-foreground">
              Gathering your plan…
            </p>
          ) : (
            <div className="flex flex-col gap-5">
              <p className="font-display text-2xl">{me?.plan.name}</p>

              <div className="flex flex-col gap-4 rounded-lg border border-border bg-card p-5">
                <UsageMeter
                  label="Uploads"
                  used={me?.todayUsage.uploads ?? 0}
                  limit={me?.limits.uploads ?? 0}
                />
                <UsageMeter
                  label="Chats"
                  used={me?.todayUsage.chats ?? 0}
                  limit={me?.limits.chats ?? 0}
                />
              </div>

              {me?.plan.isFree ? <UpgradeTeaser /> : null}
            </div>
          )}
        </section>

        <section>
          <p className="eyebrow mb-3">Reading defaults</p>
          <p className="font-ui text-sm text-muted-foreground">
            Per-book settings — type, theme, and pacing — live in the
            reader&apos;s Aa menu, next to the text.
          </p>
        </section>
      </div>
    </div>
  );
}
