/**
 * PEARL Signature owner password reset (Phase 3).
 *
 * Rotates an admin account's password and revokes every live session, so
 * a stolen or lost credential can be replaced without public email
 * infrastructure (which belongs to a later phase).
 *
 * Usage:
 *   npm run admin:reset -- --email owner@example.com --yes
 *   (interactive hidden password prompt, confirmed twice)
 *
 * Automation (test environments ONLY):
 *   ADMIN_PASSWORD=... npm run admin:reset -- --email a@b.c --yes --non-interactive
 *
 * Safety rules:
 *   - Requires an explicit `--yes`; prints host + database, never secrets.
 *   - MONGODB_URI is read from `.env.local` automatically; explicit
 *     environment variables always win.
 *   - Passwords are read from a hidden prompt (or the environment for
 *     automation), never from argv, never echoed or logged.
 *   - Every session for the account is deleted, so existing cookies
 *     become invalid immediately.
 *   - An audit entry is written (event only; no password material).
 */
import mongoose from "mongoose";
import { createInterface } from "node:readline/promises";
import { AdminModel } from "../src/models/admin";
import { AdminSessionModel } from "../src/models/admin-session";
import { AuditLogModel } from "../src/models/audit-log";
import { hashPassword, validatePasswordPolicy } from "../src/lib/auth/password-core";
import { loadEnvLocal } from "./load-env-local";

interface ResetArgs {
  yes: boolean;
  forceProduction: boolean;
  nonInteractive: boolean;
  email: string | null;
}

export function parseArgs(argv: string[]): ResetArgs {
  const emailIndex = argv.indexOf("--email");
  return {
    yes: argv.includes("--yes"),
    forceProduction: argv.includes("--force-production"),
    nonInteractive: argv.includes("--non-interactive"),
    email: emailIndex >= 0 && argv[emailIndex + 1] ? argv[emailIndex + 1] : null,
  };
}

export function describeTarget(uri: string): { host: string; database: string } {
  try {
    const url = new URL(uri);
    const database = url.pathname.replace(/^\//, "").split("?")[0];
    return { host: url.hostname || "(unknown host)", database: database || "(no database selected)" };
  } catch {
    return { host: "(unparseable connection string)", database: "(unknown)" };
  }
}

async function promptHidden(): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true });
  const mutable = rl as unknown as { _writeToOutput: (value: string) => void };
  mutable._writeToOutput = () => undefined;
  try {
    return await rl.question("");
  } finally {
    rl.close();
  }
}

async function collectPassword(): Promise<string | null> {
  for (let attempt = 0; attempt < 3; attempt += 1) {
    process.stdout.write("Choose a new password (minimum 10 characters, input hidden): ");
    const first = await promptHidden();
    console.log("");
    const policy = validatePasswordPolicy(first);
    if (policy) {
      console.log(`[reset] ${policy} Try again.`);
      continue;
    }
    process.stdout.write("Repeat the new password to confirm: ");
    const second = await promptHidden();
    console.log("");
    if (first !== second) {
      console.log("[reset] The passwords did not match. Try again.");
      continue;
    }
    return first;
  }
  return null;
}

async function reset(): Promise<void> {
  loadEnvLocal(); // .env.local matches what the docs tell operators to use
  const args = parseArgs(process.argv.slice(2));

  const uri = process.env.MONGODB_URI?.trim();
  if (!uri) {
    console.error(
      "[reset] MONGODB_URI is not configured. Set it in .env.local (see .env.example), then re-run.",
    );
    process.exitCode = 1;
    return;
  }

  const { host, database } = describeTarget(uri);
  console.log(`[reset] Target: ${host} / database "${database}"`);

  if (process.env.NODE_ENV === "production" && !args.forceProduction) {
    console.error(
      "[reset] NODE_ENV is production. Re-run with --force-production if you are certain this is intended.",
    );
    process.exitCode = 1;
    return;
  }

  if (!args.yes) {
    console.log("[reset] Stopped before connecting. Re-run with --yes to rotate the password:");
    console.log("       npm run admin:reset -- --email <email> --yes");
    return;
  }

  const email = args.email?.trim().toLowerCase();
  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    console.error("[reset] A valid --email is required. Nothing was changed.");
    process.exitCode = 1;
    return;
  }

  let password: string | null;
  if (args.nonInteractive) {
    password = process.env.ADMIN_PASSWORD ?? null;
    const policy = validatePasswordPolicy(password);
    if (policy) {
      console.error(`[reset] ADMIN_PASSWORD rejected: ${policy}`);
      process.exitCode = 1;
      return;
    }
  } else {
    password = await collectPassword();
  }
  if (!password) {
    console.error("[reset] No password was provided. Nothing was changed.");
    process.exitCode = 1;
    return;
  }

  console.log("[reset] Connecting…");
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10_000,
    connectTimeoutMS: 10_000,
    autoIndex: false,
  });

  try {
    const admin = await AdminModel.findOne({ email }).lean();
    if (!admin) {
      console.error(`[reset] No admin account exists for ${email}. Nothing was changed.`);
      process.exitCode = 1;
      return;
    }

    const passwordHash = await hashPassword(password);
    await AdminModel.updateOne({ _id: admin._id }, { $set: { passwordHash } }).exec();

    // Credential rotation kills every live session (stolen cookies die now).
    const revoked = await AdminSessionModel.deleteMany({ adminId: admin._id });

    await AuditLogModel.create({
      event: "admin.password_reset",
      outcome: "success",
      adminId: admin._id,
      email: admin.email,
      detail: `Password rotated; ${revoked.deletedCount} session(s) revoked`,
    }).catch(() => undefined);

    console.log(`[reset] Password rotated for ${email}.`);
    console.log(`[reset] Revoked ${revoked.deletedCount} live session(s); the owner must sign in again.`);
  } finally {
    await mongoose.disconnect();
  }
}

reset().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`[reset] Failed: ${message.replace(/\/\/[^\s/@]+@/g, "//<credentials>@")}`);
  process.exitCode = 1;
});
