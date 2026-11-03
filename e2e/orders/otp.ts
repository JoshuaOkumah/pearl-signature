import { readFile } from "node:fs/promises";
import path from "node:path";

/**
 * Read the newest six-digit code the file-sink provider wrote for an address.
 *
 * The sink stores the full rendered message (see
 * `src/lib/notifications/providers/file-sink.ts`), which is acceptable for
 * synthetic E2E fixtures and never for real customer data. Codes are matched by
 * recipient AND subject so a checkout code can never be mistaken for a recovery
 * or tracking code sent to the same address.
 *
 * Polling is deliberate: the provider is awaited by the Server Action, but the
 * browser can observe the UI a moment before the file is flushed.
 */

export interface SinkMessage {
  at: string;
  to: string;
  subject: string;
  text: string;
  html: string;
}

export async function readSinkMessages(sinkFile: string): Promise<SinkMessage[]> {
  const file = path.resolve(process.cwd(), sinkFile);
  try {
    const raw = await readFile(file, "utf8");
    return raw
      .split("\n")
      .filter((line) => line.trim() !== "")
      .map((line) => JSON.parse(line) as SinkMessage);
  } catch {
    return [];
  }
}

export async function readLatestCode(
  email: string,
  subject: string,
  sinkFile: string,
  timeoutMs = 15_000,
): Promise<string> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const messages = (await readSinkMessages(sinkFile)).filter(
      (message) => message.to === email && message.subject === subject,
    );
    const latest = messages.at(-1);
    const code = latest?.text ? /\b\d{6}\b/.exec(latest.text)?.[0] : undefined;
    if (code) return code;
    if (Date.now() >= deadline) {
      throw new Error(`No six-digit code for ${email} ("${subject}") was written to ${sinkFile}`);
    }
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
}

/** Count messages already sent for an address, to prove no extra email went out. */
export async function countMessagesFor(
  email: string,
  subject: string,
  sinkFile: string,
): Promise<number> {
  const messages = await readSinkMessages(sinkFile);
  return messages.filter((message) => message.to === email && message.subject === subject).length;
}
