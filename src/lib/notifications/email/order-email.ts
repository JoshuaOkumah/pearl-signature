import { formatCad } from "@/lib/format";
import { ORDER_STATUS_LABELS } from "@/lib/orders/lifecycle";
import type { NotificationEvent, NotificationRecipientRole } from "../events";
import type { NotificationOrderFacts } from "../facts";
import {
  button,
  callout,
  detailTable,
  divider,
  heading,
  lineItems,
  muted,
  panel,
  paragraph,
  spacer,
  totalRow,
  type DetailRow,
  type PanelTone,
} from "./components";
import { escapeHtml, renderEmailDocument } from "./layout";

/**
 * Order and payment email templates (Phase 7).
 *
 * Every message is built from the SAME stored order snapshot and the same
 * shared blocks. Two rules are enforced by construction:
 *
 *  1. **No invented facts.** The copy states only what the order record says:
 *     reference, status, items, totals, fulfilment method, configured pickup
 *     instructions, payment method and payment state. There is no delivery
 *     estimate, driver location, opening hours or pickup address unless the
 *     owner configured one.
 *  2. **No false payment claims.** Cash on Arrival is never called paid until
 *     `payment.status === "paid"`. Online payment is only called received after
 *     the verified Stripe pipeline wrote that state. A cancellation says a
 *     refund is reviewed separately, never that money was returned.
 *
 * Customer copy contains no em dashes and no capability tokens. Links point to
 * `/track?ref=...` (which still requires authorization) and the authenticated
 * admin order page.
 */

export interface BuiltEmail {
  subject: string;
  html: string;
  text: string;
}

const FOOTER = "PEARL Signature - Canadian Nigerian kitchen";

function cad(cents: number): string {
  return formatCad(cents) ?? "Amount unavailable";
}

function methodLabel(facts: NotificationOrderFacts): string {
  return facts.method === "delivery" ? "Delivery" : "Pickup";
}

function paymentMethodLabel(facts: NotificationOrderFacts): string {
  return facts.paymentMethod === "stripe" ? "Online payment" : "Cash on arrival";
}

function trackingUrl(facts: NotificationOrderFacts): string | null {
  return facts.siteUrl ? `${facts.siteUrl}/track?ref=${encodeURIComponent(facts.reference)}` : null;
}

function adminOrderUrl(facts: NotificationOrderFacts): string | null {
  return facts.siteUrl ? `${facts.siteUrl}/admin/orders/${encodeURIComponent(facts.reference)}` : null;
}

function itemRows(facts: NotificationOrderFacts) {
  return (facts.items ?? []).map((item) => ({
    name: item.name,
    variantName: item.variantName,
    quantity: item.quantity,
    unitPrice: cad(item.unitPriceCents),
    lineTotal: cad(item.lineTotalCents),
  }));
}

function itemsHtml(facts: NotificationOrderFacts): string {
  const rows = itemRows(facts);
  return rows.length === 0 ? "" : lineItems(rows);
}

function itemsText(facts: NotificationOrderFacts): string[] {
  if (!facts.items?.length) return [];
  return [
    "Items:",
    ...facts.items.map((item) => {
      const variant = item.variantName ? ` (${item.variantName})` : "";
      return `- ${item.quantity} x ${item.name}${variant} - ${cad(item.lineTotalCents)}`;
    }),
    "",
  ];
}

function moneyRows(facts: NotificationOrderFacts): DetailRow[] {
  const rows: DetailRow[] = [];
  if (facts.money) {
    rows.push({ label: "Subtotal", value: cad(facts.money.subtotalCents) });
    rows.push({
      label: "Delivery fee",
      value: facts.money.deliveryFeeCents > 0 ? cad(facts.money.deliveryFeeCents) : "No delivery fee",
    });
    rows.push({
      label: facts.money.taxLabel ?? "Tax",
      value: cad(facts.money.taxCents),
    });
  }
  return rows;
}

function totalsHtml(facts: NotificationOrderFacts): string {
  const rows = moneyRows(facts);
  if (rows.length === 0) return totalRow("Total", cad(facts.totalCents));
  return `${detailTable(rows)}${totalRow("Total", cad(facts.totalCents))}`;
}

function totalsText(facts: NotificationOrderFacts): string[] {
  const lines: string[] = [];
  if (facts.money) {
    lines.push(`Subtotal: ${cad(facts.money.subtotalCents)}`);
    lines.push(
      `Delivery fee: ${facts.money.deliveryFeeCents > 0 ? cad(facts.money.deliveryFeeCents) : "No delivery fee"}`,
    );
    lines.push(`${facts.money.taxLabel ?? "Tax"}: ${cad(facts.money.taxCents)}`);
  }
  lines.push(`Total: ${cad(facts.totalCents)}`);
  return lines;
}

function fulfilmentRows(facts: NotificationOrderFacts): DetailRow[] {
  const rows: DetailRow[] = [{ label: "Fulfilment", value: methodLabel(facts) }];
  if (facts.method === "delivery" && facts.serviceAreaLabel) {
    rows.push({ label: "Delivery area", value: facts.serviceAreaLabel });
  }
  return rows;
}

function fulfilmentText(facts: NotificationOrderFacts): string[] {
  const lines = [`Fulfilment: ${methodLabel(facts)}`];
  if (facts.method === "delivery" && facts.serviceAreaLabel) {
    lines.push(`Delivery area: ${facts.serviceAreaLabel}`);
  }
  if (facts.method === "pickup" && facts.pickupInstructions) {
    lines.push(`Pickup: ${facts.pickupInstructions}`);
  }
  return lines;
}

function statusPanel(facts: NotificationOrderFacts): { html: string; text: string } {
  const tone: PanelTone =
    facts.status === "cancelled" ? "warning" : facts.status === "completed" ? "success" : "neutral";
  const label = ORDER_STATUS_LABELS[facts.status];
  return {
    html: panel(tone, "Order status", label),
    text: `Order status: ${label}`,
  };
}

interface PaymentSummary {
  label: string;
  detail: string;
  tone: PanelTone;
}

/** Customer-facing payment state. No provider jargon, no false success. */
export function paymentSummary(facts: NotificationOrderFacts): PaymentSummary | null {
  if (!facts.paymentMethod) return null;
  const cancelled = facts.status === "cancelled";
  const status = facts.paymentStatus ?? "unpaid";

  if (facts.paymentMethod === "cash_on_arrival") {
    if (status === "paid") {
      return {
        label: "Cash on arrival",
        detail: "Payment received. Thank you.",
        tone: "success",
      };
    }
    return {
      label: "Cash on arrival",
      detail: cancelled
        ? "No cash payment was recorded for this cancelled order."
        : `Payment of ${cad(facts.totalCents)} is due when the order is delivered or collected.`,
      tone: "neutral",
    };
  }

  switch (status) {
    case "paid":
      return { label: "Online payment", detail: "Paid online. Payment has been confirmed.", tone: "success" };
    case "partially_refunded":
    case "refunded":
      return {
        label: "Online payment",
        detail: "A refund has been confirmed by the payment provider.",
        tone: "success",
      };
    case "failed":
    case "expired":
      return {
        label: "Online payment",
        detail: "The online payment was not completed.",
        tone: "warning",
      };
    case "review_required":
      return {
        label: "Online payment",
        detail: "The payment is under review. No action is needed from you right now.",
        tone: "warning",
      };
    case "awaiting_payment":
    case "processing":
      return {
        label: "Online payment",
        detail: "Payment is pending verification.",
        tone: "neutral",
      };
    default:
      return {
        label: "Online payment",
        detail: cancelled
          ? "No online payment was confirmed for this cancelled order."
          : "Payment has not been started.",
        tone: "neutral",
      };
  }
}

function paymentHtml(facts: NotificationOrderFacts): string {
  const summary = paymentSummary(facts);
  if (!summary) return "";
  return panel(summary.tone, summary.label, summary.detail);
}

function paymentText(facts: NotificationOrderFacts): string[] {
  const summary = paymentSummary(facts);
  return summary ? [`Payment: ${summary.label} - ${summary.detail}`] : [];
}

function trackingAction(facts: NotificationOrderFacts): string {
  const url = trackingUrl(facts);
  return url ? button(url, "Track this order") : "";
}

function trackingText(facts: NotificationOrderFacts): string[] {
  const url = trackingUrl(facts);
  return url ? ["Track this order:", url, ""] : [];
}

function detailRows(facts: NotificationOrderFacts, extra: DetailRow[] = []): DetailRow[] {
  return [
    { label: "Order", value: facts.reference },
    { label: "Status", value: ORDER_STATUS_LABELS[facts.status] },
    ...extra,
    ...fulfilmentRows(facts),
  ];
}

function detailText(facts: NotificationOrderFacts, extra: string[] = []): string[] {
  return [
    `Order: ${facts.reference}`,
    `Status: ${ORDER_STATUS_LABELS[facts.status]}`,
    ...extra,
    ...fulfilmentText(facts),
  ];
}

function closingNote(): string {
  return "Keep your order reference for any questions about this order.";
}

/** Customer cancellation copy: accurate about refunds, never promising money back. */
function cancellationCopy(facts: NotificationOrderFacts): string {
  const status = facts.paymentStatus ?? "unpaid";
  if (facts.paymentMethod === "stripe" && (status === "refunded" || status === "partially_refunded")) {
    return "A refund has been confirmed by the payment provider.";
  }
  if (facts.paymentMethod === "stripe" && status === "paid") {
    return "A refund has not been confirmed yet. The store reviews any refund separately and will contact you if an action is needed.";
  }
  return "No payment was taken for this order.";
}

function subjectFor(event: NotificationEvent, role: NotificationRecipientRole, facts: NotificationOrderFacts): string {
  const ref = facts.reference;
  if (event === "order.placed") {
    return role === "admin" ? `New order ${ref}` : `Order ${ref} received`;
  }
  switch (event) {
    case "order.confirmed":
      return `Order ${ref} confirmed`;
    case "order.preparing":
      return `Order ${ref} is being prepared`;
    case "order.ready_for_pickup":
      return `Order ${ref} is ready for pickup`;
    case "order.out_for_delivery":
      return `Order ${ref} is out for delivery`;
    case "order.completed":
      return `Order ${ref} complete`;
    case "order.cancelled":
      return `Order ${ref} cancelled`;
    case "order.status_changed":
      return `Order ${ref} status update`;
    case "payment.confirmed":
      return `Payment received for order ${ref}`;
    case "payment.collected":
      return `Cash payment received for order ${ref}`;
    case "payment.failed":
      return `Payment not completed for order ${ref}`;
    case "payment.requires_attention":
      return `Payment needs review for order ${ref}`;
    case "payment.refund_review":
      return `Refund review needed for order ${ref}`;
    default:
      return `Order ${ref} update`;
  }
}

/**
 * Build one complete email for an event + recipient role.
 *
 * The function is pure: no database read, no environment read. Recipients are
 * resolved by the dispatcher and links come from the configured site origin in
 * `facts`.
 */
export function buildOrderEmail(
  event: NotificationEvent,
  role: NotificationRecipientRole,
  facts: NotificationOrderFacts,
): BuiltEmail {
  const subject = subjectFor(event, role, facts);
  const blocks: string[] = [];
  const text: string[] = [];

  if (event === "order.placed" && role === "admin") {
    blocks.push(
      heading("New order received"),
      paragraph(`Order ${facts.reference} has been placed and is waiting for confirmation.`),
      detailTable([
        { label: "Order", value: facts.reference },
        { label: "Customer", value: facts.customerName },
        { label: "Total", value: cad(facts.totalCents) },
        { label: "Fulfilment", value: methodLabel(facts) },
        { label: "Payment method", value: paymentMethodLabel(facts) },
        { label: "Payment status", value: facts.paymentStatus ?? "unpaid" },
      ]),
      spacer(6),
      itemsHtml(facts),
      totalsHtml(facts),
      paymentHtml(facts),
    );
    text.push(
      "New order received.",
      "",
      `Order: ${facts.reference}`,
      `Customer: ${facts.customerName}`,
      `Total: ${cad(facts.totalCents)}`,
      ...fulfilmentText(facts),
      `Payment method: ${paymentMethodLabel(facts)}`,
      ...paymentText(facts),
      "",
      ...itemsText(facts),
      ...totalsText(facts),
      "",
    );
    const adminUrl = adminOrderUrl(facts);
    if (adminUrl) {
      blocks.push(button(adminUrl, "Open in admin"), muted("Sign-in is required to view order details."));
      text.push("Open in admin:", adminUrl, "Sign-in is required to view order details.", "");
    }
    blocks.push(muted("This alert contains no delivery address or phone number. Open the order to see the full record."));
  } else if (event === "payment.requires_attention" || event === "payment.refund_review") {
    const isRefund = event === "payment.refund_review";
    blocks.push(
      heading(isRefund ? "Refund review needed" : "Payment needs review"),
      paragraph(
        isRefund
          ? `Order ${facts.reference} was cancelled after an online payment was confirmed. No refund was initiated automatically.`
          : `The payment provider reported a payment that needs review for order ${facts.reference}.`,
      ),
      detailTable(detailRows(facts, [{ label: "Payment status", value: facts.paymentStatus ?? "review_required" }])),
      callout("Verify the payment with the payment provider before taking any financial action."),
    );
    text.push(
      isRefund ? "Refund review needed." : "Payment needs review.",
      "",
      `Order: ${facts.reference}`,
      ...fulfilmentText(facts),
      "Verify the payment with the payment provider before taking any financial action.",
      "",
    );
    const adminUrl = adminOrderUrl(facts);
    if (adminUrl) {
      blocks.push(button(adminUrl, "Review in admin"));
      text.push("Review in admin:", adminUrl, "");
    }
  } else {
    // Customer-facing messages.
    const intro = (() => {
      switch (event) {
        case "order.placed":
          return `Hello ${facts.customerName}, we have received order ${facts.reference}. The kitchen will confirm it shortly.`;
        case "order.confirmed":
          return `Hello ${facts.customerName}, we have confirmed order ${facts.reference}.`;
        case "order.preparing":
          return `Hello ${facts.customerName}, we are preparing order ${facts.reference}.`;
        case "order.ready_for_pickup":
          return `Hello ${facts.customerName}, order ${facts.reference} is ready for pickup.`;
        case "order.out_for_delivery":
          return `Hello ${facts.customerName}, order ${facts.reference} is out for delivery.`;
        case "order.completed":
          return `Hello ${facts.customerName}, order ${facts.reference} is complete.`;
        case "order.cancelled":
          return `Hello ${facts.customerName}, order ${facts.reference} has been cancelled.`;
        case "payment.confirmed":
          return `Hello ${facts.customerName}, we have confirmed your online payment for order ${facts.reference}.`;
        case "payment.collected":
          return `Hello ${facts.customerName}, we have recorded the cash payment for order ${facts.reference}.`;
        case "payment.failed":
          return `Hello ${facts.customerName}, the online payment for order ${facts.reference} was not completed.`;
        default:
          return `Hello ${facts.customerName}, the status of order ${facts.reference} has been updated.`;
      }
    })();

    const title = (() => {
      switch (event) {
        case "order.placed":
          return "Thank you for your order";
        case "order.confirmed":
          return "Your order is confirmed";
        case "order.preparing":
          return "Your order is being prepared";
        case "order.ready_for_pickup":
          return "Ready for pickup";
        case "order.out_for_delivery":
          return "Out for delivery";
        case "order.completed":
          return "Order complete";
        case "order.cancelled":
          return "Order cancelled";
        case "payment.confirmed":
          return "Payment received";
        case "payment.collected":
          return "Cash payment received";
        case "payment.failed":
          return "Payment not completed";
        default:
          return "Order status updated";
      }
    })();

    blocks.push(heading(title), paragraph(intro));
    text.push(intro, "");

    if (event === "order.cancelled") {
      blocks.push(panel("warning", "Order cancelled", cancellationCopy(facts)));
      text.push(`Order cancelled: ${cancellationCopy(facts)}`, "");
    } else if (event === "order.ready_for_pickup") {
      blocks.push(
        facts.pickupInstructions
          ? callout(`Pickup: ${facts.pickupInstructions}`)
          : paragraph("Bring your order reference when you collect the order."),
      );
      // Configured pickup instructions already appear in the fulfilment
      // lines below; only the fallback sentence needs its own text line.
      if (!facts.pickupInstructions) {
        text.push("Bring your order reference when you collect the order.", "");
      }
    } else if (event === "order.out_for_delivery") {
      blocks.push(paragraph("The store has not provided a delivery estimate in this message."));
      text.push("The store has not provided a delivery estimate in this message.", "");
    } else if (event === "order.completed") {
      blocks.push(paragraph("Thank you for ordering from PEARL Signature."));
      text.push("Thank you for ordering from PEARL Signature.", "");
    } else if (event === "payment.failed") {
      if (facts.status !== "cancelled") {
        blocks.push(paragraph("Your order details are saved. You can return to your order to try again."));
        text.push("Your order details are saved. You can return to your order to try again.", "");
      }
    } else {
      const status = statusPanel(facts);
      blocks.push(status.html);
      text.push(status.text, "");
    }

    if (event === "order.placed") {
      blocks.push(itemsHtml(facts), totalsHtml(facts));
      text.push(...itemsText(facts), ...totalsText(facts), "");
    } else if (
      event === "payment.confirmed" ||
      event === "payment.collected" ||
      event === "order.completed" ||
      event === "order.cancelled"
    ) {
      blocks.push(
        detailTable(
          detailRows(facts, [
            {
              label: event === "payment.collected" ? "Amount received" : "Total",
              value: cad(facts.totalCents),
              strong: true,
            },
          ]),
        ),
      );
      text.push(
        ...detailText(facts, [
          `${event === "payment.collected" ? "Amount received" : "Total"}: ${cad(facts.totalCents)}`,
        ]),
        "",
      );
    } else {
      blocks.push(
        detailTable(
          detailRows(facts, [
            { label: "Total", value: cad(facts.totalCents) },
          ]),
        ),
      );
      text.push(...detailText(facts, [`Total: ${cad(facts.totalCents)}`]), "");
    }

    blocks.push(paymentHtml(facts));
    text.push(...paymentText(facts), "");

    if (event === "order.placed" || event === "order.confirmed" || event === "order.preparing" ||
        event === "order.ready_for_pickup" || event === "order.out_for_delivery" ||
        event === "order.completed" || event === "order.cancelled" || event === "order.status_changed") {
      blocks.push(trackingAction(facts));
      text.push(...trackingText(facts));
    }

    blocks.push(divider(), muted(closingNote()));
    text.push(closingNote());
  }

  const html = renderEmailDocument({
    preheader: `${subject} - ${ORDER_STATUS_LABELS[facts.status]}`,
    title: subject,
    blocks,
    footerNote: `${FOOTER}. Order ${facts.reference}.`,
  });

  return { subject, html, text: text.join("\n").replace(/\n{3,}/g, "\n\n").trim() };
}

/** Exposed for tests: proves no dynamic value can inject markup. */
export function escapeForEmail(value: string): string {
  return escapeHtml(value);
}
