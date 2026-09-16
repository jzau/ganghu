import assert from "node:assert/strict";
import test from "node:test";
import cookie from "@fastify/cookie";
import Fastify from "fastify";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { authPlugin } from "./auth.js";

test("visitor receives a private cookie and reuses the same chat identity", async (t) => {
  const originalCreate = prisma.user.create;
  const originalFind = prisma.userSession.findUnique;
  const originalEnabled = env.VISITOR_CHAT_ENABLED;
  Reflect.set(env, "VISITOR_CHAT_ENABLED", true);
  let created = 0;
  Reflect.set(prisma.user, "create", async () => { created++; return { id: "visitor-1" }; });
  Reflect.set(prisma.userSession, "findUnique", async () => ({
    userId: "visitor-1", expiresAt: new Date(Date.now() + 60_000),
    user: { status: "active", externalAuthUserId: "guest" }
  }));
  t.after(() => {
    Reflect.set(prisma.user, "create", originalCreate);
    Reflect.set(prisma.userSession, "findUnique", originalFind);
    Reflect.set(env, "VISITOR_CHAT_ENABLED", originalEnabled);
  });
  const app = Fastify();
  await app.register(cookie);
  await app.register(authPlugin);
  app.get("/visitor", { preHandler: app.authenticateChatUser }, async (request) => ({ id: request.user!.id }));
  t.after(() => app.close());
  const first = await app.inject({ url: "/visitor" });
  assert.equal(first.statusCode, 200);
  assert.equal(first.json().id, "visitor-1");
  const sessionCookie = first.headers["set-cookie"]?.toString().split(";")[0];
  assert.match(sessionCookie ?? "", /^guest_session=/);
  const second = await app.inject({ url: "/visitor", headers: { cookie: sessionCookie } });
  assert.equal(second.json().id, "visitor-1");
  assert.equal(created, 1);

  Reflect.set(env, "VISITOR_CHAT_ENABLED", false);
  const disabled = await app.inject({ url: "/visitor", headers: { cookie: sessionCookie } });
  assert.equal(disabled.statusCode, 503);
  assert.equal(disabled.json().code, "VISITOR_CHAT_DISABLED");
});
