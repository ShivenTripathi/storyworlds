import Link from "next/link";
import type { DossierRelationship } from "@/components/world/types";

interface RelationshipChipsProps {
  bookId: string;
  relationships: DossierRelationship[];
}

/**
 * "Seen alongside" — co-occurring characters as linked brass chips, each
 * carrying the number of shared pages. Every entry is already frontier-gated
 * server-side, so linking on to its own dossier never reveals someone the
 * reader hasn't met.
 */
export function RelationshipChips({
  bookId,
  relationships,
}: RelationshipChipsProps) {
  if (relationships.length === 0) return null;

  return (
    <ul className="flex flex-wrap gap-2">
      {relationships.map((r) => (
        <li key={r.id}>
          <Link
            href={`/books/${bookId}/characters/${encodeURIComponent(r.id)}`}
            className="inline-flex items-center gap-2 rounded-full border border-[var(--world-frame)] px-3 py-1.5 font-ui text-sm transition-colors hover:border-[var(--world-accent)] hover:text-[var(--world-accent)]"
          >
            <span>{r.name}</span>
            <span
              aria-hidden="true"
              className="h-3 w-px"
              style={{ background: "var(--world-frame)" }}
            />
            <span className="font-ui text-[10px] tracking-wide text-muted-foreground uppercase">
              {r.sharedPages} {r.sharedPages === 1 ? "page" : "pages"}
            </span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
