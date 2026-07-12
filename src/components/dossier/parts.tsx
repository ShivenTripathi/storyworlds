import type { ReactNode } from "react";

/**
 * A brass-plaque section label with a short engraved accent rule beneath it —
 * the recurring header motif of the dossier.
 */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <div className="mb-3">
      <p className="eyebrow">{children}</p>
      <span
        aria-hidden="true"
        className="mt-1.5 block h-px w-8"
        style={{ background: "var(--world-accent)" }}
      />
    </div>
  );
}

/**
 * A single label/value row in the "key facts" ledger, ruled off from the row
 * above it in engraved-frame color.
 */
export function FactRow({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div
      className="flex items-baseline justify-between gap-4 border-t py-2.5 first:border-t-0"
      style={{ borderColor: "var(--world-frame)" }}
    >
      <span className="eyebrow shrink-0">{label}</span>
      <span className="text-right font-ui text-sm text-foreground">
        {value}
      </span>
    </div>
  );
}
