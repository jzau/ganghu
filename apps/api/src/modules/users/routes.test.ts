import assert from "node:assert/strict";
import test from "node:test";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { prisma } from "../../lib/prisma.js";
import { userRoutes } from "./routes.js";

test("account deletion removes user-owned records before deleting the user", async (t) => {
  const originalTransaction = prisma.$transaction;
  const operations: string[] = [];
  const tx = {
    chatUsageRecord: { deleteMany: async () => { operations.push("usage"); } },
    appTokenLedger: { deleteMany: async () => { operations.push("ledger"); } },
    redeemCodeRedemption: { deleteMany: async () => { operations.push("redemptions"); } },
    conversation: { deleteMany: async () => { operations.push("conversations"); } },
    userSession: { deleteMany: async () => { operations.push("sessions"); } },
    user: { delete: async () => { operations.push("user"); } }
  };
  Reflect.set(prisma, "$transaction", async (callback: (client: typeof tx) => Promise<void>) => callback(tx));
  t.after(() => { Reflect.set(prisma, "$transaction", originalTransaction); });

  const app = Fastify();
  await app.register(cookie);
  app.decorate("authenticateUser", async (request: { user?: unknown }) => { request.user = { id: "user-1" }; });
  await app.register(userRoutes);
  t.after(() => app.close());

  const response = await app.inject({ method: "DELETE", url: "/me", cookies: { user_session: "session" } });
  assert.equal(response.statusCode, 200);
  assert.deepEqual(operations, ["usage", "ledger", "redemptions", "conversations", "sessions", "user"]);
  assert.match(String(response.headers["set-cookie"] ?? ""), /user_session=;/);
});
