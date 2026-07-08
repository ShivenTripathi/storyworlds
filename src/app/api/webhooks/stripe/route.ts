import { NextResponse } from "next/server";
import { billingConfigured, constructWebhookEvent, handleWebhookEvent } from "@/services/billing";
import { ApiError, handleApiError } from "@/lib/errors";

export const dynamic = "force-dynamic";

/**
 * Stripe webhook receiver. Verifies the signature against the raw body
 * (never JSON.parse'd first — Stripe signs the exact bytes), then applies
 * known event types via billing.handleWebhookEvent. Always 200s after
 * successfully processing (including "ignored, unknown type") so Stripe
 * doesn't retry; only signature/config failures return non-200.
 */
export async function POST(req: Request) {
  try {
    if (!billingConfigured()) {
      throw new ApiError(503, "billing_disabled", "Billing isn't enabled on this deployment.");
    }

    const signature = req.headers.get("stripe-signature");
    if (!signature) {
      throw new ApiError(400, "invalid_request", "Missing stripe-signature header.");
    }

    const rawBody = await req.text();

    let event;
    try {
      event = constructWebhookEvent(rawBody, signature);
    } catch (err) {
      console.error("[webhooks/stripe] signature verification failed:", err);
      throw new ApiError(400, "invalid_signature", "Webhook signature verification failed.");
    }

    await handleWebhookEvent(event);

    return NextResponse.json({ received: true });
  } catch (e) {
    return handleApiError(e);
  }
}
