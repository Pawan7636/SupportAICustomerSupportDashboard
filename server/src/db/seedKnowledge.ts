/**
 * Seed the knowledge_base table with realistic support articles.
 *
 * Run:  npx tsx server/src/db/seedKnowledge.ts
 *
 * The script is idempotent — it deletes existing articles before inserting,
 * then generates embeddings for each one using the Gemini embedding API.
 * Make sure GEMINI_API_KEY is set in server/.env before running.
 */
import "dotenv/config";
import { getDb } from "./database";
import { createArticle, saveEmbedding, listArticles, deleteArticle } from "./knowledgeBase";
import { embedText } from "../utils/embeddings";
import { logger } from "../utils/logger";

// ─────────────────────────────────────────────────────────────────────────────
//  Knowledge Base seed data
// ─────────────────────────────────────────────────────────────────────────────

const ARTICLES = [
  // ── Orders ───────────────────────────────────────────────────────────────
  {
    title: "How to track your order",
    category: "orders" as const,
    tags: ["tracking", "shipment", "delivery"],
    content: `Once your order has shipped, you will receive a shipping confirmation email with a tracking number and a direct link to the carrier's tracking page.

To track your order manually:
1. Log in to your account at app.supportai.com.
2. Click "Orders" in the top navigation menu.
3. Select the order you want to track.
4. Click "Track shipment" — this opens the carrier's live tracking page in a new tab.

Tracking updates can take up to 24 hours to appear after the shipment label is created. If you placed your order more than 5 business days ago and there is still no tracking activity, please contact support with your order number.`,
  },
  {
    title: "Estimated delivery times by region",
    category: "orders" as const,
    tags: ["delivery", "shipping", "timeline"],
    content: `Standard estimated delivery windows are:

- United States (domestic): 3–5 business days
- Canada: 5–8 business days
- United Kingdom & EU: 7–10 business days
- Australia & New Zealand: 10–14 business days
- Rest of world: 14–21 business days

Express shipping is available at checkout for US, Canada, UK, and EU orders. Express orders ship within 1 business day and arrive in 2–3 business days.

Delivery times are estimates and may be affected by carrier delays, customs processing, or public holidays. Orders placed on weekends or public holidays are processed the next business day.`,
  },
  {
    title: "Modifying or cancelling an order",
    category: "orders" as const,
    tags: ["cancel", "modify", "change order"],
    content: `Orders can be modified or cancelled within 1 hour of placement, before they enter the fulfilment queue.

To cancel or change your order:
1. Go to Orders in your account dashboard.
2. Select the order and click "Cancel or modify."
3. Choose the action you want and confirm.

If more than 1 hour has passed, the order may already be packed and cannot be changed. In that case, you can refuse the delivery and the parcel will be returned to us. Once we receive it back, we will issue a full refund within 5–7 business days.

For urgent cases, contact support via live chat and include your order number — our team can sometimes intercept an order at the warehouse if it has not yet been dispatched.`,
  },
  {
    title: "What to do if your order arrives damaged",
    category: "orders" as const,
    tags: ["damaged", "broken", "wrong item", "defective"],
    content: `If your order arrives damaged or you received the wrong item, please do the following within 48 hours of delivery:

1. Take clear photos of the damaged item and the outer packaging (all sides).
2. Contact support via chat or email and attach the photos.
3. Include your order number and a brief description of the damage.

We will arrange a replacement shipment or issue a full refund — your choice. You do not need to return a damaged item unless specifically requested. Replacement orders are expedited and typically ship within 1 business day.`,
  },

  // ── Payments ─────────────────────────────────────────────────────────────
  {
    title: "Accepted payment methods",
    category: "payments" as const,
    tags: ["payment", "credit card", "PayPal", "Apple Pay"],
    content: `We accept the following payment methods:

- Credit and debit cards: Visa, Mastercard, American Express, Discover
- PayPal (including Pay Later where available)
- Apple Pay (Safari on Mac/iOS)
- Google Pay (Chrome on Android)
- Bank transfer (available for orders over $500 USD — contact sales)

All transactions are processed over TLS and are PCI-DSS compliant. Card numbers are never stored on our servers — payments are handled by Stripe.

Cryptocurrency payments are not currently accepted.`,
  },
  {
    title: "Why was I charged twice?",
    category: "payments" as const,
    tags: ["double charge", "duplicate charge", "billing error"],
    content: `A double charge on your statement is almost always a temporary authorisation hold, not an actual duplicate payment.

When you place an order, your bank places a temporary authorisation hold on the total amount. If your payment is later confirmed, the hold is converted to a real charge and the hold is released. Some banks show both the hold and the final charge, making it look like a double charge.

To confirm:
1. Check your bank statement for a "pending" and a "posted" transaction on the same date.
2. If both are "posted" (not pending), contact support immediately with your order number and a screenshot of your bank statement.

We will verify the charges on our end and issue a refund for the duplicate within 2–3 business days.`,
  },
  {
    title: "Updating your billing information",
    category: "payments" as const,
    tags: ["billing", "credit card", "update payment"],
    content: `To update your billing information:

1. Log in and go to Account → Billing.
2. Click "Manage payment methods."
3. To add a new card, click "Add card" and enter the details.
4. To remove an old card, click the three-dot menu beside it and select "Remove."
5. To set a new default payment method, click "Set as default."

Changes take effect immediately for future purchases. Existing subscriptions will use the new default card on the next billing cycle.

If you need to update billing for a past order already processed, the charge cannot be redirected — please contact your bank for assistance.`,
  },
  {
    title: "Invoice and receipt requests",
    category: "payments" as const,
    tags: ["invoice", "receipt", "VAT", "billing document"],
    content: `Receipts are emailed automatically after every successful payment. If you did not receive yours:

1. Check your spam or promotions folder.
2. Log in → Orders → select the order → click "Download receipt."

For formal VAT invoices (EU customers) or business invoices with PO numbers:
- Go to Account → Billing → Invoices.
- Click "Request VAT invoice" on the relevant transaction.
- Enter your VAT number and business name and submit the request.

Business invoices are generated within 1–2 business days. For bulk invoice requests or custom billing requirements, contact billing@supportai.com.`,
  },

  // ── Refunds ───────────────────────────────────────────────────────────────
  {
    title: "Refund policy overview",
    category: "refunds" as const,
    tags: ["refund", "return", "money back"],
    content: `We offer a 30-day money-back guarantee on all orders, no questions asked.

To request a refund:
1. Go to Orders and select the order.
2. Click "Request refund."
3. Choose a reason (optional) and confirm.

Refunds are returned to the original payment method:
- Credit/debit card: 5–7 business days (depends on your bank)
- PayPal: 1–3 business days
- Bank transfer: 7–10 business days

After 30 days, refunds are granted at our discretion for defective or misrepresented items only. Digital products that have been downloaded or activated are non-refundable after 14 days.`,
  },
  {
    title: "How to return a physical item",
    category: "refunds" as const,
    tags: ["return", "shipping label", "post", "send back"],
    content: `To return a physical item within 30 days:

1. Go to Orders → select the order → click "Start return."
2. Select the items you want to return and choose a reason.
3. Download and print the prepaid return shipping label (US, CA, UK, and EU only).
4. Pack the items securely in their original packaging if possible.
5. Drop the parcel at any location that accepts the carrier shown on the label.

International returns outside US/CA/UK/EU are at the customer's shipping cost. We recommend using a tracked service. Refunds are processed within 3–5 business days after we receive and inspect the return.

Items must be in their original, unused condition. We reserve the right to deduct a restocking fee of up to 15% for items returned in poor condition.`,
  },
  {
    title: "Tracking your refund status",
    category: "refunds" as const,
    tags: ["refund status", "refund pending", "where is my refund"],
    content: `After a refund has been approved, you will receive a confirmation email with a refund ID.

To check the status:
1. Go to Account → Billing → Refunds.
2. Find the refund by date or order number.
3. The status will show as Pending, Processing, or Completed.

"Pending" means we have approved the refund but it has not yet been sent to your bank.
"Processing" means the refund has been submitted to your payment provider.
"Completed" means the funds have been released by us — your bank may still take 1–5 days to reflect it.

If your refund shows "Completed" but you have not received the funds after 7 business days, contact your bank first with the refund ID. If the bank cannot locate it, contact our billing team.`,
  },

  // ── Account ───────────────────────────────────────────────────────────────
  {
    title: "Resetting your password",
    category: "account" as const,
    tags: ["password", "forgot password", "login", "reset"],
    content: `If you have forgotten your password:

1. Go to the sign-in page and click "Forgot password."
2. Enter the email address associated with your account.
3. Click the reset link in the email (valid for 30 minutes).
4. Set a new password — it must be at least 8 characters and include an uppercase letter, lowercase letter, number, and special character.

If you do not receive the email within 5 minutes, check your spam folder. The email is sent from no-reply@supportai.com.

If you no longer have access to the email address on the account, contact support with proof of identity (government-issued ID) and we can transfer the account to a new email.`,
  },
  {
    title: "Updating your account email or personal details",
    category: "account" as const,
    tags: ["account", "email change", "name", "profile"],
    content: `To update your name, email, or other profile details:

1. Log in and click your avatar in the top-right corner.
2. Select "Account settings."
3. Under "Profile," edit the fields you want to change.
4. Click "Save changes."

Changing your email requires verification: a confirmation link will be sent to the new email address. The change takes effect once you click that link. Your old email will receive a notification for security purposes.

Changing your email does not affect your password or active sessions.`,
  },
  {
    title: "Two-factor authentication (2FA) setup",
    category: "account" as const,
    tags: ["2FA", "MFA", "security", "authenticator"],
    content: `Two-factor authentication adds an extra layer of security to your account.

To enable 2FA:
1. Go to Account → Security.
2. Click "Enable two-factor authentication."
3. Scan the QR code with an authenticator app (Google Authenticator, Authy, 1Password, etc.).
4. Enter the 6-digit code from the app to confirm setup.
5. Save your backup codes in a secure place — these are used if you lose access to your authenticator app.

Once enabled, you will be prompted for a 6-digit code every time you log in from a new device.

To disable 2FA, go to Account → Security and click "Disable." You will need to enter your current 6-digit code or a backup code to confirm.`,
  },
  {
    title: "Closing or deleting your account",
    category: "account" as const,
    tags: ["delete account", "close account", "deactivate", "GDPR"],
    content: `You can close your account at any time from Account → Security → "Close account."

Before closing:
- Cancel any active subscriptions to avoid future charges.
- Download any data you want to keep (orders, invoices, etc.) from Account → Data export.

What happens when you close your account:
- Your account is deactivated immediately — you cannot log in.
- Personal data is anonymised within 30 days in line with our Privacy Policy and GDPR obligations.
- Order history is retained for legal/tax purposes for up to 7 years, but is not linked to your identity.

If you change your mind within 30 days, email privacy@supportai.com with your registered email and we can restore your account. After 30 days, deletion is permanent.`,
  },

  // ── Technical ─────────────────────────────────────────────────────────────
  {
    title: "Supported browsers and devices",
    category: "technical" as const,
    tags: ["browser", "compatibility", "mobile", "iOS", "Android"],
    content: `SupportAI works best on the following browsers and devices:

Supported browsers (latest 2 major versions):
- Google Chrome
- Mozilla Firefox
- Apple Safari
- Microsoft Edge

Mobile:
- iOS 15+ (Safari, Chrome)
- Android 10+ (Chrome, Samsung Internet)

We do not support Internet Explorer. Some features may not work in older browser versions.

For the best experience, ensure JavaScript is enabled and browser extensions that block cookies are disabled for our domain.`,
  },
  {
    title: "Clearing cache to fix display issues",
    category: "technical" as const,
    tags: ["cache", "bug", "display", "refresh", "troubleshoot"],
    content: `If you are experiencing display glitches, missing data, or outdated content, clearing your browser cache usually resolves the issue.

Chrome:
1. Press Ctrl + Shift + Delete (Windows) or Cmd + Shift + Delete (Mac).
2. Set the time range to "All time."
3. Check "Cached images and files" and "Cookies."
4. Click "Clear data" and reload the page.

Safari (Mac):
1. Go to Safari → Preferences → Privacy → Manage Website Data.
2. Search for "supportai.com" and click Remove.

Safari (iOS):
1. Go to Settings → Safari → Clear History and Website Data.

If clearing cache does not resolve the issue, please try in an incognito/private window. If the problem persists, contact support and include your browser version, operating system, and a screenshot.`,
  },
  {
    title: "API rate limits and integration troubleshooting",
    category: "technical" as const,
    tags: ["API", "integration", "rate limit", "developer", "webhook"],
    content: `The SupportAI REST API has the following rate limits:

- Standard tier: 60 requests/minute per API key
- Pro tier: 300 requests/minute per API key
- Enterprise: custom limits — contact sales

If you receive a 429 Too Many Requests response:
1. Check the Retry-After header in the response — wait that many seconds before retrying.
2. Implement exponential backoff in your integration.
3. Cache responses where possible to reduce API calls.

Webhook delivery:
- Webhooks are retried up to 5 times with exponential backoff if the endpoint returns a non-2xx status.
- Webhook payloads are signed with HMAC-SHA256. Verify the X-SupportAI-Signature header to ensure authenticity.

For detailed API documentation, visit docs.supportai.com/api.`,
  },

  // ── General ───────────────────────────────────────────────────────────────
  {
    title: "How to contact customer support",
    category: "general" as const,
    tags: ["contact", "support", "help", "chat", "email"],
    content: `You can reach our support team through the following channels:

Live chat: Available 24/7 from the Help icon on any page. Average first response time is under 2 minutes.

Email: support@supportai.com — responses within 4 business hours.

Phone: +1 (800) 555-0100 — available Monday–Friday, 9 AM–6 PM Eastern Time.

For urgent billing issues outside business hours, use live chat and select "Billing emergency" — this is routed to our on-call billing team.

Community forum: community.supportai.com — browse thousands of answered questions and post your own. Monitored by both staff and expert community members.`,
  },
  {
    title: "SupportAI subscription plans",
    category: "general" as const,
    tags: ["plans", "pricing", "subscription", "upgrade", "downgrade"],
    content: `SupportAI offers three subscription plans:

Starter (Free):
- Up to 1,000 AI-handled queries/month
- 1 agent seat
- Email support

Pro ($49/month):
- Up to 5,000 queries/month
- 5 agent seats
- Priority support, custom tone settings, analytics dashboard

Enterprise (custom pricing):
- Unlimited queries
- Unlimited seats
- Dedicated account manager, SLA guarantees, SSO, custom integrations

To upgrade: go to Account → Billing → Change plan.
To downgrade: changes take effect at the end of the current billing cycle.
To cancel: go to Account → Billing → Cancel subscription. You will retain access until the end of the billing period.`,
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
//  Seed runner
// ─────────────────────────────────────────────────────────────────────────────

async function seed() {
  logger.info("Starting knowledge base seed...");

  // Clear existing articles
  const existing = listArticles();
  for (const a of existing) {
    deleteArticle(a.id);
  }
  logger.info(`Cleared ${existing.length} existing articles`);

  let success = 0;
  let failed = 0;

  for (const data of ARTICLES) {
    try {
      // Insert article
      const article = createArticle({
        title:    data.title,
        content:  data.content,
        category: data.category,
        tags:     [...data.tags],
      });

      // Generate embedding
      logger.info(`Generating embedding for: ${data.title}`);
      const vec = await embedText(`${data.title}\n\n${data.content}`);
      saveEmbedding(article.id, vec);

      logger.info(`✓ Seeded: ${data.title} (${vec.length} dims)`);
      success++;

      // Brief pause to avoid hitting Gemini rate limits
      await new Promise((r) => setTimeout(r, 300));
    } catch (err) {
      logger.error(`✗ Failed to seed: ${data.title}`, { error: String(err) });
      failed++;
    }
  }

  logger.info(`Seed complete — ${success} articles seeded, ${failed} failed`);
  process.exit(failed > 0 ? 1 : 0);
}

seed().catch((err) => {
  logger.error("Seed script crashed", { error: String(err) });
  process.exit(1);
});
