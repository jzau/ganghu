import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { createSecretToken, hashSecret } from "../../lib/crypto.js";
import { env } from "../../lib/env.js";
import { prisma } from "../../lib/prisma.js";
import { toUserDto } from "../../lib/mapper.js";
import { authServiceClient } from "./authServiceClient.js";

const countryCodes = ["+86", "+852", "+81", "+61"] as const;
const initialAppTokenBalance = 10_00;
const phoneSchema = z.object({
  countryCode: z.enum(countryCodes).optional(),
  phoneNumber: z.string().min(4).max(32)
});
const verifySchema = phoneSchema.extend({ otp: z.string().min(4).max(12) });
const sessionDays = 30;

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
      await authServiceClient.requestOtp(phoneNumber);
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

    let externalAuthUserId = `mock:${phoneNumber}`;
    if (env.AUTH_SERVICE_ENABLED) {
      const result = await authServiceClient.verifyOtp(phoneNumber, input.otp);
      externalAuthUserId = result.user.id;
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
