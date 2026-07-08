import { ARCHETYPES, type Archetype } from "@/theme/archetypes";

/**
 * Deterministically picks a per-book "world" archetype by hashing the book
 * id, until real archetype assignment lands in M2. Same id always yields
 * the same archetype, so a book's cover doesn't flicker between renders.
 */
export function archetypeForBook(bookId: string): Archetype {
  let hash = 0;
  for (let i = 0; i < bookId.length; i++) {
    hash = (hash * 31 + bookId.charCodeAt(i)) >>> 0;
  }
  return ARCHETYPES[hash % ARCHETYPES.length];
}
