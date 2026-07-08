import { eq } from "drizzle-orm";
import Stripe from "stripe";
import { db, dbReady } from "@/db";
import { subscriptions, users } from "@/db/schema";
import { env } from "@/lib/env";
import { ApiError } from "@/lib/errors";

/**
 * Billing is entirely opt-in and card-free by default (see ZERO-COST
 * CONSTRAINT in CLAUDE.md): unless BILLING_ENABLED=true AND a Stripe secret
 * key is configured, every function here throws a stable 503
 * `billing_disabled` ApiError, and the route handlers surface that as-is.
 * Stripe's own test mode requires no card, so this can be exercised in dev
 * without ever touching a real payment method.
 */
export function billingConfigured(): boolean {
  return env.BILLING_ENABLED && Boolean(env.STRIPE_SECRET_KEY);
}

function requireBilling(): void {
  if (!billingConfigured()) {
    throw new ApiError(
      503,
      "billing_disabled",
      "Billing isn't enabled on this deployment.",
    );
  }
}

let stripeClient: Stripe | undefined;

function getStripe(): Stripe {
  requireBilling();
  if (!stripeClient) {
    stripeClient = new Stripe(env.STRIPE_SECRET_KEY as string);
  }
  return stripeClient;
}

/**
 * Creates a Stripe Checkout session for the Reader subscription plan.
 * `client_reference_id` carries our internal userId so the webhook can
 * attribute the resulting subscription without any prior Stripe customer
 * mapping.
 */
export async function createCheckoutSession(userId: string): Promise<{ url: string }> {
  requireBilling();
  if (!env.STRIPE_PRICE_READER) {
    throw new ApiError(503, "billing_disabled", "No Reader plan price is configured.");
  }

  const stripe = getStripe();
  const session = await stripe.checkout.sessions.create({
    mode: "subscription",
    client_reference_id: userId,
    line_items: [{ price: env.STRIPE_PRICE_READER, quantity: 1 }],
    success_url: `${env.APP_URL}/settings?checkout=success`,
    cancel_url: `${env.APP_URL}/settings?checkout=cancelled`,
  });

  if (!session.url) {
    throw new Error("Stripe checkout session created without a url");
  }
  return { url: session.url };
}

/**
 * Creates a Stripe billing portal session for the caller's existing
 * customer. Requires an active/former subscription (i.e. a
 * stripeCustomerId on file) — there's nothing to manage otherwise.
 */
export async function createPortalSession(userId: string): Promise<{ url: string }> {
  requireBilling();
  await dbReady;

  const [row] = await db
    .select({ stripeCustomerId: subscriptions.stripeCustomerId })
    .from(subscriptions)
    .where(eq(subscriptions.userId, userId))
    .limit(1);

  if (!row?.stripeCustomerId) {
    throw new ApiError(
      404,
      "no_customer",
      "No billing account found for this user yet.",
    );
  }

  const stripe = getStripe();
  const session = await stripe.billingPortal.sessions.create({
    customer: row.stripeCustomerId,
    return_url: `${env.APP_URL}/settings`,
  });

  return { url: session.url };
}

/** Verifies and parses a raw webhook payload into a Stripe.Event. */
export function constructWebhookEvent(rawBody: string, signature: string): Stripe.Event {
  requireBilling();
  if (!env.STRIPE_WEBHOOK_SECRET) {
    throw new ApiError(503, "billing_disabled", "Webhook secret not configured.");
  }
  const stripe = getStripe();
  return stripe.webhooks.constructEvent(rawBody, signature, env.STRIPE_WEBHOOK_SECRET);
}

async function upsertSubscription(row: {
  userId: string;
  stripeCustomerId: string;
  stripeSubscriptionId: string;
  plan: string;
  status: string;
  currentPeriodEnd?: Date | null;
}): Promise<void> {
  await dbReady;

  await db
    .insert(subscriptions)
    .values({
      userId: row.userId,
      stripeCustomerId: row.stripeCustomerId,
      stripeSubscriptionId: row.stripeSubscriptionId,
      plan: row.plan,
      status: row.status,
      currentPeriodEnd: row.currentPeriodEnd ?? null,
    })
    .onConflictDoUpdate({
      target: subscriptions.userId,
      set: {
        stripeCustomerId: row.stripeCustomerId,
        stripeSubscriptionId: row.stripeSubscriptionId,
        plan: row.plan,
        status: row.status,
        currentPeriodEnd: row.currentPeriodEnd ?? null,
        updatedAt: new Date(),
      },
    });
}

async function syncSubscriptionStatus(
  stripeSubscriptionId: string,
  status: string,
  currentPeriodEnd: Date | null,
): Promise<void> {
  await dbReady;
  await db
    .update(subscriptions)
    .set({ status, currentPeriodEnd, updatedAt: new Date() })
    .where(eq(subscriptions.stripeSubscriptionId, stripeSubscriptionId));
}

function periodEndFromSubscription(sub: Stripe.Subscription): Date | null {
  const item = sub.items.data[0];
  const ts = item?.current_period_end;
  return typeof ts === "number" ? new Date(ts * 1000) : null;
}

/**
 * Applies a verified Stripe event to our `subscriptions` table. Idempotent
 * (upserts keyed on userId / stripeSubscriptionId), so redelivered webhooks
 * are harmless. Unknown event types are ignored (still a 200 — Stripe
 * shouldn't retry events we don't care about).
 */
export async function handleWebhookEvent(event: Stripe.Event): Promise<void> {
  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as Stripe.Checkout.Session;
      const userId = session.client_reference_id;
      const customerId =
        typeof session.customer === "string" ? session.customer : session.customer?.id;
      const subscriptionId =
        typeof session.subscription === "string"
          ? session.subscription
          : session.subscription?.id;

      if (!userId || !customerId || !subscriptionId) {
        console.warn(
          "[billing] checkout.session.completed missing userId/customer/subscription",
        );
        return;
      }

      // Ensure the users row exists in case webhook races the user's next
      // sign-in (unlikely, but cheap to guard).
      await dbReady;
      await db.insert(users).values({ id: userId }).onConflictDoNothing();

      await upsertSubscription({
        userId,
        stripeCustomerId: customerId,
        stripeSubscriptionId: subscriptionId,
        plan: "reader",
        status: "active",
      });
      return;
    }

    case "customer.subscription.updated":
    case "customer.subscription.deleted": {
      const sub = event.data.object as Stripe.Subscription;
      await syncSubscriptionStatus(sub.id, sub.status, periodEndFromSubscription(sub));
      return;
    }

    default:
      // Ignore anything else — still a 200 so Stripe stops retrying.
      return;
  }
}
