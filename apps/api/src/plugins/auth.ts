import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { prisma } from "../lib/prisma.js";
import { hashSecret } from "../lib/crypto.js";

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
  const identifyUser = async (request: FastifyRequest) => {
    const token = readToken(request, "user_session");
    if (!token) return;

    const session = await prisma.userSession.findUnique({
      where: { tokenHash: hashSecret(token) },
      include: { user: true }
    });

    if (!session || session.expiresAt < new Date() || session.user.status !== "active") {
      return;
    }

    request.user = { id: session.userId };
  };

  app.decorate("optionalAuthenticateUser", identifyUser);
  app.decorate("authenticateUser", async (request: FastifyRequest, reply: FastifyReply) => {
    await identifyUser(request);
    if (!request.user) return reply.code(401).send({ message: "Authentication required" });
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
    optionalAuthenticateUser(request: FastifyRequest): Promise<void>;
    authenticateUser(request: FastifyRequest, reply: FastifyReply): Promise<void>;
    authenticateAdmin(request: FastifyRequest, reply: FastifyReply): Promise<void>;
  }
}
