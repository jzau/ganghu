import { config } from "dotenv";
import { z } from "zod";

config({ path: new URL("../../../../.env", import.meta.url).pathname });

const booleanFromEnv = z.preprocess((value) => {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return value;
  return value.trim().toLowerCase() === "true";
}, z.boolean());

const schema = z.object({
  DATABASE_URL: z.string().min(1).default("postgresql://postgres:postgres@localhost:5432/ai_chat_app?schema=public"),
  API_PORT: z.coerce.number().default(4000),
  WEB_ORIGIN: z.string().default("http://localhost:5173"),
  SESSION_SECRET: z.string().min(16).default("dev-session-secret-change-me"),
  ADMIN_PASSWORD: z.string().min(1).default("change-me"),
  AUTH_SERVICE_ENABLED: booleanFromEnv.default(false),
  AUTH_SERVICE_BASE_URL: z.string().url().default(process.env.AUTH_SERVICE_URL ?? "http://localhost:5000"),
  AUTH_SERVICE_APP_ID: z.string().optional().default(process.env.AUTH_APP_ID ?? ""),
  AUTH_SERVICE_API_KEY: z.string().optional().default(process.env.AUTH_API_KEY ?? ""),
  AUTH_TEST_OTP: z.string().optional().default(process.env.AUTH_SERVICE_TEST_OTP ?? ""),
  OPENROUTER_API_KEY: z.string().optional().default(""),
  OPENROUTER_BASE_URL: z.string().url().default("https://openrouter.ai/api/v1"),
  OPENROUTER_SITE_URL: z.string().optional().default("http://localhost:5173"),
  OPENROUTER_APP_NAME: z.string().optional().default("GANGHU AI"),
  TAVILY_API_KEY: z.string().optional().default(""),
  TAVILY_BASE_URL: z.string().url().default("https://api.tavily.com"),
  SEARCH_PLANNER_MODEL: z.string().min(1).default("deepseek/deepseek-v4-flash"),
  SEARCH_PLANNER_FALLBACK_MODEL: z.string().optional().default(""),
  SEARCH_PLANNER_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(12_000),
  SEARCH_PLANNER_MAX_TOKENS: z.coerce.number().int().min(128).max(2_000).default(500),
  SEARCH_TIMEOUT_MS: z.coerce.number().int().min(500).max(30_000).default(8_000),
  SEARCH_MAX_RESULTS: z.coerce.number().int().min(1).max(8).default(5),
  AGENT_RUN_TIMEOUT_MS: z.coerce.number().int().min(5_000).max(120_000).default(60_000)
});

export const env = schema.parse(process.env);
