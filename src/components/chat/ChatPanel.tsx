"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  ChatSpoilerGateError,
  fetchChatHistory,
  isCapacityError,
  sendChatMessage,
  type ChatMessage,
  type ChatMode,
} from "./types";

const MAX_TEXTAREA_LINES = 4;
const NEAR_BOTTOM_PX = 80;

const STARTER_QUESTIONS = [
  "What are you feeling right now?",
  "What do you make of all this?",
];

interface ChatPanelProps {
  bookId: string;
  entityId: string;
  entityName: string;
  chunkIdx: number;
  initialMessage?: string;
}

type LocalMessage = ChatMessage & { streaming?: boolean; failed?: boolean };

let localIdSeq = 0;
function localId() {
  localIdSeq += 1;
  return `local-${localIdSeq}-${Date.now()}`;
}

/**
 * The character conversation surface: mode toggle (story-so-far / after
 * the ending), message history, streaming composer. Self-contained —
 * fetches its own history per mode and drives its own send/stream cycle.
 */
export function ChatPanel({
  bookId,
  entityId,
  entityName,
  chunkIdx,
  initialMessage,
}: ChatPanelProps) {
  const [mode, setMode] = useState<ChatMode>("story_so_far");
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [historyLoaded, setHistoryLoaded] = useState(false);
  const [input, setInput] = useState(initialMessage ?? "");
  const [sending, setSending] = useState(false);
  const [confirmMode, setConfirmMode] = useState<ChatMode | null>(null);
  const pendingSendRef = useRef<string | null>(null);
  const acknowledgedRef = useRef<Record<ChatMode, boolean>>({
    story_so_far: true,
    after_ending: false,
  });
  const abortRef = useRef<AbortController | null>(null);

  const scrollRef = useRef<HTMLDivElement>(null);
  const stickToBottomRef = useRef(true);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const loadHistory = useCallback(
    async (m: ChatMode) => {
      setHistoryLoaded(false);
      try {
        const { messages: loaded } = await fetchChatHistory(
          bookId,
          entityId,
          m,
        );
        setMessages(loaded);
        // Non-empty after_ending history can only exist if a prior turn
        // already passed the spoiler gate (the server rejects the very
        // first after_ending message without acknowledgeSpoilers) — so
        // reopening this chat (mode switch, remount, page reload) shouldn't
        // re-prompt. This mirrors the server: acknowledgement is really a
        // property of "has this session sent an after_ending message yet."
        if (m === "after_ending" && loaded.length > 0) {
          acknowledgedRef.current.after_ending = true;
        }
        setConfirmMode(
          m === "after_ending" && !acknowledgedRef.current.after_ending
            ? m
            : null,
        );
      } catch {
        setMessages([]);
      } finally {
        setHistoryLoaded(true);
      }
    },
    [bookId, entityId],
  );

  // Mode changed — sync with the server (load that mode's history, which
  // also decides whether the confirm panel needs to show — see loadHistory).
  // Deliberate sync triggered by the `mode` prop, not state derivable from
  // props/state already in React.
  useEffect(() => {
    void loadHistory(mode);
  }, [mode, loadHistory]);

  useEffect(() => {
    return () => abortRef.current?.abort();
  }, []);

  const scrollToBottom = useCallback((behavior: ScrollBehavior = "smooth") => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTo({ top: el.scrollHeight, behavior });
  }, []);

  useEffect(() => {
    if (stickToBottomRef.current)
      scrollToBottom(historyLoaded ? "auto" : "auto");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, historyLoaded]);

  function handleScroll() {
    const el = scrollRef.current;
    if (!el) return;
    stickToBottomRef.current =
      el.scrollHeight - el.scrollTop - el.clientHeight < NEAR_BOTTOM_PX;
  }

  function autosize() {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight || "20");
    const max = lineHeight * MAX_TEXTAREA_LINES;
    el.style.height = `${Math.min(el.scrollHeight, max)}px`;
  }

  useEffect(() => {
    autosize();
  }, [input]);

  const doSend = useCallback(
    async (text: string, acknowledgeOverride?: boolean) => {
      // Once a mode has been acknowledged (see loadHistory/handleConfirmed),
      // every subsequent send in that mode must keep sending the flag — the
      // server has no memory of "this session already confirmed" beyond
      // what each request tells it, so omitting it here is exactly what
      // caused every after_ending message past the first to re-trip the
      // spoiler gate.
      const acknowledgeSpoilers =
        acknowledgeOverride ?? acknowledgedRef.current[mode];
      const userMsg: LocalMessage = {
        id: localId(),
        role: "user",
        content: text,
        createdAt: new Date().toISOString(),
      };
      const assistantId = localId();
      setMessages((prev) => [
        ...prev,
        userMsg,
        {
          id: assistantId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          streaming: true,
        },
      ]);
      stickToBottomRef.current = true;
      setSending(true);

      const controller = new AbortController();
      abortRef.current = controller;

      try {
        await sendChatMessage(bookId, {
          entityId,
          mode,
          message: text,
          chunkIdx,
          acknowledgeSpoilers,
          signal: controller.signal,
          onDelta: (delta) => {
            setMessages((prev) =>
              prev.map((m) =>
                m.id === assistantId ? { ...m, content: m.content + delta } : m,
              ),
            );
          },
        });
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId ? { ...m, streaming: false } : m,
          ),
        );
      } catch (err) {
        if (err instanceof ChatSpoilerGateError) {
          // Drop the optimistic pair and re-prompt for confirmation.
          setMessages((prev) =>
            prev.filter((m) => m.id !== userMsg.id && m.id !== assistantId),
          );
          pendingSendRef.current = text;
          setConfirmMode(mode);
        } else if (isCapacityError(err)) {
          // Daily quota gone (503 at_capacity) or a rate limit tripped (429
          // rate_limited / limit_reached) — the server already wrote a
          // specific, actionable message ("resume after the daily reset",
          // "try again in Ns"); show that instead of the generic wavering
          // bubble so the reader knows this isn't a random failure.
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    streaming: false,
                    failed: true,
                    content: err.message,
                  }
                : m,
            ),
          );
        } else {
          setMessages((prev) =>
            prev.map((m) =>
              m.id === assistantId
                ? {
                    ...m,
                    streaming: false,
                    failed: true,
                    content:
                      m.content ||
                      "…the connection to the world wavers. Try again.",
                  }
                : m,
            ),
          );
        }
      } finally {
        setSending(false);
        abortRef.current = null;
      }
    },
    [bookId, entityId, mode, chunkIdx],
  );

  function handleSubmit(e?: React.FormEvent) {
    e?.preventDefault();
    const text = input.trim();
    if (!text || sending) return;
    if (mode === "after_ending" && !acknowledgedRef.current.after_ending) {
      pendingSendRef.current = text;
      setConfirmMode("after_ending");
      return;
    }
    setInput("");
    void doSend(text);
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  }

  function handleConfirmed() {
    const m = confirmMode;
    if (!m) return;
    acknowledgedRef.current[m] = true;
    setConfirmMode(null);
    const pending = pendingSendRef.current;
    pendingSendRef.current = null;
    if (pending) {
      setInput("");
      void doSend(pending, true);
    }
  }

  function handleStarter(question: string) {
    setInput(question);
    textareaRef.current?.focus();
  }

  const showConfirm = confirmMode === "after_ending";
  const showEmptyState = historyLoaded && messages.length === 0 && !showConfirm;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="flex items-center gap-4 border-b pb-2"
        style={{ borderColor: "var(--world-frame)" }}
      >
        <ModeButton
          label="Story so far"
          active={mode === "story_so_far"}
          onClick={() => setMode("story_so_far")}
        />
        <ModeButton
          label="After the ending"
          active={mode === "after_ending"}
          onClick={() => setMode("after_ending")}
        />
      </div>

      <div
        ref={scrollRef}
        onScroll={handleScroll}
        className="flex-1 space-y-4 overflow-y-auto py-4"
      >
        {!historyLoaded ? (
          <p className="font-ui text-sm text-muted-foreground">
            Loading the conversation…
          </p>
        ) : showConfirm ? (
          <SpoilerConfirmPanel
            entityName={entityName}
            onConfirmed={handleConfirmed}
          />
        ) : showEmptyState ? (
          <div className="space-y-2">
            <p className="font-ui text-sm text-muted-foreground italic">
              Nothing said yet. Try asking:
            </p>
            {STARTER_QUESTIONS.map((q) => (
              <button
                key={q}
                type="button"
                onClick={() => handleStarter(q)}
                className="block w-full rounded-md border px-3 py-2 text-left font-ui text-sm hover:bg-[var(--muted)]"
                style={{ borderColor: "var(--world-frame)" }}
              >
                {q}
              </button>
            ))}
          </div>
        ) : (
          <MessageList messages={messages} entityName={entityName} />
        )}
      </div>

      {!showConfirm ? (
        <form
          onSubmit={handleSubmit}
          className="flex items-end gap-2 border-t pt-3"
          style={{ borderColor: "var(--world-frame)" }}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            rows={1}
            placeholder={`Say something to ${entityName}…`}
            className="min-h-11 flex-1 resize-none rounded-md border bg-transparent px-3 py-2.5 font-ui text-sm focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
            style={{ borderColor: "var(--world-frame)" }}
          />
          <button
            type="submit"
            disabled={sending || !input.trim()}
            aria-label="Send message"
            className="flex h-11 items-center justify-center rounded-full bg-[var(--world-accent)] px-4 font-ui text-xs font-medium text-[var(--world-accent-fg)] transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            Send
          </button>
        </form>
      ) : null}
    </div>
  );
}

function ModeButton({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className="eyebrow -mb-px rounded-t-sm border-b-2 pb-2 transition-colors focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
      style={{
        borderColor: active ? "var(--world-accent)" : "transparent",
        color: active ? "var(--card-foreground)" : "var(--muted-foreground)",
      }}
    >
      {label}
    </button>
  );
}

function MessageList({
  messages,
  entityName,
}: {
  messages: LocalMessage[];
  entityName: string;
}) {
  return (
    <div className="space-y-3">
      {messages.map((m, i) => {
        const isFirstOfRun = i === 0 || messages[i - 1].role !== m.role;
        return (
          <div
            key={m.id}
            className={
              m.role === "user" ? "flex justify-end" : "flex justify-start"
            }
          >
            {m.role === "user" ? (
              <div
                className="max-w-[85%] rounded-md px-3 py-2 font-ui text-sm"
                style={{ background: "var(--world-surface)" }}
              >
                {m.content}
              </div>
            ) : (
              <div className="max-w-[90%]">
                {isFirstOfRun ? (
                  <p className="eyebrow mb-1">{entityName}</p>
                ) : null}
                <p
                  className={`font-reading text-sm leading-relaxed ${m.failed ? "text-muted-foreground italic" : ""}`}
                >
                  {m.content}
                  {m.streaming ? (
                    <span
                      className="ml-0.5 inline-block h-3.5 w-1.5 animate-pulse align-middle"
                      style={{ background: "var(--world-accent)" }}
                      aria-hidden="true"
                    />
                  ) : null}
                </p>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

function SpoilerConfirmPanel({
  entityName,
  onConfirmed,
}: {
  entityName: string;
  onConfirmed: () => void;
}) {
  return (
    <div
      className="space-y-4 rounded-md border p-4 text-center"
      style={{ borderColor: "var(--world-frame)" }}
    >
      <p className="font-reading text-sm leading-relaxed">
        This lets {entityName} speak of everything — including the ending.
      </p>
      <button
        type="button"
        onClick={onConfirmed}
        className="mx-auto flex h-11 w-full max-w-[220px] items-center justify-center rounded-full border font-ui text-xs font-medium transition-colors hover:bg-[var(--muted)] focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none"
        style={{
          borderColor: "var(--world-accent)",
          color: "var(--world-accent)",
        }}
      >
        Yes, reveal the ending
      </button>
    </div>
  );
}
