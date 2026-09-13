import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";

/**
 * The connection is created lazily on first query.
 *
 * Previously the pool was constructed at module scope and threw when
 * DATABASE_URL was unset, which meant `next build` failed while collecting
 * page data for any route that imports the database — even though no query
 * runs at build time. The runtime contract is unchanged: a request that
 * actually needs the database still fails loudly with the same message.
 */
const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool;
  __arenaNextJsDrizzle?: NodePgDatabase;
};

function createPool(): Pool {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl) {
    throw new Error("DATABASE_URL is required");
  }
  const created = new Pool({ connectionString: databaseUrl });
  if (process.env.NODE_ENV !== "production") {
    globalForDb.__arenaNextJsPostgresqlPool = created;
  }
  return created;
}

export function getPool(): Pool {
  return (globalForDb.__arenaNextJsPostgresqlPool ??= createPool());
}

function getDb(): NodePgDatabase {
  return (globalForDb.__arenaNextJsDrizzle ??= drizzle(getPool()));
}

/**
 * Proxy so existing call sites (`db.select()...`, `pool.query(...)`) keep
 * working verbatim while the underlying pool is only opened on first use.
 */
export const db: NodePgDatabase = new Proxy({} as NodePgDatabase, {
  get(_target, property, receiver) {
    return Reflect.get(getDb() as object, property, receiver);
  },
});

export const pool: Pool = new Proxy({} as Pool, {
  get(_target, property, receiver) {
    const value = Reflect.get(getPool() as object, property, receiver);
    return typeof value === "function" ? value.bind(getPool()) : value;
  },
});
