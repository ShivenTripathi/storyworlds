"use client";

import { useRef, useState, type DragEvent } from "react";
import type { Book, ApiErrorBody } from "./types";

const MAX_BYTES = 50 * 1024 * 1024;
const ACCEPTED_EXTENSIONS = [".pdf", ".epub", ".txt"];
const ACCEPTED_MIME_TYPES = new Set([
  "application/pdf",
  "application/epub+zip",
  "text/plain",
]);

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
          className="w-full max-w-sm rounded-full bg-[var(--world-accent)] px-6 py-3 font-ui text-sm font-medium text-[var(--world-accent-fg)] transition-opacity hover:opacity-90"
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

type Contribution = "private" | "published";
type Attestation = "public_domain" | "owned_contributed";

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
  const [contribution, setContribution] = useState<Contribution>("private");
  const [attestation, setAttestation] = useState<Attestation | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  function validateAndSetFile(candidate: File | undefined | null) {
    if (!candidate) return;
    const name = candidate.name.toLowerCase();
    const hasAcceptedExtension = ACCEPTED_EXTENSIONS.some((ext) =>
      name.endsWith(ext),
    );
    if (!hasAcceptedExtension && !ACCEPTED_MIME_TYPES.has(candidate.type)) {
      setError("Only PDF, EPUB, or plain-text (.txt) files are supported.");
      return;
    }
    if (candidate.size > MAX_BYTES) {
      setError("File is too large — the shelf accepts files up to 50MB.");
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
      setError("Choose a PDF, EPUB, or text file to upload.");
      return;
    }
    if (contribution === "published" && !attestation) {
      setError("Choose which rights claim applies before contributing.");
      return;
    }
    setState("uploading");
    setError(null);

    try {
      const formData = new FormData();
      formData.append("file", file);
      if (title.trim()) formData.append("title", title.trim());
      if (author.trim()) formData.append("author", author.trim());
      formData.append("visibility", contribution);
      if (contribution === "published" && attestation) {
        formData.append("rightsAttestation", attestation);
      }

      const res = await fetch("/api/books", {
        method: "POST",
        body: formData,
      });

      if (!res.ok) {
        const body = (await res
          .json()
          .catch(() => null)) as ApiErrorBody | null;
        throw new Error(
          body?.error?.message ?? "Upload failed. Please try again.",
        );
      }

      const { book } = (await res.json()) as { book: Book };
      onUploaded(book);
    } catch (e) {
      setState("error");
      setError(
        e instanceof Error ? e.message : "Upload failed. Please try again.",
      );
    }
  }

  const busy = state === "uploading";

  return (
    // Backdrop: click-to-close is a mouse convenience; the dialog is also
    // dismissible via the Cancel button and the Escape key (handled above), so
    // this element needs no keyboard listener of its own.
    // eslint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[var(--scrim)] px-4"
      onClick={() => !busy && onClose()}
    >
      {/* Stop propagation so clicks inside the dialog don't close it. Not an
          interactive control itself. */}
      {/* eslint-disable-next-line jsx-a11y/click-events-have-key-events */}
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Add a book"
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md rounded-lg border border-border bg-card p-6 shadow-2xl"
      >
        <p className="eyebrow">ADD A BOOK</p>
        <h2 className="mt-1 font-display text-2xl">Binding a new book</h2>

        <div
          role="button"
          tabIndex={0}
          aria-label="Choose a PDF, EPUB, or text file, or drag one here"
          onDragOver={(e) => {
            e.preventDefault();
            setDragActive(true);
          }}
          onDragLeave={() => setDragActive(false)}
          onDrop={handleDrop}
          onClick={() => inputRef.current?.click()}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              inputRef.current?.click();
            }
          }}
          className={`mt-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-md border border-dashed px-4 py-8 text-center font-ui text-sm transition-colors duration-200 focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:outline-none ${
            dragActive
              ? "border-[var(--primary)] text-[var(--primary)]"
              : "border-border text-muted-foreground hover:border-[var(--primary)]"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept=".pdf,.epub,.txt,application/pdf,application/epub+zip,text/plain"
            className="hidden"
            onChange={(e) => validateAndSetFile(e.target.files?.[0])}
          />
          {file ? (
            <span className="text-foreground">{file.name}</span>
          ) : (
            <>
              <span>
                Drag a PDF, EPUB, or text file here, or click to choose one
              </span>
              <span className="text-xs opacity-70">Up to 50MB</span>
            </>
          )}
        </div>

        <div className="mt-4 space-y-3">
          <label className="block">
            <span className="mb-1 block font-ui text-xs text-muted-foreground">
              Title (optional)
            </span>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Leave blank to use the book's title"
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-ui text-sm text-foreground outline-none focus:border-[var(--ring)]"
            />
          </label>
          <label className="block">
            <span className="mb-1 block font-ui text-xs text-muted-foreground">
              Author (optional)
            </span>
            <input
              type="text"
              value={author}
              onChange={(e) => setAuthor(e.target.value)}
              className="w-full rounded-md border border-input bg-background px-3 py-2 font-ui text-sm text-foreground outline-none focus:border-[var(--ring)]"
            />
          </label>
        </div>

        <div className="mt-5 rounded-md border border-border p-3">
          <span className="mb-2 block font-ui text-xs text-muted-foreground">
            How should this book live on Story Worlds?
          </span>

          <div className="space-y-2">
            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors duration-150 ${
                contribution === "private"
                  ? "border-[var(--primary)] bg-[var(--primary)]/5"
                  : "border-border"
              }`}
            >
              <input
                type="radio"
                name="contribution"
                aria-label="Keep private"
                className="mt-0.5"
                checked={contribution === "private"}
                onChange={() => {
                  setContribution("private");
                  setAttestation(null);
                }}
              />
              <span>
                <span className="block font-ui text-sm text-foreground">
                  Keep private
                </span>
                <span className="block font-ui text-xs text-muted-foreground">
                  Only you (and admins) can ever open it. Its analysis
                  isn&apos;t shared with anyone else, so it&apos;s priced as a
                  premium, single-reader book.
                </span>
              </span>
            </label>

            <label
              className={`flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2 transition-colors duration-150 ${
                contribution === "published"
                  ? "border-[var(--primary)] bg-[var(--primary)]/5"
                  : "border-border"
              }`}
            >
              <input
                type="radio"
                name="contribution"
                aria-label="Contribute to the public library"
                className="mt-0.5"
                checked={contribution === "published"}
                onChange={() => setContribution("published")}
              />
              <span>
                <span className="block font-ui text-sm text-foreground">
                  Contribute to the public library
                </span>
                <span className="block font-ui text-xs text-muted-foreground">
                  Published to Discover — every reader shares this book&apos;s
                  analysis, so it&apos;s cheap to bind. Requires a rights
                  attestation below.
                </span>
              </span>
            </label>
          </div>

          {contribution === "published" ? (
            <div className="mt-3 space-y-1.5 border-t border-border pt-3">
              <label className="flex cursor-pointer items-start gap-2 font-ui text-xs text-muted-foreground">
                <input
                  type="radio"
                  name="attestation"
                  className="mt-0.5"
                  checked={attestation === "public_domain"}
                  onChange={() => setAttestation("public_domain")}
                />
                <span>This work is in the public domain.</span>
              </label>
              <label className="flex cursor-pointer items-start gap-2 font-ui text-xs text-muted-foreground">
                <input
                  type="radio"
                  name="attestation"
                  className="mt-0.5"
                  checked={attestation === "owned_contributed"}
                  onChange={() => setAttestation("owned_contributed")}
                />
                <span>
                  I own this work, and I waive exclusive rights to contribute
                  it.
                </span>
              </label>
            </div>
          ) : null}
        </div>

        {busy ? (
          <div className="mt-5">
            <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full w-1/3 animate-[shimmer_1.2s_ease-in-out_infinite] rounded-full bg-[var(--primary)]" />
            </div>
            <p className="mt-2 font-ui text-xs text-muted-foreground">
              Binding your book…
            </p>
          </div>
        ) : null}

        {error ? (
          <p className="mt-3 font-ui text-xs text-[var(--destructive)]">
            {error}
          </p>
        ) : null}

        <div className="mt-6 flex items-center justify-end gap-3">
          <button
            type="button"
            disabled={busy}
            onClick={onClose}
            className="rounded-full px-4 py-2 font-ui text-sm text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={
              busy || !file || (contribution === "published" && !attestation)
            }
            onClick={handleUpload}
            className="rounded-full bg-[var(--primary)] px-5 py-2 font-ui text-sm font-medium text-[var(--primary-foreground)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {busy
              ? "Binding…"
              : contribution === "published"
                ? "Contribute"
                : "Upload"}
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
