import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { LocalPgPool } from "./local-pool";

const databaseUrl = process.env.DATABASE_URL;

const globalForDb = globalThis as typeof globalThis & {
  __arenaNextJsPostgresqlPool?: Pool | LocalPgPool;
};

export const pool =
  globalForDb.__arenaNextJsPostgresqlPool ??
  (databaseUrl
    ? new Pool({
        connectionString: databaseUrl,
      })
    : new LocalPgPool());

if (process.env.NODE_ENV !== "production") {
  globalForDb.__arenaNextJsPostgresqlPool = pool;
}

export const db = drizzle(pool as unknown as Pool);
