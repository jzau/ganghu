import { buildApp } from "./app.js";
import { env } from "./lib/env.js";
import { prisma } from "./lib/prisma.js";

const app = buildApp();

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function shutdown() {
  await app.close();
  await prisma.$disconnect();
  process.exit(0);
}

await app.listen({ port: env.API_PORT, host: "0.0.0.0" });
