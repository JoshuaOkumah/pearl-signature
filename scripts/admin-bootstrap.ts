/**
 * PEARL Signature owner bootstrap (Phase 3).
 *
 * Creates the FIRST administrator account ("owner" role) for the admin
 * dashboard. It is deliberately an operator script that must be executed
 * explicitly: it never runs on startup, on build, or through any web
 * request, and it refuses to create predictable default credentials.
 *
 * Usage:
 *   npm run admin:bootstrap -- --yes                 interactive (hidden password)
 *   npm run admin:bootstrap -- --email a@b.c --yes   interactive password for given email
 *
 * Automation (test environments ONLY — e2e/screenshot servers):
 *   ADMIN_EMAIL=... ADMIN_PASSWORD=... npm run admin:bootstrap -- --yes --non-interactive
 *   The password is read from the environment, never from argv. Never
 *   point this at a production database; NODE_ENV=production additionally
 *   requires --force-production.
 *
 * Safety rules:
 *   - Requires an explicit `--yes` and prints the target host + database
 *     (never credentials) before connecting.
 *   - Refuses to run without MONGODB_URI (read from `.env.local`
 *     automatically; explicit environment variables always win).
 *   - Refuses to create a second owner account (use
 *     scripts/admin-reset-password.ts to rotate an existing password).
 *   - Passwords are typed into a hidden prompt, validated (minimum 10
 *     characters), and confirmed twice; they are never echoed, logged,
 *     stored in argv, or written to disk.
 *   - Creates the auth-related indexes (admins, sessions, rate-limit
 *     buckets, audit log) while it is connected.
 */
import mongoose from "mongoose";
import { createInterface } from "node:readline/promises";
import { AdminModel } from "../src/models/admin";
import { AdminSessionModel } from "../src/models/admin-session";
import { LoginAttemptModel } from "../src/models/login-attempt";
import { AuditLogModel } from "../src/models/audit-log";
import {
  hashPassword,
  validatePasswordPolicy,
} from "../src/lib/auth/password-core";
import { loadEnvLocal } from "./load-env-local";

interface BootstrapArgs {
  yes: boolean;
  forceProduction: boolean;
  nonInteractive: boolean;
  email: string | null;
}

export function parseArgs(argv: string[]): BootstrapArgs {
  const emailIndex = argv.indexOf("--email");
  return {
    yes: argv.includes("--yes"),
    forceProduction: argv.includes("--force-production"),
    nonInteractive: argv.includes("--non-interactive"),
    email: emailIndex >= 0 && argv[emailIndex + 1] ? argv[emailIndex + 1] : null,
  };
}

/** Extract the target host + database from a connection string, no credentials. */
export function describeTarget(uri: string): { host: string; database: string } {
  try {
    const url = new URL(uri);
    const database = url.pathname.replace(/^\//, "").split("?")[0];
    return { host: url.hostname || "(unknown host)", database: database || "(no database selected)" };
  } catch {
    return { host: "(unparseable connection string)", database: "(unknown)" };
  }
}

export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

/** Read a line from stdin with echo suppressed (no password on screen). */
async function promptHidden(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  // Suppress every write while the hidden question is open, so the typed
  // password never reaches the terminal buffer.
  const mutable = rl as unknown as { _writeToOutput: (value: string) => void };
  mutable._writeToOutput = () => undefined;
  try {
    return await rl.question("");
  } finally {
    rl.close();
  }
}

async function promptLine(question: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  try {
    return (await rl.question(question)).trim();
  } finally {
    rl.close();
  }
}

/** Collect a validated password: hidden, minimum length, confirmed twice. */
async function collectPassword(): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    process.stdout.write("Choose a password (minimum 10 characters, input hidden): ");
    const first = await promptHidden();
    console.log("");
    const policy = validatePasswordPolicy(first);
    if (policy) {
      console.log(`[bootstrap] ${policy} Try again.`);
      continue;
    }
    process.stdout.write("Repeat the password to confirm: ");
    const second = await promptHidden();
    console.log("");
    if (first !== second) {
      console.log("[bootstrap] The passwords did not match. Try again.");
      continue;
    }
    return first;
  }
  return null;
}

async function bootstrap(): Promise<void> {
  loadEnvLocal(); // .env.local matches what the docs tell operators to use
  const args = parseArgs(process.argv.slice(2));

  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    console.error(
      "[bootstrap] MONGODB_URI is not configured. Set it in .env.local (see .env.example), then re-run.",
    );
    process.exitCode = 1;
    return;
  }

  const { host, database } = describeTarget(uri);
  console.log(`[bootstrap] Target: ${host} / database "${database}"`);

  if (process.env.NODE_ENV === "production" && !args.forceProduction) {
    console.error(
      "[bootstrap] NODE_ENV is production. Re-run with --force-production if you are certain this is intended.",
    );
    process.exitCode = 1;
    return;
  }

  if (!args.yes) {
    console.log("[bootstrap] Stopped before connecting. Re-run with --yes to create the owner account:");
    console.log("       npm run admin:bootstrap -- --yes");
    return;
  }

  // 1. Email — flag/env only, never guessed.
  let email = args.email?.trim().toLowerCase() ?? null;
  if (args.nonInteractive) {
    email = (email ?? process.env.ADMIN_EMAIL?.trim().toLowerCase() ?? null);
    if (!email || !isValidEmail(email)) {
      console.error("[bootstrap] --non-interactive requires a valid --email or ADMIN_EMAIL.");
      process.exitCode = 1;
      return;
    }
  } else if (!email) {
    email = (await promptLine("Owner email: ")).toLowerCase();
  }
  if (!isValidEmail(email)) {
    console.error("[bootstrap] That email address is not valid. Nothing was changed.");
    process.exitCode = 1;
    return;
  }

  // 2. Password — hidden prompt, or environment for automation (NEVER argv).
  let password: string | null;
  if (args.nonInteractive) {
    password = process.env.ADMIN_PASSWORD ?? null;
    const policy = validatePasswordPolicy(password);
    if (policy) {
      console.error(`[bootstrap] ADMIN_PASSWORD rejected: ${policy}`);
      process.exitCode = 1;
      return;
    }
  } else {
    password = await collectPassword();
  }
  if (!password) {
    console.error("[bootstrap] No password was provided. Nothing was changed.");
    process.exitCode = 1;
    return;
  }

  console.log("[bootstrap] Connecting…");
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    autoIndex: false, // indexes are created explicitly below
  });

  try {
    // 3. One owner only.
    const existingOwner = await AdminModel.findOne({ role: "owner" }).select({ email: 1 }).lean();
    if (existingOwner) {
      console.error(
        `[bootstrap] An owner account already exists (${existingOwner.email}).` +
          " To change its password run: npm run admin:reset -- --email <email> --yes",
      );
      process.exitCode = 1;
      return;
    }

    // 4. Insert (the unique email index is the concurrency backstop).
    const passwordHash = await hashPassword(password);
    const admin = await AdminModel.create({
      email,
      passwordHash,
      role: "owner",
      status: "active",
    });

    await AuditLogModel.create({
      event: "admin.login.success",
      outcome: "success",
      adminId: admin._id,
      email,
      detail: "Owner account created via bootstrap script",
    }).catch(() => undefined);

    // 5. Auth indexes (admins/session/attempt/audit) — add-only.
    await AdminModel.createIndexes();
    await AdminSessionModel.createIndexes();
    await LoginAttemptModel.createIndexes();
    await AuditLogModel.createIndexes();

    console.log(`[bootstrap] Owner account created for ${email}.`);
    console.log("[bootstrap] Sign in at /admin/login. The password was not displayed or stored anywhere else.");
  } finally {
    await mongoose.disconnect();
  }
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  // Redact credentials defensively; never print the connection string.
  console.error(`[bootstrap] Failed: ${message.replace(/\/\/[^\s/@]+@/g, "//<credentials>@")}`);
  process.exitCode = 1;
});
