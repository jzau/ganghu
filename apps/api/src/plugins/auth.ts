import fp from "fastify-plugin";
import { randomBytes } from "node:crypto";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";
import { hashSecret } from "../lib/crypto.js";
import { env } from "../lib/env.js";

declare module "fastify" {
  interface FastifyRequest {
    user?: { id: string };
    admin?: true;
  }
}

function readToken(request: FastifyRequest, cookieName: string) {
  const authHeader = request.headers.authorization;
  if (authHeader?.startsWith("Bearer ")) return authHeader.slice("Bearer ".length);
  return request.cookies[cookieName];
}

export const authPlugin = fp(async (app) => {
  app.decorate("authenticateUser", async (request: FastifyRequest, reply: FastifyReply) => {
    const token = readToken(request, "user_session");
    if (!token) return reply.code(401).send({ message: "Authentication required" });

    const session = await prisma.userSession.findUnique({
      where: { tokenHash: hashSecret(token) },
      include: { user: true }
    });

    if (!session || session.expiresAt < new Date() || session.user.status !== "active") {
      return reply.code(401).send({ message: "Authentication required" });
    }

    request.user = { id: session.userId };
  });

  app.decorate("authenticateChatUser", async (request: FastifyRequest, reply: FastifyReply) => {
    if (!env.VISITOR_CHAT_ENABLED) {
      return reply.code(503).send({ code: "VISITOR_CHAT_DISABLED", message: "Visitor chat is unavailable" });
    }

    const guestToken = request.cookies.guest_session;
    if (guestToken) {
      const session = await prisma.userSession.findUnique({
        where: { tokenHash: hashSecret(guestToken) }, include: { user: true }
      });
      if (session && session.expiresAt > new Date() && session.user.status === "active" && session.user.externalAuthUserId === "guest") {
        request.user = { id: session.userId };
        return;
      }
    }

    const token = randomBytes(32).toString("hex");
    const expiresAt = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000);
    const user = await prisma.user.create({
      data: {
        phoneNumber: `guest:${randomBytes(20).toString("hex")}`,
        externalAuthUserId: "guest",
        appTokenBalance: 0,
        sessions: { create: { tokenHash: hashSecret(token), expiresAt } }
      }
    });
    // The stream route writes directly to the raw response, so set this header there too.
    reply.raw.setHeader("Set-Cookie", `guest_session=${token}; Path=/; HttpOnly; SameSite=Lax; Expires=${expiresAt.toUTCString()}${process.env.NODE_ENV === "production" ? "; Secure" : ""}`);
    request.user = { id: user.id };
  });

  app.decorate("authenticateAdmin", async (request: FastifyRequest, reply: FastifyReply) => {
    const token = readToken(request, "admin_session");
    if (!token) return reply.code(401).send({ message: "Admin authentication required" });

    const session = await prisma.adminSession.findUnique({ where: { tokenHash: hashSecret(token) } });
    if (!session || session.expiresAt < new Date()) {
      return reply.code(401).send({ message: "Admin authentication required" });
    }

    request.admin = true;
  });
});

declare module "fastify" {
  interface FastifyInstance {
    authenticateUser(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    authenticateAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    authenticateChatUser(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}
