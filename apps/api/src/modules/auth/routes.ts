import { createHmac, timingSafeEqual } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createSecretToken, hashSecret } from "../../lib/crypto.js";
import { env } from "../../lib/env.js";
import { prisma } from "../../lib/prisma.js";
import { toUserDto } from "../../lib/mapper.js";
import { AuthServiceError, authServiceClient } from "./authServiceClient.js";

const countryCodes = ["+86", "+852", "+81", "+61"] as const;
const initialAppTokenBalance = 10_00;
const phoneSchema = z.object({
  countryCode: z.enum(countryCodes).optional(),
  phoneNumber: z.string().min(4).max(32)
});
const verifySchema = phoneSchema.extend({ otp: z.string().min(4).max(12) });
const phoneChangeTokenSchema = z.string().min(32).max(1024);
const currentPhoneVerifySchema = z.object({ otp: z.string().min(4).max(12) });
const phoneChangeRequestSchema = phoneSchema.extend({ verificationToken: phoneChangeTokenSchema });
const phoneChangeVerifySchema = verifySchema.extend({ verificationToken: phoneChangeTokenSchema });
const sessionDays = 30;
const phoneChangeVerificationMinutes = 10;

type PhoneChangeVerification = {
  userId: string;
  currentPhoneNumber: string;
  stage: "current" | "new";
  newPhoneNumber?: string;
  expiresAt: number;
};

function signPhoneChangeVerification(verification: PhoneChangeVerification) {
  const payload = Buffer.from(JSON.stringify(verification)).toString("base64url");
  const signature = createHmac("sha256", env.SESSION_SECRET).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

function getPhoneChangeVerification(token: string, userId: string, currentPhoneNumber: string) {
  try {
    const [payload, suppliedSignature, extra] = token.split(".");
    if (!payload || !suppliedSignature || extra) return null;
    const expectedSignature = createHmac("sha256", env.SESSION_SECRET).update(payload).digest();
    const suppliedSignatureBytes = Buffer.from(suppliedSignature, "base64url");
    if (expectedSignature.length !== suppliedSignatureBytes.length || !timingSafeEqual(expectedSignature, suppliedSignatureBytes)) return null;
    const verification = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as PhoneChangeVerification;
    if (verification.expiresAt <= Date.now() || verification.userId !== userId || verification.currentPhoneNumber !== currentPhoneNumber) return null;
    return verification;
  } catch {
    return null;
  }
}

function normalizePhone(input: z.infer<typeof phoneSchema>) {
  const rawCountryCode = input.countryCode;
  const rawPhoneNumber = input.phoneNumber.trim();

  if (rawCountryCode) {
    const localNumber = rawPhoneNumber.replace(/\D/g, "");
    const phoneNumber = `${rawCountryCode}${localNumber}`;
    validatePhone(rawCountryCode, localNumber);
    return phoneNumber;
  }

  const compact = rawPhoneNumber.replace(/[\s()-]/g, "");
  const countryCode = countryCodes.find((code) => compact.startsWith(code));
  if (!countryCode) throw new Error("Unsupported country code");

  const localNumber = compact.slice(countryCode.length).replace(/\D/g, "");
  validatePhone(countryCode, localNumber);
  return `${countryCode}${localNumber}`;
}

function validatePhone(countryCode: (typeof countryCodes)[number], localNumber: string) {
  const isValid =
    (countryCode === "+86" && /^1\d{10}$/.test(localNumber)) ||
    (countryCode === "+852" && /^[23569]\d{7}$/.test(localNumber)) ||
    (countryCode === "+81" && /^\d{9,10}$/.test(localNumber)) ||
    (countryCode === "+61" && /^\d{9}$/.test(localNumber));

  if (!isValid) throw new Error("Invalid phone number for selected country");
}

export const authRoutes: FastifyPluginAsync = async (app) => {
  app.post("/otp/request", async (request, reply) => {
    const parsedInput = phoneSchema.safeParse(request.body);
    if (!parsedInput.success) {
      return reply.code(400).send({ message: "Invalid phone number" });
    }

    const input = parsedInput.data;
    let phoneNumber: string;
    try {
      phoneNumber = normalizePhone(input);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Invalid phone number" });
    }

    if (env.AUTH_SERVICE_ENABLED) {
      try {
        await authServiceClient.requestOtp(phoneNumber);
      } catch (error) {
        request.log.error({ err: error }, "Failed to request OTP from auth service");
        return reply.code(503).send({ message: "Authentication service unavailable" });
      }
      return { ok: true, message: "OTP sent successfully" };
    }

    return { ok: true, message: "Mock OTP sent. Use 000000 in development." };
  });

  app.post("/otp/verify", async (request, reply) => {
    const parsedInput = verifySchema.safeParse(request.body);
    if (!parsedInput.success) {
      const hasOtpError = parsedInput.error.issues.some((issue) => issue.path[0] === "otp");
      return reply.code(400).send({ message: hasOtpError ? "Invalid OTP" : "Invalid phone number" });
    }

    const input = parsedInput.data;
    let phoneNumber: string;
    try {
      phoneNumber = normalizePhone(input);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Invalid phone number" });
    }

    const authTestOtp = env.AUTH_TEST_OTP.trim();
    const isAuthTestOtp = authTestOtp.length > 0 && input.otp.trim() === authTestOtp;
    let externalAuthUserId = isAuthTestOtp ? `test:${phoneNumber}` : `mock:${phoneNumber}`;
    if (isAuthTestOtp) {
      request.log.info("Accepted configured auth test OTP");
    } else if (env.AUTH_SERVICE_ENABLED) {
      try {
        const result = await authServiceClient.verifyOtp(phoneNumber, input.otp);
        externalAuthUserId = result.user.id;
      } catch (error) {
        if (error instanceof AuthServiceError && error.statusCode === 401) {
          return reply.code(401).send({ message: "Invalid OTP" });
        }
        request.log.error({ err: error }, "Failed to verify OTP with auth service");
        return reply.code(503).send({ message: "Authentication service unavailable" });
      }
    } else if (input.otp !== "000000") {
      return reply.code(401).send({ message: "Invalid OTP" });
    }

    const user = await prisma.user.upsert({
      where: { phoneNumber },
      create: {
        phoneNumber,
        externalAuthUserId,
        appTokenBalance: initialAppTokenBalance,
        lastLoginAt: new Date()
      },
      update: { externalAuthUserId, lastLoginAt: new Date() }
    });

    const token = createSecretToken();
    await prisma.userSession.create({
      data: {
        tokenHash: hashSecret(token),
        userId: user.id,
        expiresAt: new Date(Date.now() + sessionDays * 24 * 60 * 60 * 1000)
      }
    });

    reply.setCookie("user_session", token, {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: sessionDays * 24 * 60 * 60
    });
    return { user: toUserDto(user), token };
  });

  app.post("/phone-change/current/otp/request", { preHandler: app.authenticateUser }, async (request, reply) => {
    const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id } });
    if (env.AUTH_SERVICE_ENABLED) {
      try {
        await authServiceClient.requestOtp(currentUser.phoneNumber);
      } catch (error) {
        request.log.error({ err: error }, "Failed to request current-phone OTP");
        return reply.code(503).send({ message: "Authentication service unavailable" });
      }
    }
    return { ok: true, message: env.AUTH_SERVICE_ENABLED ? "OTP sent successfully" : "Mock OTP sent. Use 000000 in development." };
  });

  app.post("/phone-change/current/otp/verify", { preHandler: app.authenticateUser }, async (request, reply) => {
    const parsedInput = currentPhoneVerifySchema.safeParse(request.body);
    if (!parsedInput.success) return reply.code(400).send({ message: "Invalid OTP" });
    const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id } });
    const authTestOtp = env.AUTH_TEST_OTP.trim();
    const isAuthTestOtp = authTestOtp.length > 0 && parsedInput.data.otp.trim() === authTestOtp;
    if (!isAuthTestOtp && env.AUTH_SERVICE_ENABLED) {
      try {
        await authServiceClient.verifyOtp(currentUser.phoneNumber, parsedInput.data.otp);
      } catch (error) {
        if (error instanceof AuthServiceError && error.statusCode === 401) return reply.code(401).send({ message: "Invalid OTP" });
        request.log.error({ err: error }, "Failed to verify current-phone OTP");
        return reply.code(503).send({ message: "Authentication service unavailable" });
      }
    } else if (!isAuthTestOtp && parsedInput.data.otp !== "000000") {
      return reply.code(401).send({ message: "Invalid OTP" });
    }

    const verificationToken = signPhoneChangeVerification({
      userId: currentUser.id,
      currentPhoneNumber: currentUser.phoneNumber,
      stage: "current",
      expiresAt: Date.now() + phoneChangeVerificationMinutes * 60 * 1000
    });
    return { verificationToken, expiresInSeconds: phoneChangeVerificationMinutes * 60 };
  });

  app.post("/phone-change/otp/request", { preHandler: app.authenticateUser }, async (request, reply) => {
    const parsedInput = phoneChangeRequestSchema.safeParse(request.body);
    if (!parsedInput.success) return reply.code(400).send({ message: "Invalid phone number" });
    let phoneNumber: string;
    try {
      phoneNumber = normalizePhone(parsedInput.data);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Invalid phone number" });
    }
    const [currentUser, existingUser] = await Promise.all([
      prisma.user.findUniqueOrThrow({ where: { id: request.user!.id } }),
      prisma.user.findUnique({ where: { phoneNumber } })
    ]);
    const proof = getPhoneChangeVerification(parsedInput.data.verificationToken, currentUser.id, currentUser.phoneNumber);
    if (!proof || proof.stage !== "current") return reply.code(403).send({ message: "Verify your current phone number first" });
    if (phoneNumber === currentUser.phoneNumber) return reply.code(400).send({ message: "This phone number is already linked to your account" });
    if (existingUser) return reply.code(409).send({ message: "This phone number is already in use" });
    if (env.AUTH_SERVICE_ENABLED) {
      try {
        await authServiceClient.requestOtp(phoneNumber);
      } catch (error) {
        request.log.error({ err: error }, "Failed to request phone-change OTP");
        return reply.code(503).send({ message: "Authentication service unavailable" });
      }
    }
    const verificationToken = signPhoneChangeVerification({ ...proof, stage: "new", newPhoneNumber: phoneNumber });
    return { ok: true, verificationToken, message: env.AUTH_SERVICE_ENABLED ? "OTP sent successfully" : "Mock OTP sent. Use 000000 in development." };
  });

  app.post("/phone-change/otp/verify", { preHandler: app.authenticateUser }, async (request, reply) => {
    const parsedInput = phoneChangeVerifySchema.safeParse(request.body);
    if (!parsedInput.success) return reply.code(400).send({ message: "Invalid phone number or OTP" });
    let phoneNumber: string;
    try {
      phoneNumber = normalizePhone(parsedInput.data);
    } catch (error) {
      return reply.code(400).send({ message: error instanceof Error ? error.message : "Invalid phone number" });
    }
    const currentUser = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id } });
    const proof = getPhoneChangeVerification(parsedInput.data.verificationToken, currentUser.id, currentUser.phoneNumber);
    if (!proof || proof.stage !== "new") return reply.code(403).send({ message: "Verify your current phone number first" });
    if (proof.newPhoneNumber !== phoneNumber) return reply.code(403).send({ message: "Request a verification code for this new phone number first" });
    if (phoneNumber === currentUser.phoneNumber) return reply.code(400).send({ message: "This phone number is already linked to your account" });
    if (await prisma.user.findUnique({ where: { phoneNumber } })) return reply.code(409).send({ message: "This phone number is already in use" });

    const authTestOtp = env.AUTH_TEST_OTP.trim();
    const isAuthTestOtp = authTestOtp.length > 0 && parsedInput.data.otp.trim() === authTestOtp;
    let externalAuthUserId = isAuthTestOtp ? `test:${phoneNumber}` : `mock:${phoneNumber}`;
    if (!isAuthTestOtp && env.AUTH_SERVICE_ENABLED) {
      try {
        const result = await authServiceClient.verifyOtp(phoneNumber, parsedInput.data.otp);
        externalAuthUserId = result.user.id;
      } catch (error) {
        if (error instanceof AuthServiceError && error.statusCode === 401) return reply.code(401).send({ message: "Invalid OTP" });
        request.log.error({ err: error }, "Failed to verify phone-change OTP");
        return reply.code(503).send({ message: "Authentication service unavailable" });
      }
    } else if (!isAuthTestOtp && parsedInput.data.otp !== "000000") {
      return reply.code(401).send({ message: "Invalid OTP" });
    }

    try {
      const user = await prisma.user.update({
        where: { id: request.user!.id },
        data: { phoneNumber, externalAuthUserId }
      });
      return { user: toUserDto(user) };
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
        return reply.code(409).send({ message: "This phone number is already in use" });
      }
      throw error;
    }
  });

  app.post("/logout", { preHandler: app.authenticateUser }, async (request, reply) => {
    const token = request.cookies.user_session ?? request.headers.authorization?.replace("Bearer ", "");
    if (token) await prisma.userSession.deleteMany({ where: { tokenHash: hashSecret(token) } });
    reply.clearCookie("user_session", { path: "/" });
    return { ok: true };
  });

  app.get("/me", { preHandler: app.authenticateUser }, async (request) => {
    const user = await prisma.user.findUniqueOrThrow({ where: { id: request.user!.id } });
    return { user: toUserDto(user) };
  });
};
