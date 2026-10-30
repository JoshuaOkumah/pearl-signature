// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { NotificationDeliveryError } from "@/lib/notifications/contract";
import { createResendProvider, parseRetryAfter, resendProviderFromEnv } from "./resend";

/**
 * Resend adapter tests (Phase 7).
 *
 * A fake `fetch` stands in for the provider: these are deterministic unit
 * tests, not evidence of real delivery. The adapter's job is to map an HTTP
 * outcome to an honest failure kind and to never store a vendor body.
 */

const sender = { name: "PEARL Signature", email: "orders@pearl.example", raw: "PEARL Signature <orders@pearl.example>" };

function response(status: number, body: unknown = {}, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json", ...headers },
  });
}

const message = {
  to: "ada@example.com",
  subject: "Order PS-1A2B3C4D5E received",
  text: "Hello",
  html: "<p>Hello</p>",
  idempotencyKey: "order.placed:PS-1A2B3C4D5E:customer",
};

describe("parseSender", () => {
  it("accepts bare and named senders, rejects guesses", async () => {
    const { parseSender } = await import("@/lib/notifications/config");
    expect(parseSender("orders@pearl.example")).toEqual({
      name: null,
      email: "orders@pearl.example",
      raw: "orders@pearl.example",
    });
    expect(parseSender('"PEARL Signature" <orders@pearl.example>')).toEqual(sender);
    expect(parseSender("PEARL Signature <not-an-email>")).toBeNull();
    expect(parseSender("")).toBeNull();
    expect(parseSender(undefined)).toBeNull();
  });
});

describe("createResendProvider", () => {
  it("posts the rendered message with a stable idempotency key", async () => {
    const fetchImpl = vi.fn(async () => response(200, { id: "re_123" }));
    const provider = createResendProvider({ apiKey: "re_test", sender, fetchImpl: fetchImpl as unknown as typeof fetch });

    const result = await provider.send(message);

    expect(result).toEqual({ providerMessageId: "re_123", status: "accepted" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://api.resend.com/emails");
    expect(init.method).toBe("POST");
    expect((init.headers as Record<string, string>)["idempotency-key"]).toBe(message.idempotencyKey);
    expect((init.headers as Record<string, string>).authorization).toBe("Bearer re_test");
    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.from).toBe(sender.raw);
    expect(body.to).toEqual([message.to]);
    expect(body.subject).toBe(message.subject);
    expect(body.html).toBe(message.html);
    expect(body.text).toBe(message.text);
  });

  it("records acceptance even when the provider omits a message id", async () => {
    const provider = createResendProvider({
      apiKey: "re_test",
      sender,
      fetchImpl: (async () => response(200, {})) as unknown as typeof fetch,
    });
    expect(await provider.send(message)).toEqual({ providerMessageId: null, status: "accepted" });
  });

  it("maps 429 to rate_limited and honours Retry-After", async () => {
    const provider = createResendProvider({
      apiKey: "re_test",
      sender,
      fetchImpl: (async () => response(429, {}, { "retry-after": "90" })) as unknown as typeof fetch,
    });

    const error = await provider.send(message).catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(NotificationDeliveryError);
    expect((error as NotificationDeliveryError).kind).toBe("rate_limited");
    expect((error as NotificationDeliveryError).retryAfterMs).toBe(90_000);
  });

  it("maps 5xx and network failures to ambiguous, never a safe no-op", async () => {
    const server = createResendProvider({
      apiKey: "re_test",
      sender,
      fetchImpl: (async () => response(503)) as unknown as typeof fetch,
    });
    await expect(server.send(message)).rejects.toMatchObject({ kind: "ambiguous" });

    const network = createResendProvider({
      apiKey: "re_test",
      sender,
      fetchImpl: (async () => {
        throw new TypeError("socket hang up");
      }) as unknown as typeof fetch,
    });
    await expect(network.send(message)).rejects.toMatchObject({ kind: "ambiguous" });
  });

  it("maps rejected credentials and rejected messages to permanent failures", async () => {
    for (const status of [401, 403, 422, 400]) {
      const provider = createResendProvider({
        apiKey: "re_test",
        sender,
        fetchImpl: (async () => response(status, { message: "ada@example.com rejected" })) as unknown as typeof fetch,
      });
      const error = await provider.send(message).catch((caught: unknown) => caught);
      expect(error).toBeInstanceOf(NotificationDeliveryError);
      expect((error as NotificationDeliveryError).kind).toBe("permanent");
      // The vendor body (which can echo the recipient) is never surfaced.
      expect((error as NotificationDeliveryError).message).not.toContain("ada@example.com");
    }
  });
});

describe("parseRetryAfter", () => {
  it("accepts seconds and HTTP dates, bounded to one hour", () => {
    expect(parseRetryAfter("30")).toBe(30_000);
    expect(parseRetryAfter("999999")).toBe(3_600_000);
    expect(parseRetryAfter(null)).toBeNull();
    expect(parseRetryAfter("not-a-date")).toBeNull();
  });
});

describe("resendProviderFromEnv", () => {
  it("is not configured without a key or sender", () => {
    const noKey = resendProviderFromEnv({ NOTIFICATION_PROVIDER: "resend", EMAIL_FROM: "orders@pearl.example" });
    expect(noKey.configured).toBe(false);
    expect(noKey.reason).toContain("API key");

    const noSender = resendProviderFromEnv({ NOTIFICATION_PROVIDER: "resend", RESEND_API_KEY: "re_test" });
    expect(noSender.configured).toBe(false);
    expect(noSender.reason).toContain("Sender");

    const ready = resendProviderFromEnv({
      NOTIFICATION_PROVIDER: "resend",
      RESEND_API_KEY: "re_test",
      EMAIL_FROM: "orders@pearl.example",
    });
    expect(ready.configured).toBe(true);
  });
});
