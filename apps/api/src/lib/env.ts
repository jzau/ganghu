import { config } from "dotenv";
import { z } from "zod";

config({ path: new URL("../../../../.env", import.meta.url).pathname });

const schema = z.object({
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/ai_chat_app?schema=public"),
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  SESSION_SECRET: z.string().min(16).default("dev-session-secret-change-me"),
  ADMIN_PASSWORD: z.string().min(1).default("change-me"),
  AUTH_SERVICE_ENABLED: z.coerce.boolean().default(false),
  AUTH_SERVICE_BASE_URL: z.string().url().default("http://localhost:5000"),
  AUTH_SERVICE_APP_ID: z.string().optional().default(""),
  AUTH_SERVICE_API_KEY: z.string().optional().default(""),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_SITE_URL: z.string().optional().default("http://localhost:5173"),
  OPENROUTER_APP_NAME: z.string().optional().default("GANGHU AI")
});

export const env = schema.parse(process.env);
