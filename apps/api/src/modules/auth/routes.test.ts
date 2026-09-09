import assert from "node:assert/strict";
import test from "node:test";
import Fastify from "fastify";
import { env } from "../../lib/env.js";
import { prisma } from "../../lib/prisma.js";
import { authRoutes } from "./routes.js";

test("phone change verifies the current number before the requested new number", async (t) => {
  function stub(target: object, key: string, replacement: unknown) {
    const original = Reflect.get(target, key);
    Reflect.set(target, key, replacement);
    t.after(() => { Reflect.set(target, key, original); });
  }

  const now = new Date("2026-09-08T00:00:00.000Z");
  const currentUser = {
    id: "user-1",
    phoneNumber: "+61412345678",
    displayName: "Avery",
    externalAuthUserId: "mock:+61412345678",
    appTokenBalance: 1000,
    status: "active",
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now
  };
  let updatedPhoneNumber = "";
  const originalAuthEnabled = env.AUTH_SERVICE_ENABLED;
  Reflect.set(env, "AUTH_SERVICE_ENABLED", false);
  t.after(() => { Reflect.set(env, "AUTH_SERVICE_ENABLED", originalAuthEnabled); });
  stub(prisma.user, "findUniqueOrThrow", async () => currentUser);
  stub(prisma.user, "findUnique", async () => null);
  stub(prisma.user, "update", async ({ data }: { data: { phoneNumber: string; externalAuthUserId: string } }) => {
    updatedPhoneNumber = data.phoneNumber;
    return { ...currentUser, ...data, updatedAt: now };
  });

  const app = Fastify();
  app.decorate("authenticateUser", async (request: { user?: unknown }) => { request.user = { id: "user-1" }; });
  await app.register(authRoutes);
  t.after(() => app.close());

  const directRequest = await app.inject({
    method: "POST",
    url: "/phone-change/otp/request",
    payload: { countryCode: "+61", phoneNumber: "499999999", verificationToken: "x".repeat(32) }
  });
  assert.equal(directRequest.statusCode, 403);

  assert.equal((await app.inject({ method: "POST", url: "/phone-change/current/otp/request" })).statusCode, 200);
  const currentVerification = await app.inject({
    method: "POST",
    url: "/phone-change/current/otp/verify",
    payload: { otp: "000000" }
  });
  assert.equal(currentVerification.statusCode, 200);
  const currentToken = currentVerification.json().verificationToken as string;

  const prematureChange = await app.inject({
    method: "POST",
    url: "/phone-change/otp/verify",
    payload: { countryCode: "+61", phoneNumber: "499999999", otp: "000000", verificationToken: currentToken }
  });
  assert.equal(prematureChange.statusCode, 403);
  assert.equal(updatedPhoneNumber, "");

  const newPhoneRequest = await app.inject({
    method: "POST",
    url: "/phone-change/otp/request",
    payload: { countryCode: "+61", phoneNumber: "499999999", verificationToken: currentToken }
  });
  assert.equal(newPhoneRequest.statusCode, 200);
  const newPhoneToken = newPhoneRequest.json().verificationToken as string;

  const changed = await app.inject({
    method: "POST",
    url: "/phone-change/otp/verify",
    payload: { countryCode: "+61", phoneNumber: "499999999", otp: "000000", verificationToken: newPhoneToken }
  });
  assert.equal(changed.statusCode, 200);
  assert.equal(updatedPhoneNumber, "+61499999999");
});
