"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { playCue } from "@/lib/sound";

type FeedbackKind = "general" | "idea" | "bug" | "praise";
type Sentiment = "up" | "down";

interface CapturedContext {
  bookId?: string;
  viewport: { width: number; height: number };
  userAgent: string;
  referrer?: string;
}

const KIND_META: Record<FeedbackKind, { label: string; prompt: string }> = {
  general: { label: "General", prompt: "Tell us what you think." },
  idea: { label: "Idea", prompt: "What would you love to see?" },
  bug: { label: "Bug", prompt: "What happened? Steps to reproduce?" },
  praise: { label: "Praise", prompt: "Tell us what you think." },
};

const KINDS: FeedbackKind[] = ["general", "idea", "bug", "praise"];

const THANK_YOU_DISMISS_MS = 2800;

type Step = "form" | "submitting" | "success";

/**
 * Site-wide "Feedback" trigger + dialog. Lives in the app header (see
 * AppHeader) so it's reachable from every authed page — except the
 * immersive reader, which hides the whole chrome anyway.
 *
 * On open, tracing about what the reader was doing is captured silently
 * (pathname, viewport, user agent, referrer, and the book id if the
 * pathname is a /books/[id]* route) and posted alongside the message — the
 * reader is never asked for any of it.
 */
export function FeedbackWidget() {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<FeedbackKind>("general");
  const [sentiment, setSentiment] = useState<Sentiment | null>(null);
  const [message, setMessage] = useState("");
  const [step, setStep] = useState<Step>("form");
  const [error, setError] = useState<string | null>(null);
  const [context, setContext] = useState<CapturedContext | null>(null);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const bookId = useMemo(() => {
    const m = pathname?.match(/^\/books\/([^/]+)/);
    return m ? m[1] : undefined;
  }, [pathname]);

  function resetForm() {
    setKind("general");
    setSentiment(null);
    setMessage("");
    setStep("form");
    setError(null);
  }

  function openWidget() {
    // Silent tracing capture — no prompt, no consent dialog. Read at open
    // time (a user gesture, so this is an event-handler read, not an effect).
    setContext({
      bookId,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      userAgent: navigator.userAgent,
      referrer: document.referrer || undefined,
    });
    setOpen(true);
  }

  function closeWidget() {
    setOpen(false);
    resetForm();
    triggerRef.current?.focus();
  }

  // Focus trap + Escape-to-close, active only while the dialog is open.
  useEffect(() => {
    if (!open) return;

    const dialog = dialogRef.current;
    dialog?.querySelector<HTMLElement>("[data-autofocus]")?.focus();

    function focusableEls(): HTMLElement[] {
      if (!dialog) return [];
      return Array.from(
        dialog.querySelectorAll<HTMLElement>(
          'button:not(:disabled), [href], input:not(:disabled), textarea:not(:disabled), select:not(:disabled), [tabindex]:not([tabindex="-1"])',
        ),
      );
    }

    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        closeWidget();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusableEls();
      if (els.length === 0) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- closeWidget is stable enough for this trap; re-running per render would just re-bind the same listener
  }, [open, step]);

  // After a successful submit, auto-dismiss the thank-you state — a
  // deliberate UI timer sync (same convention as Reader.tsx's chrome
  // auto-hide), not state derived from props/state already in React.
  useEffect(() => {
    if (step !== "success") return;
    const t = setTimeout(() => {
      closeWidget();
    }, THANK_YOU_DISMISS_MS);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional one-shot timer keyed only to `step`
  }, [step]);

  async function handleSubmit() {
    // Free-form is optional — but send *something* (a note or a thumbs).
    if (!message.trim() && !sentiment) {
      setError("Add a note or pick a thumbs up/down.");
      textareaRef.current?.focus();
      return;
    }
    setError(null);
    setStep("submitting");
    try {
      const res = await fetch("/api/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind,
          sentiment: sentiment ?? undefined,
          message: message.trim(),
          pathname: pathname ?? undefined,
          context,
        }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as {
          error?: { message?: string };
        } | null;
        throw new Error(
          body?.error?.message ?? "Couldn't send that. Please try again.",
        );
      }
      setStep("success");
      playCue("success");
    } catch (e) {
      setStep("form");
      setError(
        e instanceof Error
          ? e.message
          : "Couldn't send that. Please try again.",
      );
    }
  }

  const busy = step === "submitting";

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={openWidget}
        className="rounded-full px-3 py-1.5 font-ui text-sm text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      >
        Feedback
      </button>

      {open ? (
        // Backdrop: click-to-close is a mouse convenience; the dialog is
        // also dismissible via Escape and the Close/Cancel controls, so this
        // element needs no keyboard listener of its own.
        // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-4"
          onClick={() => !busy && closeWidget()}
        >
          {/* Stop propagation so clicks inside the dialog don't close it. */}
          {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
          <div
            ref={dialogRef}
            role="dialog"
            aria-modal="true"
            aria-label="Send feedback"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl"
          >
            {step === "success" ? (
              <div className="py-4 text-center">
                <p className="eyebrow mb-2">THANK YOU</p>
                <h2 className="font-display text-2xl">
                  Got it — we&apos;re listening.
                </h2>
                <p className="mt-3 font-ui text-sm text-muted-foreground">
                  Your note just landed with the people building this.
                </p>
                <button
                  type="button"
                  data-autofocus
                  onClick={closeWidget}
                  className="mt-6 min-h-11 rounded-full bg-[var(--primary)] px-5 py-2 font-ui text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90"
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <p className="eyebrow">FEEDBACK</p>
                <h2 className="mt-1 font-display text-2xl">
                  What&apos;s on your mind?
                </h2>

                <fieldset className="mt-5" disabled={busy}>
                  <legend className="mb-2 block font-ui text-xs text-muted-foreground">
                    What kind of feedback is this?
                  </legend>
                  <div
                    role="radiogroup"
                    aria-label="Feedback type"
                    className="grid grid-cols-2 gap-2 sm:grid-cols-4"
                  >
                    {KINDS.map((k) => (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={kind === k}
                        data-autofocus={k === "general" ? true : undefined}
                        onClick={() => setKind(k)}
                        className={`min-h-11 rounded-md border px-2 py-2 font-ui text-sm transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none ${
                          kind === k
                            ? "border-[var(--primary)] bg-[var(--primary)]/10 text-foreground"
                            : "border-border text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {KIND_META[k].label}
                      </button>
                    ))}
                  </div>
                </fieldset>

                <fieldset className="mt-4" disabled={busy}>
                  <legend className="mb-2 block font-ui text-xs text-muted-foreground">
                    How do you feel about it? (optional)
                  </legend>
                  <div
                    role="radiogroup"
                    aria-label="Sentiment"
                    className="flex items-center gap-2"
                  >
                    <button
                      type="button"
                      role="radio"
                      aria-checked={sentiment === "up"}
                      aria-label="Thumbs up"
                      onClick={() =>
                        setSentiment((s) => (s === "up" ? null : "up"))
                      }
                      className={`flex min-h-11 min-w-11 items-center justify-center rounded-full border text-lg transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none ${
                        sentiment === "up"
                          ? "border-[var(--primary)] bg-[var(--primary)]/10"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span aria-hidden="true">👍</span>
                    </button>
                    <button
                      type="button"
                      role="radio"
                      aria-checked={sentiment === "down"}
                      aria-label="Thumbs down"
                      onClick={() =>
                        setSentiment((s) => (s === "down" ? null : "down"))
                      }
                      className={`flex min-h-11 min-w-11 items-center justify-center rounded-full border text-lg transition-colors duration-150 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none ${
                        sentiment === "down"
                          ? "border-[var(--primary)] bg-[var(--primary)]/10"
                          : "border-border text-muted-foreground hover:text-foreground"
                      }`}
                    >
                      <span aria-hidden="true">👎</span>
                    </button>
                  </div>
                </fieldset>

                <label className="mt-4 block">
                  <span className="mb-1 block font-ui text-xs text-muted-foreground">
                    {KIND_META[kind].prompt}{" "}
                    <span className="opacity-70">(optional)</span>
                  </span>
                  <textarea
                    ref={textareaRef}
                    value={message}
                    onChange={(e) => setMessage(e.target.value)}
                    disabled={busy}
                    maxLength={4000}
                    rows={4}
                    className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 font-ui text-sm text-foreground outline-none focus:border-[var(--ring)] disabled:opacity-60"
                  />
                </label>

                {error ? (
                  <p className="mt-3 font-ui text-xs text-[var(--destructive)]">
                    {error}
                  </p>
                ) : null}

                <div className="mt-6 flex items-center justify-end gap-3">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={closeWidget}
                    className="min-h-11 rounded-full px-4 py-2 font-ui text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    disabled={busy || (!message.trim() && !sentiment)}
                    onClick={handleSubmit}
                    className="min-h-11 rounded-full bg-[var(--primary)] px-5 py-2 font-ui text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {busy ? "Sending…" : "Submit"}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </>
  );
}
