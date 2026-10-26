import { stripeClient, stripeReadiness } from "@/lib/payments/stripe";
import { processStripeEvent } from "@/lib/payments/webhooks";

// Node runtime is the default for App Router Route Handlers, and this project
// runs with `cacheComponents`, which forbids an explicit `runtime` export.
const MAX_WEBHOOK_BYTES = 1_000_000;

function response(status: number, message: string): Response {
  return new Response(message, {
    status,
    headers: {
      "Cache-Control": "private, no-store, max-age=0",
      "Content-Type": "text/plain; charset=utf-8",
      "X-Content-Type-Options": "nosniff",
    },
  });
}

/** Stripe's webhook endpoint. It intentionally does not use admin cookies. */
export async function POST(request: Request): Promise<Response> {
  if (!stripeReadiness().ready) return response(503, "Webhook is not configured");
  const declaredLength = Number(request.headers.get("content-length") ?? 0);
  if (declaredLength > MAX_WEBHOOK_BYTES) return response(413, "Request too large");
  const signature = request.headers.get("stripe-signature");
  if (!signature || signature.length > 2_000) return response(400, "Invalid webhook signature");

  let event;
  try {
    const rawBody = Buffer.from(await request.arrayBuffer());
    if (rawBody.byteLength > MAX_WEBHOOK_BYTES) return response(413, "Request too large");
    event = stripeClient().webhooks.constructEvent(rawBody, signature, process.env.STRIPE_WEBHOOK_SECRET!.trim());
  } catch {
    return response(400, "Invalid webhook signature");
  }

  try {
    await processStripeEvent(event);
    return response(200, "Received");
  } catch {
    // Do not acknowledge processing until durable state has been applied.
    // Stripe will retry on 5xx; internal details never leave this endpoint.
    return response(500, "Webhook processing failed");
  }
}
