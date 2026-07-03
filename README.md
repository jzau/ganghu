# GANGHU AI 工夫

V1 modular monolith for GANGHU AI, also named 工夫, with phone OTP login, app-token redemption, model selection, streamed OpenRouter chat, and a password-protected admin dashboard.

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

The mock OTP code is `000000`. If `OPENROUTER_API_KEY` is empty, chat returns a local fallback response while still exercising persistence and billing.

## Future Clients

The web app uses the same JSON API and shared DTO package intended for future iOS, Android, and desktop clients. Session tokens are set as httpOnly cookies for web and also returned from login endpoints so native clients can store and send them as bearer tokens.
