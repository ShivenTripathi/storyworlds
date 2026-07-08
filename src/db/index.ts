import { mkdirSync } from "node:fs";
import path from "node:path";
import { env } from "@/lib/env";
import * as schema from "./schema";

// ---------------------------------------------------------------------------
// Shared Drizzle client.
//
// - env.DATABASE_URL set   -> Neon serverless Postgres (drizzle-orm/neon-http)
// - env.DATABASE_URL unset -> local PGlite persisted at .data/pglite, with
//                             migrations applied programmatically on first
//                             access.
//
// A globalThis singleton prevents Next.js dev-server hot reload from
// spinning up multiple clients / PGlite instances.
// ---------------------------------------------------------------------------

type AnyDb =
  | Awaited<ReturnType<typeof createNeonDb>>
  | Awaited<ReturnType<typeof createPgliteDb>>;

async function createNeonDb() {
  const { neon } = await import("@neondatabase/serverless");
  const { drizzle } = await import("drizzle-orm/neon-http");
  const sql = neon(env.DATABASE_URL as string);
  return drizzle(sql, { schema });
}

async function createPgliteDb() {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const { migrate } = await import("drizzle-orm/pglite/migrator");

  const dataDir = path.join(process.cwd(), ".data", "pglite");
  mkdirSync(dataDir, { recursive: true });
  const client = new PGlite(dataDir);
  const drizzleDb = drizzle(client, { schema });

  await migrate(drizzleDb, {
    migrationsFolder: path.join(process.cwd(), "drizzle"),
  });

  return drizzleDb;
}

declare global {
   
  var __storyworldsDb: AnyDb | undefined;
   
  var __storyworldsDbPromise: Promise<AnyDb> | undefined;
}

function getDbPromise(): Promise<AnyDb> {
  if (globalThis.__storyworldsDbPromise) {
    return globalThis.__storyworldsDbPromise;
  }

  const promise = env.DATABASE_URL ? createNeonDb() : createPgliteDb();

  globalThis.__storyworldsDbPromise = promise;
  promise.then((instance) => {
    globalThis.__storyworldsDb = instance;
  });

  return promise;
}

// Kick off initialization immediately so the first real query doesn't pay
// the (small) startup latency on top of its own await.
const dbPromise = getDbPromise();

/**
 * Resolves once the database client is ready (and, in PGlite mode, once
 * migrations have been applied). Most call sites can just `await db` via
 * this promise before issuing queries in a fresh serverless/dev context.
 */
export const dbReady: Promise<AnyDb> = dbPromise;

/**
 * The shared Drizzle client. In PGlite dev mode this resolves synchronously
 * to the same underlying instance once `dbReady` has settled once per
 * process; callers that run at module-init time before that should prefer
 * `await dbReady` instead.
 */
export const db = new Proxy({} as AnyDb, {
  get(_target, prop, receiver) {
    const instance = globalThis.__storyworldsDb;
    if (!instance) {
      throw new Error(
        "db accessed before initialization finished — `await dbReady` first (e.g. at the top of a route handler or server action).",
      );
    }
    return Reflect.get(instance as object, prop, receiver);
  },
}) as AnyDb;

export { schema };
