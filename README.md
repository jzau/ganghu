# Gangram

Gangram is a modular AI chatbot and an upstream AI provider for Toking. Its visible product name remains deployment-specific through `VITE_APP_NAME_EN`, `VITE_APP_NAME_ZH`, and `OPENROUTER_APP_NAME`.

## Local Setup

1. Install dependencies:

   ```sh
   npm install
   ```

2. Copy environment values:

   ```sh
   cp .env.example .env
   ```

3. Create and seed the database:

   ```sh
   npm run prisma:generate
   npm run prisma:migrate -- --name init
   npm run prisma:seed
   ```

4. Start development:

   ```sh
   npm run dev
   ```

Visitors can chat without an account at `/`. The web app uses `/api/visitor` for models, conversations, and streaming responses. A private browser cookie keeps each visitor's conversation history separate. Set `VISITOR_CHAT_ENABLED=false` and restart the API to return HTTP 503 from the visitor chat and model endpoints. The admin API remains available at `/api/admin`. Configure `OPENROUTER_API_KEY` and enable at least one OpenRouter model for chat responses. Configure a search provider if you want web search.

## Toking provider integration

Gangram exposes an OpenAI-compatible provider API for Toking at `GET /v1/models` and `POST /v1/chat/completions`. Configure one or more comma-separated `TOKING_PROVIDER_API_KEYS`; the same credential is registered for Gangram in Toking's `AI_PROVIDERS` configuration. This is a provider-specific shared secret, not a Toking customer API key or either application's internal-service secret. Toking must send both `Authorization: Bearer <provider-key>` and `X-Toking-Provider-Contract: 1`.

These server-to-server requests use Gangram's enabled model catalog and inference connection, but do not create chatbot conversations, deduct local app tokens, redeem codes, or write to the local usage ledger. Toking remains responsible for customer authentication, reservations, and credit settlement. For the POC, Gangram passes through OpenRouter's reported `usage.cost`; a commercial provider price can replace that behavior later.

Gangram does not need its own public URL as an environment variable because it does not currently generate absolute provider links. The URL is deployment configuration on the Toking side. For production, register Gangram there with `baseUrl` set to `https://gangram.ai/v1` and `apiKey` set to one of Gangram's `TOKING_PROVIDER_API_KEYS`.

Search provider values:

- `tavily`
- `aliyun-iqs`
- `baidu-qianfan`
- `perplexity`
- `doubao-search`

Baidu Qianfan uses the raw `baidu_search_v2` web-search endpoint:

```env
BAIDU_QIANFAN_API_KEY="..."
```

Perplexity uses its raw ranked-results Search API:

```env
PERPLEXITY_API_KEY="..."
```

Doubao Search uses Volcengine's Custom web-search API:

```env
DOUBAO_SEARCH_API_KEY="..."
```

To compare Tavily and Alibaba Cloud IQS UnifiedSearch with the same queries and result limit, configure both API keys and run:

```sh
npm run search:compare -- "latest Solana ecosystem news" "上海今天的重要科技新闻"
```

The command prints normalized results, latency, reported credits, and exact URL overlap as JSON. Judge relevance and source quality from the returned titles, snippets, and URLs; latency and overlap alone do not establish which provider is better.

## Deployment

See [Deploy to Debian](docs/deploy-debian.md) for the production setup with PostgreSQL, PM2, Nginx, and HTTPS.

## Future Clients

The visitor API uses a private browser cookie to identify a chat session. Native clients can persist and resend that cookie to keep conversation history.
