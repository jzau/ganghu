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

async function authServiceRequest<T>(path: string, body: unknown): Promise<T> {
  if (!env.AUTH_SERVICE_APP_ID || !env.AUTH_SERVICE_API_KEY) {
    throw new Error("Auth service app credentials are not configured");
  }

  const response = await fetch(`${env.AUTH_SERVICE_BASE_URL.replace(/\/$/, "")}${path}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-App-ID": env.AUTH_SERVICE_APP_ID,
      "X-API-Key": env.AUTH_SERVICE_API_KEY
    },
    body: JSON.stringify(body)
  });

  const payload = (await response.json().catch(() => ({}))) as AuthServiceResponse<T>;

  if (!response.ok || payload.status === "error" || !payload.data) {
    throw new Error(payload.message ?? payload.errors?.[0]?.message ?? "Auth service request failed");
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
