import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { customAlphabet } from "nanoid";
import { createSecretToken, hashSecret, verifyPlainText } from "../../lib/crypto.js";
import { env } from "../../lib/env.js";
import { toModelDto, toUserDto } from "../../lib/mapper.js";
import { prisma } from "../../lib/prisma.js";

const modelSchema = z.object({
  displayName: z.string().min(1),
  provider: z.string().min(1).default("openrouter"),
  providerModelId: z.string().min(1),
  enabled: z.boolean().default(true),
  inputAppTokensPer1k: z.number().int().min(0),
  outputAppTokensPer1k: z.number().int().min(0),
  minimumRequiredBalance: z.number().int().min(0),
  maxOutputTokens: z.number().int().min(1),
  contextWindowTokens: z.number().int().min(1000),
  sortOrder: z.number().int().default(0)
});
const redeemCodeSchema = z.object({
  appTokenAmount: z.number().int().positive(),
  usageLimit: z.number().int().positive().nullable().optional().default(1),
  expiresAt: z.string().datetime().nullable().optional()
});
const adjustmentSchema = z.object({ amount: z.number().int(), note: z.string().max(500).optional() });
const alphabet = customAlphabet("ABCDEFGHJKLMNPQRSTUVWXYZ23456789", 16);

export const adminRoutes: FastifyPluginAsync = async (app) => {
  app.post("/login", async (request, reply) => {
    const { password } = z.object({ password: z.string().min(1) }).parse(request.body);
    if (!verifyPlainText(password, env.ADMIN_PASSWORD)) return reply.code(401).send({ message: "Invalid password" });

    const token = createSecretToken();
    await prisma.adminSession.create({
      data: { tokenHash: hashSecret(token), expiresAt: new Date(Date.now() + 24 * 60 * 60 * 1000) }
    });
    reply.setCookie("admin_session", token, { httpOnly: true, sameSite: "lax", path: "/", maxAge: 24 * 60 * 60 });
    return { ok: true, token };
  });

  app.post("/logout", async (request, reply) => {
    const token = request.cookies.admin_session ?? request.headers.authorization?.replace("Bearer ", "");
    if (token) await prisma.adminSession.deleteMany({ where: { tokenHash: hashSecret(token) } });
    reply.clearCookie("admin_session", { path: "/" });
    return { ok: true };
  });

  app.get("/me", { preHandler: app.authenticateAdmin }, async () => ({ ok: true }));

  app.get("/models", { preHandler: app.authenticateAdmin }, async () => {
    const models = await prisma.llmModel.findMany({ orderBy: [{ sortOrder: "asc" }, { displayName: "asc" }] });
    return { models: models.map(toModelDto) };
  });

  app.post("/models", { preHandler: app.authenticateAdmin }, async (request) => {
    const model = await prisma.llmModel.create({ data: modelSchema.parse(request.body) });
    return { model: toModelDto(model) };
  });

  app.patch("/models/:id", { preHandler: app.authenticateAdmin }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const model = await prisma.llmModel.update({
      where: { id: params.id },
      data: modelSchema.partial().parse(request.body)
    });
    return { model: toModelDto(model) };
  });

  app.delete("/models/:id", { preHandler: app.authenticateAdmin }, async (request) => {
    const params = z.object({ id: z.string() }).parse(request.params);
    const model = await prisma.llmModel.update({ where: { id: params.id }, data: { enabled: false } });
    return { model: toModelDto(model) };
  });

  app.get("/redeem-codes", { preHandler: app.authenticateAdmin }, async () => {
    const codes = await prisma.redeemCode.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
      include: {
        redemptions: {
          orderBy: { createdAt: "desc" },
          include: { user: true }
        }
      }
    });
    return {
      codes: codes.map((code) => ({
        id: code.id,
        appTokenAmount: code.appTokenAmount,
        usageLimit: code.usageLimit,
        usedCount: code.usedCount,
        enabled: code.enabled,
        expiresAt: code.expiresAt,
        createdAt: code.createdAt,
        redemptions: code.redemptions.map((redemption) => ({
          id: redemption.id,
          appTokenAmount: redemption.appTokenAmount,
          createdAt: redemption.createdAt,
          user: toUserDto(redemption.user)
        }))
      }))
    };
  });

  app.post("/redeem-codes", { preHandler: app.authenticateAdmin }, async (request) => {
    const input = redeemCodeSchema.parse(request.body);
    const code = alphabet();
    const redeemCode = await prisma.redeemCode.create({
      data: {
        codeHash: hashSecret(code),
        appTokenAmount: input.appTokenAmount,
        usageLimit: input.usageLimit,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null
      }
    });
    return { code, redeemCode };
  });

  app.get("/users", { preHandler: app.authenticateAdmin }, async () => {
    const users = await prisma.user.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
    return { users: users.map(toUserDto) };
  });

  app.get("/users/:id", { preHandler: app.authenticateAdmin }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const user = await prisma.user.findUniqueOrThrow({ where: { id } });
    return { user: toUserDto(user) };
  });

  app.post("/users/:id/balance-adjustments", { preHandler: app.authenticateAdmin }, async (request) => {
    const { id } = z.object({ id: z.string() }).parse(request.params);
    const input = adjustmentSchema.parse(request.body);
    const result = await prisma.$transaction(async (tx) => {
      const current = await tx.user.findUniqueOrThrow({ where: { id } });
      const nextBalance = Math.max(0, current.appTokenBalance + input.amount);
      const user = await tx.user.update({ where: { id }, data: { appTokenBalance: nextBalance } });
      await tx.appTokenLedger.create({
        data: {
          userId: id,
          type: "admin_adjustment",
          amount: nextBalance - current.appTokenBalance,
          balanceAfter: nextBalance,
          sourceType: "admin",
          metadata: input.note ? { note: input.note } : undefined
        }
      });
      return user;
    });
    return { user: toUserDto(result) };
  });
};
