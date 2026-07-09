import { env } from "../../lib/env.js";

type AuthServiceResponse<T> = {
  status: "success" | "error";
  message?: string;
  data?: T;
  errors?: Array<{ field?: string; message: string }>;
};

type VerifyOtpData = {
  user: {
    id: string;
    phone: string;
  };
  accessToken: string;
  refreshToken?: string;
};

export class AuthServiceError extends Error {
  statusCode: number;

  constructor(message: string, statusCode = 502) {
    super(message);
    this.name = "AuthServiceError";
    this.statusCode = statusCode;
  }
}

async function authServiceRequest<T>(path: string, body: unknown): Promise<T> {
  if (!env.AUTH_SERVICE_APP_ID || !env.AUTH_SERVICE_API_KEY) {
    throw new AuthServiceError("Auth service app credentials are not configured", 503);
  }

  let response: Response;
  try {
    response = await fetch(`${env.AUTH_SERVICE_BASE_URL.replace(/\/$/, "")}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-App-ID": env.AUTH_SERVICE_APP_ID,
        "X-API-Key": env.AUTH_SERVICE_API_KEY
      },
      body: JSON.stringify(body)
    });
  } catch (error) {
    throw new AuthServiceError(error instanceof Error ? error.message : "Auth service request failed", 503);
  }

  const payload = (await response.json().catch(() => ({}))) as AuthServiceResponse<T>;

  if (!response.ok || payload.status === "error" || !payload.data) {
    throw new AuthServiceError(
      payload.message ?? payload.errors?.[0]?.message ?? "Auth service request failed",
      response.status || 502
    );
  }

  return payload.data;
}

export const authServiceClient = {
  requestOtp(phone: string) {
    return authServiceRequest<{ verificationStatus: string }>("/api/auth/request-otp", { phone });
  },
  verifyOtp(phone: string, code: string) {
    return authServiceRequest<VerifyOtpData>("/api/auth/verify-otp", { phone, code });
  }
};
