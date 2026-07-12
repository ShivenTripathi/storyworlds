"use client";

import { useEffect, useRef, useState } from "react";
import {
  FACES,
  FONT_SIZE_MAX,
  FONT_SIZE_MIN,
  LINE_HEIGHTS,
  MEASURES,
  PAGE_VIEWS,
  READER_THEMES,
  type ReaderSettingsState,
} from "./settings";

interface ReaderSettingsProps {
  settings: ReaderSettingsState;
  onChange: (next: ReaderSettingsState) => void;
  /** Extra classes for the trigger wrapper (e.g. to position a floating fab). */
  className?: string;
  /** Use a compact icon-only trigger (for the mobile floating cluster). */
  compact?: boolean;
}

export function ReaderSettings({
  settings,
  onChange,
  className,
  compact,
}: ReaderSettingsProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: PointerEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        setOpen(false);
      }
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function patch(partial: Partial<ReaderSettingsState>) {
    onChange({ ...settings, ...partial });
  }

  return (
    <div ref={rootRef} className={`relative ${className ?? ""}`}>
      <button
        type="button"
        aria-label="Reading settings"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className={
          compact
            ? "flex h-11 w-11 items-center justify-center rounded-full border font-display text-base shadow-lg backdrop-blur focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            : "flex h-9 min-w-9 items-center justify-center rounded-full border px-3 font-display text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        }
        style={{
          background: "var(--card)",
          borderColor: "var(--border)",
          color: "var(--card-foreground)",
        }}
      >
        Aa
      </button>

      {open ? (
        <div
          role="dialog"
          aria-label="Reading settings"
          className="absolute top-full right-0 z-50 mt-2 w-72 max-w-[calc(100vw-2rem)] rounded-lg border p-4 shadow-xl"
          style={{
            background: "var(--card)",
            borderColor: "var(--border)",
            color: "var(--card-foreground)",
          }}
        >
          <div className="space-y-5">
            <section>
              <p className="eyebrow mb-2">Theme</p>
              <div className="grid grid-cols-4 gap-2">
                {READER_THEMES.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    aria-label={`${t.label} theme`}
                    aria-pressed={settings.theme === t.id}
                    onClick={() => patch({ theme: t.id })}
                    className="flex h-11 flex-col items-center justify-center gap-1 rounded-md border-2 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                    style={{
                      background: t.bg,
                      borderColor:
                        settings.theme === t.id
                          ? "var(--world-accent)"
                          : "var(--border)",
                    }}
                  >
                    <span
                      className="h-2 w-2 rounded-full"
                      style={{ background: t.fg }}
                    />
                  </button>
                ))}
              </div>
              <div className="mt-1 grid grid-cols-4 gap-2">
                {READER_THEMES.map((t) => (
                  <span
                    key={t.id}
                    className="text-center font-ui text-[10px] opacity-70"
                  >
                    {t.label}
                  </span>
                ))}
              </div>
            </section>

            <section>
              <label htmlFor="reader-face" className="eyebrow mb-2 block">
                Face
              </label>
              <select
                id="reader-face"
                value={settings.face}
                onChange={(e) =>
                  patch({ face: e.target.value as ReaderSettingsState["face"] })
                }
                className="w-full rounded-md border bg-transparent px-2 py-2 font-ui text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                style={{ borderColor: "var(--border)" }}
              >
                {FACES.map((f) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </section>

            <section>
              <p className="eyebrow mb-2">Size</p>
              <div className="flex items-center justify-between">
                <button
                  type="button"
                  aria-label="Decrease text size"
                  disabled={settings.fontSize <= FONT_SIZE_MIN}
                  onClick={() =>
                    patch({
                      fontSize: Math.max(FONT_SIZE_MIN, settings.fontSize - 1),
                    })
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-md border font-ui text-base focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:opacity-30"
                  style={{ borderColor: "var(--border)" }}
                >
                  −
                </button>
                <span className="font-ui text-sm tabular-nums">
                  {settings.fontSize}px
                </span>
                <button
                  type="button"
                  aria-label="Increase text size"
                  disabled={settings.fontSize >= FONT_SIZE_MAX}
                  onClick={() =>
                    patch({
                      fontSize: Math.min(FONT_SIZE_MAX, settings.fontSize + 1),
                    })
                  }
                  className="flex h-9 w-9 items-center justify-center rounded-md border font-ui text-base focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none disabled:opacity-30"
                  style={{ borderColor: "var(--border)" }}
                >
                  +
                </button>
              </div>
            </section>

            <section>
              <p className="eyebrow mb-2">Line height</p>
              <div className="flex gap-2">
                {LINE_HEIGHTS.map((lh) => (
                  <button
                    key={lh}
                    type="button"
                    aria-pressed={settings.lineHeight === lh}
                    onClick={() => patch({ lineHeight: lh })}
                    className="flex-1 rounded-md border py-2 font-ui text-xs focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                    style={{
                      borderColor:
                        settings.lineHeight === lh
                          ? "var(--world-accent)"
                          : "var(--border)",
                      color:
                        settings.lineHeight === lh
                          ? "var(--world-accent)"
                          : "inherit",
                    }}
                  >
                    {lh.toFixed(2).replace(/0$/, "")}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <p className="eyebrow mb-2">Measure</p>
              <div className="flex gap-2">
                {MEASURES.map((m) => (
                  <button
                    key={m.id}
                    type="button"
                    aria-pressed={settings.measure === m.id}
                    onClick={() => patch({ measure: m.id })}
                    className="flex-1 rounded-md border py-2 font-ui text-xs focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                    style={{
                      borderColor:
                        settings.measure === m.id
                          ? "var(--world-accent)"
                          : "var(--border)",
                      color:
                        settings.measure === m.id
                          ? "var(--world-accent)"
                          : "inherit",
                    }}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </section>

            <section>
              <p className="eyebrow mb-2">Page view</p>
              <div className="flex gap-2">
                {PAGE_VIEWS.map((pv) => {
                  const active = (settings.pageView ?? "single") === pv.id;
                  return (
                    <button
                      key={pv.id}
                      type="button"
                      aria-pressed={active}
                      onClick={() => patch({ pageView: pv.id })}
                      className="flex-1 rounded-md border py-2 font-ui text-xs focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
                      style={{
                        borderColor: active
                          ? "var(--world-accent)"
                          : "var(--border)",
                        color: active ? "var(--world-accent)" : "inherit",
                      }}
                    >
                      {pv.label}
                    </button>
                  );
                })}
              </div>
            </section>
          </div>
        </div>
      ) : null}
    </div>
  );
}
