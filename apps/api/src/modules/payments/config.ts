import { z } from "zod";
import { env } from "../../lib/env.js";

// This API contract uses /100 minor units. Add an exponent-aware money type before supporting JPY/KWD, etc.
const currencySchema = z.enum(["USD", "CNY", "AUD", "CAD", "EUR", "GBP", "HKD", "NZD", "SGD"]);
const offerSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  amountMinor: z.number().int().positive().max(100_000_000),
  currency: currencySchema,
  appTokenAmount: z.number().int().positive().max(100_000_000)
});
const methodSchema = z.object({
  id: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
  label: z.string().min(1).max(80),
  labelZh: z.string().min(1).max(80),
  provider: z.enum(["omipay", "paypal"]),
  currencies: z.array(currencySchema).min(1)
});

export function paymentConfig() {
  const offers = z.array(offerSchema).parse(JSON.parse(env.PAYMENT_OFFERS_JSON));
  const methods = z.array(methodSchema).parse(JSON.parse(env.PAYMENT_METHODS_JSON));
  if (new Set(offers.map((o) => o.id)).size !== offers.length ||
      new Set(methods.map((m) => m.id)).size !== methods.length) throw new Error("Duplicate payment catalog IDs");
  // The current shared OmiPay adapter always converts USD to CNY.
  if (methods.some((m) => m.provider === "omipay" && m.currencies.some((c) => c !== "USD"))) {
    throw new Error("The current OmiPay service only accepts USD offers");
  }
  if (env.PAYMENT_SERVICE_ENABLED) {
    for (const url of [env.PAYMENT_SERVICE_BASE_URL, env.PAYMENT_PUBLIC_API_URL, env.WEB_ORIGIN]) {
      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol) || parsed.username || parsed.password || parsed.search || parsed.hash) {
        throw new Error("Invalid payment service URL configuration");
      }
      if (process.env.NODE_ENV === "production" && parsed.protocol !== "https:") {
        throw new Error("Production payment URLs must use HTTPS");
      }
    }
    if (!env.PAYMENT_SERVICE_INTERNAL_SECRET || !env.PAYMENT_CALLBACK_SECRET || !offers.length || !methods.length) {
      throw new Error("Enabled payments require secrets, offers and methods");
    }
    if (offers.some((o) => !methods.some((m) => m.currencies.includes(o.currency)))) {
      throw new Error("Each payment offer needs a compatible method");
    }
  }
  return { enabled: env.PAYMENT_SERVICE_ENABLED, offers, methods };
}
