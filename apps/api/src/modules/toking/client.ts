import { createHash } from "node:crypto";
import { z } from "zod";
import { decryptCredential } from "../../lib/crypto.js";
import { env } from "../../lib/env.js";

const redemptionSchema = z.object({
  transactionId: z.string(),
  creditAccountId: z.string(),
  walletCreated: z.boolean(),
  credited: z.string().regex(/^\d+$/),
  balanceAfter: z.string().regex(/^-?\d+$/),
  baseUrl: z.string().url(),
  modelsUrl: z.string().url(),
  chatCompletionsUrl: z.string().url(),
  apiKey: z.string().optional(),
  apiKeyPrefix: z.string().optional()
});

const catalogSchema = z.object({
  object: z.literal("list"),
  data: z.array(z.object({
    id: z.string().min(1).max(500),
    object: z.literal("model"),
    created: z.number().int().nonnegative(),
    owned_by: z.string().min(1),
    provider: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    context_length: z.number().int().positive().optional(),
    supported_parameters: z.array(z.string()).optional()
  }))
});

const walletSchema = z.object({
  postedBalance: z.string().regex(/^-?\d+$/),
  reservedBalance: z.string().regex(/^\d+$/),
  availableBalance: z.string().regex(/^-?\d+$/),
  canReserve: z.boolean(),
  status: z.string()
});

const walletTransactionsSchema = z.object({
  data: z.array(z.object({
    transactionId: z.string(),
    type: z.string(),
    sourceReference: z.string(),
    amount: z.string().regex(/^-?\d+$/),
    metadata: z.record(z.unknown()),
    postedAt: z.string()
  }).passthrough()),
  nextCursor: z.string().nullable()
});

export type TokingRedemption = z.infer<typeof redemptionSchema>;
export type TokingModel = z.infer<typeof catalogSchema>["data"][number];
export type TokingWallet = z.infer<typeof walletSchema>;
export type TokingWalletTransactions = z.infer<typeof walletTransactionsSchema>;

export class TokingError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
    readonly retryable = status >= 500 || status === 429
  ) {
    super(message);
    this.name = "TokingError";
  }
}

export type TokingHttpStatus = 400 | 401 | 402 | 403 | 404 | 409 | 429 | 500 | 502 | 503;

export function tokingHttpStatus(status: number): TokingHttpStatus {
  if ([400, 401, 402, 403, 404, 409, 429, 500, 502, 503].includes(status)) {
    return status as TokingHttpStatus;
  }
  return status >= 500 ? 502 : 400;
}

export type StoredTokingConnection = {
  tokingApiKeyEncrypted: string | null;
  tokingBaseUrl: string | null;
};

export function readTokingConnection(user: StoredTokingConnection) {
  if (!user.tokingApiKeyEncrypted || !user.tokingBaseUrl) return null;
  try {
    return {
      apiKey: decryptCredential(user.tokingApiKeyEncrypted),
      baseUrl: normalizeGatewayBaseUrl(user.tokingBaseUrl)
    };
  } catch (error) {
    if (error instanceof TokingError) throw error;
    throw new TokingError(409, "TOKING_CREDENTIAL_INVALID", "The saved Toking connection cannot be decrypted");
  }
}

export function redemptionIdempotencyKey(userId: string, normalizedCode: string) {
  return createHash("sha256")
    .update(`${env.TOKING_CREDENTIAL_SECRET}:gift-card:${userId}:${normalizedCode}`)
    .digest("hex");
}

export async function redeemTokingGiftCard(input: {
  code: string;
  externalUserId: string;
  idempotencyKey: string;
  fetchImpl?: typeof fetch;
}) {
  if (!env.TOKING_CLIENT_API_KEY) {
    throw new TokingError(503, "TOKING_NOT_CONFIGURED", "Toking gift-card redemption is not configured");
  }
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(env.TOKING_REDEMPTION_API_URL, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${env.TOKING_CLIENT_API_KEY}`,
        "Content-Type": "application/json",
        "Idempotency-Key": input.idempotencyKey
      },
      body: JSON.stringify({ code: input.code, externalUserId: input.externalUserId }),
      signal: AbortSignal.timeout(15_000)
    });
  } catch (error) {
    throw new TokingError(503, "TOKING_UNAVAILABLE", error instanceof Error ? error.message : "Toking is unavailable");
  }
  if (!response.ok) throw await toTokingError(response);
  try {
    return redemptionSchema.parse(await response.json());
  } catch {
    throw new TokingError(502, "TOKING_INVALID_RESPONSE", "Toking returned an invalid redemption response");
  }
}

export async function listTokingModels(input: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }) {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${normalizeGatewayBaseUrl(input.baseUrl)}/models`, {
      headers: { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(12_000)
    });
  } catch (error) {
    throw new TokingError(503, "TOKING_UNAVAILABLE", error instanceof Error ? error.message : "Toking is unavailable");
  }
  if (!response.ok) throw await toTokingError(response);
  try {
    return catalogSchema.parse(await response.json()).data;
  } catch {
    throw new TokingError(502, "TOKING_INVALID_RESPONSE", "Toking returned an invalid model catalog");
  }
}

export async function getTokingWallet(input: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch }) {
  const payload = await getTokingResource(input, "/wallet", 12_000);
  try {
    return walletSchema.parse(payload);
  } catch {
    throw new TokingError(502, "TOKING_INVALID_RESPONSE", "Toking returned an invalid wallet response");
  }
}

export async function listTokingWalletTransactions(input: {
  baseUrl: string;
  apiKey: string;
  limit: number;
  cursor?: string;
  fetchImpl?: typeof fetch;
}) {
  const query = new URLSearchParams({ limit: String(input.limit) });
  if (input.cursor) query.set("cursor", input.cursor);
  const payload = await getTokingResource(input, `/wallet/transactions?${query.toString()}`, 12_000);
  try {
    return walletTransactionsSchema.parse(payload);
  } catch {
    throw new TokingError(502, "TOKING_INVALID_RESPONSE", "Toking returned an invalid wallet history response");
  }
}

async function getTokingResource(
  input: { baseUrl: string; apiKey: string; fetchImpl?: typeof fetch },
  path: string,
  timeoutMs: number
) {
  const fetchImpl = input.fetchImpl ?? fetch;
  let response: Response;
  try {
    response = await fetchImpl(`${normalizeGatewayBaseUrl(input.baseUrl)}${path}`, {
      headers: { Authorization: `Bearer ${input.apiKey}`, Accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw new TokingError(503, "TOKING_UNAVAILABLE", error instanceof Error ? error.message : "Toking is unavailable");
  }
  if (!response.ok) throw await toTokingError(response);
  try {
    return await response.json();
  } catch {
    throw new TokingError(502, "TOKING_INVALID_RESPONSE", "Toking returned invalid JSON");
  }
}

export function normalizeGatewayBaseUrl(value: string) {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new TokingError(502, "TOKING_INVALID_RESPONSE", "Toking returned an invalid gateway URL");
  }
  if (env.NODE_ENV === "production" && url.protocol !== "https:") {
    throw new TokingError(502, "TOKING_INVALID_RESPONSE", "Toking returned an insecure gateway URL");
  }
  return url.toString().replace(/\/+$/, "");
}

async function toTokingError(response: Response) {
  const payload = await response.json().catch(() => ({})) as {
    error?: { code?: unknown; message?: unknown };
    code?: unknown;
    message?: unknown;
  };
  const code = typeof payload.error?.code === "string"
    ? payload.error.code
    : typeof payload.code === "string" ? payload.code : "TOKING_REQUEST_FAILED";
  const message = typeof payload.error?.message === "string"
    ? payload.error.message
    : typeof payload.message === "string" ? payload.message : "Toking request failed";
  return new TokingError(response.status, code, message);
}
