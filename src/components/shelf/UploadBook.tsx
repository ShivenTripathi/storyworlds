"use client";

import { useRef, useState, type DragEvent } from "react";
import type { Book, ApiErrorBody } from "./types";

const MAX_BYTES = 50 * 1024 * 1024;

interface UploadBookProps {
  onUploaded: (book: Book) => void;
  /** Render as the empty-state hero card instead of the compact grid tile. */
  variant?: "tile" | "hero";
}

type UploadState = "idle" | "uploading" | "error";

export function UploadBook({ onUploaded, variant = "tile" }: UploadBookProps) {
  const [open, setOpen] = useState(false);

  return (
    <>
      {variant === "hero" ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="font-ui w-full max-w-sm rounded-full bg-[var(--world-accent)] px-6 py-3 text-sm font-medium text-[var(--world-accent-fg)] transition-opacity hover:opacity-90"
        >
          Add a book
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="group flex aspect-[3/4] w-full flex-col items-center justify-center gap-3 rounded-lg border border-dashed border-border text-muted-foreground transition-colors duration-200 hover:border-[var(--world-accent,var(--primary))] hover:text-[var(--world-accent,var(--primary))]"
        >
          <span className="text-3xl leading-none">+</span>
          <span className="font-ui text-xs">Add a book</span>
        </button>
      )}

      {open ? (
        <UploadDialog
          onClose={() => setOpen(false)}
          onUploaded={(book) => {
            onUploaded(book);
            setOpen(false);
          }}
        />
      ) : null}
    </>
  );
}

function UploadDialog({
  onClose,
  onUploaded,
}: {
  onClose: () => void;
  onUploaded: (book: Book) => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState("");
  const [author, setAuthor] = useState("");
  const [state, setState] = useState<UploadState>("idle");
  const [error, setError] = useState<string | null>(null);
  const [dragActive, setDragActive] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  function validateAndSetFile(candidate: File | undefined | null) {
    if (!candidate) return;
    if (candidate.type !== "application/pdf" && !candidate.name.toLowerCase().endsWith(".pdf")) {
      setError("Only PDF files are supported.");
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setError("File is too large — the shelf accepts PDFs up to 50MB.");
      return;
    }
    setError(null);
    setFile(candidate);
  }

  function handleDrop(e: DragEvent<HTMLDivElement>) {
    e.preventDefault();
    setDragActive(false);
    validateAndSetFile(e.dataTransfer.files?.[0]);
  }

  async function handleUpload() {
    if (!file) {
      setError("Choose a PDF to upload.");
      return;
    }
    setState("uploading");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (title.trim()) formData.append("title", title.trim());
      if (author.trim()) formData.append("author", author.trim());

      const res = await fetch("/api/books", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as ApiErrorBody | null;
        throw new Error(body?.error?.message ?? "Upload failed. Please try again.");
      }

      const { book } = (await res.json()) as { book: Book };
      onUploaded(book);
    } catch (e) {
      setState("error");
      setError(e instanceof Error ? e.message : "Upload failed. Please try again.");
    }
  }

  const busy = state === "uploading";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--ink-950)]/70 px-4"
      onClick={() => !busy && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add a book"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl"
      >
        <p className="eyebrow">ADD A BOOK</p>
        <h2 className="font-display mt-1 text-2xl">Binding a new book</h2>

        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          className={`font-ui mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center text-sm transition-colors duration-200 ${
            dragActive
              ? "border-[var(--primary)] text-[var(--primary)]"
              : "border-border text-muted-foreground hover:border-[var(--primary)]"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,application/pdf"
            className="hidden"
            onChange={(e) => validateAndSetFile(e.target.files?.[0])}
          />
          {file ? (
            <span className="text-foreground">{file.name}</span>
          ) : (
            <>
              <span>Drag a PDF here, or click to choose one</span>
              <span className="text-xs opacity-70">Up to 50MB</span>
            </>
          )}
        </div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="font-ui mb-1 block text-xs text-muted-foreground">
              Title (optional)
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Leave blank to use the PDF's title"
              className="font-ui w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--ring)]"
            />
          </label>
          <label className="block">
            <span className="font-ui mb-1 block text-xs text-muted-foreground">
              Author (optional)
            </span>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="font-ui w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground outline-none focus:border-[var(--ring)]"
            />
          </label>
        </div>

        {busy ? (
          <div className="mt-5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/3 animate-[shimmer_1.2s_ease-in-out_infinite] rounded-full bg-[var(--primary)]" />
            </div>
            <p className="font-ui mt-2 text-xs text-muted-foreground">Binding your book…</p>
          </div>
        ) : null}

        {error ? (
          <p className="font-ui mt-3 text-xs text-[var(--destructive)]">{error}</p>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="font-ui rounded-full px-4 py-2 text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={busy || !file}
            onClick={handleUpload}
            className="font-ui rounded-full bg-[var(--primary)] px-5 py-2 text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy ? "Binding…" : "Upload"}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes shimmer {
          0% { transform: translateX(-100%); }
          100% { transform: translateX(400%); }
        }
      `}</style>
    </div>
  );
}
