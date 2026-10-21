import "server-only";
import mongoose from "mongoose";

/**
 * MongoDB connection layer (Phase 2).
 *
 * - Server-side only (`server-only` + ESLint import restrictions keep this out
 *   of client bundles).
 * - One shared connection, cached on `globalThis` so Next.js development hot
 *   reloads and concurrent requests reuse it instead of opening new pools.
 * - Fails fast (short timeouts, no command buffering) so an unreachable
 *   cluster surfaces as a handled read failure, never a hung request.
 * - Diagnostics never include the connection string or credentials.
 */

export const CONNECTION_OPTIONS: mongoose.ConnectOptions = {
  serverSelectionTimeoutMS: 5_000,
  connectTimeoutMS: 5_000,
  maxPoolSize: 5,
  minPoolSize: 0,
  // Fail immediately instead of buffering queries when disconnected.
  bufferCommands: false,
  // Indexes are created deliberately (seed script / operator), never as a
  // side effect of an application process connecting.
  autoIndex: false,
  retryWrites: true,
};

/** Thrown when configuration or connectivity prevents reading the catalogue. */
export class DatabaseUnavailableError extends Error {
  constructor(message = "The catalogue database is unavailable.") {
    super(message);
    this.name = "DatabaseUnavailableError";
  }
}

interface ConnectionCache {
  connection: typeof mongoose | null;
  promise: Promise<typeof mongoose> | null;
}

const globalCache = globalThis as typeof globalThis & { __pearlMongoose?: ConnectionCache };
const cache: ConnectionCache = globalCache.__pearlMongoose ?? { connection: null, promise: null };
globalCache.__pearlMongoose = cache;

/** True when a connection string has been supplied through the environment. */
export function isDatabaseConfigured(): boolean {
  return Boolean(process.env.MONGODB_URI?.trim());
}

/** Remove credentials from any message before it can reach a log. */
function redactCredentials(message: string): string {
  return message.replace(/\/\/[^/\s@]+@/g, "//<credentials>@");
}

/** Server-side diagnostic logging for database failures (credential-safe). */
export function logDatabaseError(scope: string, error: unknown): void {
  const name = error instanceof Error ? error.name : typeof error;
  const detail = error instanceof Error ? redactCredentials(error.message) : String(error);
  console.error(`[catalogue] ${scope} failed (${name}): ${detail}`);
}

/**
 * Connect (or reuse the cached connection).
 *
 * Throws `DatabaseUnavailableError` when unconfigured or unreachable;
 * callers translate that into a customer-safe read failure.
 */
export async function connectDatabase(): Promise<typeof mongoose> {
  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    throw new DatabaseUnavailableError("MONGODB_URI is not configured.");
  }

  if (cache.connection) return cache.connection;

  if (!cache.promise) {
    cache.promise = mongoose
      .connect(uri, CONNECTION_OPTIONS)
      .then((instance) => {
        cache.connection = instance;
        return instance;
      })
      .catch((error: unknown) => {
        // Drop the promise so the next request retries instead of reusing a
        // permanently rejected connection.
        cache.promise = null;
        cache.connection = null;
        if (error instanceof Error) logDatabaseError("connect", error);
        throw new DatabaseUnavailableError("Could not reach the catalogue database.");
      });
  }

  return cache.promise;
}
