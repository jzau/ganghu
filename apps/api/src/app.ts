import { paymentRoutes } from "./modules/payments/routes.js";
import cookie from "@fastify/cookie";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import Fastify from "fastify";
import { randomUUID } from "node:crypto";
import { env } from "./lib/env.js";
import { authPlugin } from "./plugins/auth.js";
import { authRoutes } from "./modules/auth/routes.js";
import { adminRoutes } from "./modules/admin/routes.js";
import { modelRoutes } from "./modules/models/routes.js";
import { redeemRoutes } from "./modules/redeem/routes.js";
import { userRoutes } from "./modules/users/routes.js";
import { chatRoutes } from "./modules/chat/routes.js";
import { providerRoutes } from "./modules/provider/routes.js";

export function buildApp() {
  const app = Fastify({
    logger: true,
    genReqId: (request) => request.headers["x-request-id"]?.toString() ?? randomUUID()
  });

  app.register(cors, {
    origin: env.WEB_ORIGIN,
    credentials: true
  });
  app.register(cookie);
  app.register(rateLimit, { max: 120, timeWindow: "1 minute" });
  app.register(authPlugin);

  app.get("/health", async () => ({ ok: true }));
  app.register(providerRoutes, { prefix: "/v1" });
  app.register(authRoutes, { prefix: "/api/auth" });
  app.register(userRoutes, { prefix: "/api" });
  app.register(modelRoutes, { prefix: "/api" });
  app.register(paymentRoutes, { prefix: "/api/payments" });
  app.register(redeemRoutes, { prefix: "/api" });
  app.register(chatRoutes, { prefix: "/api" });
  app.register(adminRoutes, { prefix: "/api/admin" });

  return app;
}
