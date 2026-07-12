import { ARCHETYPES, type Archetype } from "@/theme/archetypes";

/**
 * Curated Project Gutenberg seed catalog — public-domain classics that
 * auto-ingest through `src/services/catalog.ts` / `src/jobs/catalog-ingest.ts`
 * to keep the Discover tab populated without any manual upload.
 *
 * Analysis is amortized: once a catalog book is ingested + analyzed +
 * published, every reader shares the same world reference for free (see
 * `addToLibrary` in src/services/books.ts). Adding a new title only costs
 * one analysis pass, not one per reader.
 */
export interface CatalogSeedEntry {
  gutenbergId: number;
  title: string;
  author: string;
  archetype: Archetype;
  blurb: string;
}

export const CATALOG_SEED: CatalogSeedEntry[] = [
  {
    gutenbergId: 84,
    title: "Frankenstein",
    author: "Mary Shelley",
    archetype: "gothic",
    blurb:
      "A scientist's forbidden creation turns against him, and everyone he loves.",
  },
  {
    gutenbergId: 345,
    title: "Dracula",
    author: "Bram Stoker",
    archetype: "gothic",
    blurb:
      "An ancient Transylvanian count stalks Victorian London for new blood.",
  },
  {
    gutenbergId: 1661,
    title: "The Adventures of Sherlock Holmes",
    author: "Arthur Conan Doyle",
    archetype: "noir",
    blurb:
      "London's sharpest mind unravels twelve baffling cases, one deduction at a time.",
  },
  {
    gutenbergId: 1342,
    title: "Pride and Prejudice",
    author: "Jane Austen",
    archetype: "regency",
    blurb:
      "Wit, pride, and misunderstanding stand between two stubborn hearts.",
  },
  {
    gutenbergId: 11,
    title: "Alice's Adventures in Wonderland",
    author: "Lewis Carroll",
    archetype: "fairy-tale",
    blurb:
      "A curious girl tumbles down a rabbit hole into gloriously illogical chaos.",
  },
  {
    gutenbergId: 35,
    title: "The Time Machine",
    author: "H. G. Wells",
    archetype: "golden-age-scifi",
    blurb:
      "An inventor journeys far into humanity's strange, unsettling future.",
  },
  {
    gutenbergId: 36,
    title: "The War of the Worlds",
    author: "H. G. Wells",
    archetype: "golden-age-scifi",
    blurb:
      "Martian war machines descend on England, and nothing can stop them.",
  },
  {
    gutenbergId: 120,
    title: "Treasure Island",
    author: "Robert Louis Stevenson",
    archetype: "maritime",
    blurb:
      "A cabin boy, a buried fortune, and a one-legged pirate named Silver.",
  },
  {
    gutenbergId: 55,
    title: "The Wonderful Wizard of Oz",
    author: "L. Frank Baum",
    archetype: "fairy-tale",
    blurb:
      "A cyclone strands a farm girl in a magical land of witches and wizards.",
  },
  {
    gutenbergId: 174,
    title: "The Picture of Dorian Gray",
    author: "Oscar Wilde",
    archetype: "gothic",
    blurb:
      "A man stays eternally beautiful while his hidden portrait rots with sin.",
  },
  {
    gutenbergId: 1260,
    title: "Jane Eyre",
    author: "Charlotte Brontë",
    archetype: "gothic",
    blurb:
      "An orphaned governess finds love shadowed by a manor's dark secret.",
  },
  {
    gutenbergId: 2701,
    title: "Moby Dick; or, The Whale",
    author: "Herman Melville",
    archetype: "maritime",
    blurb: "A vengeful captain hunts the white whale that took his leg.",
  },
  {
    gutenbergId: 43,
    title: "The Strange Case of Dr. Jekyll and Mr. Hyde",
    author: "Robert Louis Stevenson",
    archetype: "noir",
    blurb: "A respectable doctor's potion unleashes his monstrous second self.",
  },
  {
    gutenbergId: 5200,
    title: "Metamorphosis",
    author: "Franz Kafka",
    archetype: "cosmic-weird",
    blurb: "A traveling salesman wakes transformed into a monstrous insect.",
  },
  {
    gutenbergId: 219,
    title: "Heart of Darkness",
    author: "Joseph Conrad",
    archetype: "maritime",
    blurb: "A riverboat journey into the Congo confronts colonial horror.",
  },
  {
    gutenbergId: 768,
    title: "Wuthering Heights",
    author: "Emily Brontë",
    archetype: "gothic",
    blurb: "A ruinous, obsessive love haunts two families across the moors.",
  },
  {
    gutenbergId: 215,
    title: "The Call of the Wild",
    author: "Jack London",
    archetype: "pastoral",
    blurb: "A stolen dog answers the primal call of the frozen Yukon wild.",
  },
  {
    gutenbergId: 16,
    title: "Peter Pan",
    author: "J. M. Barrie",
    archetype: "fairy-tale",
    blurb: "A boy who won't grow up leads children to adventure in Neverland.",
  },
  {
    gutenbergId: 2591,
    title: "Grimms' Fairy Tales",
    author: "The Brothers Grimm",
    archetype: "mythic",
    blurb: "Classic folk tales of witches, wolves, and hard-won happy endings.",
  },
  {
    gutenbergId: 98,
    title: "A Tale of Two Cities",
    author: "Charles Dickens",
    archetype: "classic",
    blurb:
      "Love and sacrifice collide amid the terror of the French Revolution.",
  },
];

// Fail fast at module load if any seed archetype was mistyped — this guards
// against a typo silently falling through to `themeArchetype` validation
// later in the pipeline (or worse, a bad theme in prod).
const VALID_ARCHETYPES = new Set<string>(ARCHETYPES);
for (const entry of CATALOG_SEED) {
  if (!VALID_ARCHETYPES.has(entry.archetype)) {
    throw new Error(
      `[catalog/gutenberg] invalid archetype "${entry.archetype}" for seed entry "${entry.title}"`,
    );
  }
}
