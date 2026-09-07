import { z } from "zod";
import { env } from "../../lib/env.js";

export const remotePaymentSchema = z.object({
  id: z.string().min(1),
  orderId: z.string().min(1),
  status: z.string().min(1),
  amount: z.number().finite().positive(),
  currency: z.string(),
  provider: z.string(),
  approvalUrl: z.string().nullable().optional()
});
export type RemotePayment = z.infer<typeof remotePaymentSchema>;
export type CreatePayment = {
  orderId: string; amount: number; currency: string; provider: string;
};

// The application depends on this contract, not individual provider SDKs.
export interface PaymentGateway {
  create(input: CreatePayment): Promise<RemotePayment>;
  get(id: string): Promise<RemotePayment>;
}

export function safeApprovalUrl(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}

export class SharedPaymentGateway implements PaymentGateway {
  constructor(private readonly transport: typeof fetch = fetch) {}

  private async request(path: string, init: RequestInit = {}) {
    const response = await this.transport(`${env.PAYMENT_SERVICE_BASE_URL.replace(/\/$/, "")}/api/payments${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", "X-Internal-Auth": env.PAYMENT_SERVICE_INTERNAL_SECRET, ...init.headers },
      signal: AbortSignal.timeout(15_000),
      redirect: "error"
    });
    if (!response.ok) throw new Error("Payment service request failed");
    return remotePaymentSchema.parse(await response.json());
  }

  create(input: CreatePayment) {
    const callbackUrl = `${env.PAYMENT_PUBLIC_API_URL.replace(/\/$/, "")}/api/payments/callback`;
    return this.request("", {
      method: "POST",
      headers: { "Idempotency-Key": `chatbot:${input.orderId}` },
      body: JSON.stringify({
        orderId: input.orderId, amount: input.amount, currency: input.currency,
        providers: [input.provider], callbackUrl, refundCallbackUrl: callbackUrl,
        returnUrl: `${env.WEB_ORIGIN.replace(/\/$/, "")}/?payment=return`,
        cancelUrl: `${env.WEB_ORIGIN.replace(/\/$/, "")}/?payment=cancel`,
        metadata: { application: "chatbot", subject: "Chatbot token recharge" }
      })
    });
  }

  get(id: string) { return this.request(`/${encodeURIComponent(id)}`); }
}
