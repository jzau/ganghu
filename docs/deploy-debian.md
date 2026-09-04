# Deploy to Debian

This guide deploys the GANGHU AI app on a Debian server with:

- PostgreSQL for the database
- PM2 for the Node API process
- Nginx for the frontend static files and API reverse proxy
- Certbot for HTTPS

The app is a monorepo:

- API: `@ai-chat/api`
- Web frontend: `@ai-chat/web`
- Shared package: `@ai-chat/shared`

## Current State Checklist

If you already ran:

```sh
npm run build
pm2 start npm --name ganghu-api -- run start --workspace @ai-chat/api
```

then the remaining steps are:

1. Confirm the API is healthy:

   ```sh
   pm2 status
   curl http://127.0.0.1:4000/health
   ```

2. Configure Nginx to serve `apps/web/dist`.
3. Configure Nginx to proxy `/api/` and `/v1/` to `http://127.0.0.1:4000`.
4. Reload Nginx.
5. Add HTTPS with Certbot.

The frontend does not need a PM2 process in production. It is a static Vite build served by Nginx from `apps/web/dist`.

## 1. Install Server Dependencies

```sh
sudo apt update
sudo apt install -y curl git nginx postgresql postgresql-contrib
```

Install Node.js 20:

```sh
curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
sudo apt install -y nodejs
node -v
npm -v
```

Install PM2 if it is not already installed:

```sh
sudo npm install -g pm2
pm2 -v
```

## 2. Create the PostgreSQL Database

Open PostgreSQL as the admin user:

```sh
sudo -u postgres psql
```

Run:

```sql
CREATE USER ganghu WITH LOGIN PASSWORD 'replace-with-strong-db-password';
CREATE DATABASE ai_chat_app OWNER ganghu;
GRANT ALL PRIVILEGES ON DATABASE ai_chat_app TO ganghu;
\q
```

If the user already exists, reset the password instead:

```sh
sudo -u postgres psql -c "ALTER ROLE ganghu WITH LOGIN PASSWORD 'replace-with-strong-db-password';"
```

Check which port your real PostgreSQL cluster uses:

```sh
sudo pg_lsclusters
```

If it shows port `5433`, use `5433` in `DATABASE_URL`. On this server, port `5432` may be a Docker proxy, not the Debian PostgreSQL cluster.

Test the connection:

```sh
psql "postgresql://ganghu:replace-with-strong-db-password@127.0.0.1:5433/ai_chat_app"
```

Then quit:

```sql
\q
```

## 3. Clone the App

Example path:

```sh
cd /root
git clone YOUR_REPO_URL ganghu
cd /root/ganghu
```

A cleaner production path is `/var/www/ganghu`, but `/root/ganghu` also works for PM2. If you use `/root/ganghu`, Nginx may need extra permission to read frontend files.

## 4. Configure Environment Variables

Create `.env`:

```sh
cp .env.example .env
vi .env
```

Example production values:

```env
DATABASE_URL="postgresql://ganghu:replace-with-strong-db-password@127.0.0.1:5433/ai_chat_app?schema=public"
API_PORT=4000
WEB_ORIGIN="https://your-domain.com"
VITE_APP_NAME_EN="GANGHU AI"
VITE_APP_NAME_ZH="工夫 AI"
SESSION_SECRET="replace-with-a-long-random-secret-at-least-32-chars"
ADMIN_PASSWORD="replace-with-strong-admin-password"

AUTH_SERVICE_ENABLED=false
AUTH_SERVICE_BASE_URL="http://localhost:5000"
AUTH_SERVICE_APP_ID=""
AUTH_SERVICE_API_KEY=""

OPENROUTER_API_KEY="your-openrouter-api-key"
OPENROUTER_BASE_URL="https://openrouter.ai/api/v1"
OPENROUTER_SITE_URL="https://your-domain.com"
OPENROUTER_APP_NAME="GANGHU AI"
TOKING_PROVIDER_API_KEYS="replace-with-a-long-provider-secret"
TOKING_PROVIDER_CONTRACT_VERSION="1"
```

Important:

- `WEB_ORIGIN` must match the public frontend URL.
- `VITE_APP_NAME_EN` and `VITE_APP_NAME_ZH` set the visible name, browser metadata, legal copy, and installed-app name. Because they are build-time values, run `npm run build` after changing them.
- `OPENROUTER_SITE_URL` should also be the public frontend URL.
- `TOKING_PROVIDER_API_KEYS` contains the provider credential shared only with Toking. It is unrelated to Toking customer API keys.
- Keep `API_PORT=4000` unless you also update the Nginx proxy.
- Use the PostgreSQL port from `sudo pg_lsclusters`.

## 5. Install, Migrate, Seed, and Build

```sh
npm install
npm run prisma:generate
unset DATABASE_URL
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm run prisma:seed
npm run build
```

`npm run build` creates:

- API build: `apps/api/dist`
- Web build: `apps/web/dist`

## 6. Start the API with PM2

From the app root:

```sh
cd /root/ganghu
pm2 start npm --name ganghu-api -- run start --workspace @ai-chat/api
```

Check status and logs:

```sh
pm2 status
pm2 logs ganghu-api
```

Save PM2 state:

```sh
pm2 save
pm2 startup
```

`pm2 startup` prints a `sudo env PATH=... pm2 startup ...` command. Copy and run that exact command once so PM2 restarts after server reboot.

## 7. Configure Nginx

Create a site config:

```sh
sudo vi /etc/nginx/sites-available/ganghu
```

Use this config, replacing `your-domain.com` and the app path if needed:

```nginx
server {
    listen 80;
    server_name your-domain.com;

    root /root/ganghu/apps/web/dist;
    index index.html;

    location /api/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location /v1/ {
        proxy_pass http://127.0.0.1:4000;
        proxy_http_version 1.1;
        proxy_buffering off;
        proxy_read_timeout 300s;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }

    location = /health {
        proxy_pass http://127.0.0.1:4000/health;
        proxy_set_header Host $host;
    }

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

Enable it:

```sh
sudo ln -s /etc/nginx/sites-available/ganghu /etc/nginx/sites-enabled/ganghu
sudo nginx -t
sudo systemctl reload nginx
```

If Nginx returns `403 Forbidden` while using `/root/ganghu/apps/web/dist`, move the app to `/var/www/ganghu` or grant Nginx read access. Recommended production path:

```sh
sudo mkdir -p /var/www
sudo mv /root/ganghu /var/www/ganghu
sudo chown -R $USER:www-data /var/www/ganghu
sudo chmod -R 755 /var/www/ganghu
```

Then update:

- Nginx `root` to `/var/www/ganghu/apps/web/dist`
- PM2 working command to run from `/var/www/ganghu`

Restart PM2 after moving:

```sh
cd /var/www/ganghu
pm2 delete ganghu-api
pm2 start npm --name ganghu-api -- run start --workspace @ai-chat/api
pm2 save
```

## 8. Enable HTTPS

Install Certbot:

```sh
sudo apt install -y certbot python3-certbot-nginx
```

Issue the certificate:

```sh
sudo certbot --nginx -d your-domain.com
```

Certbot will update the Nginx config for HTTPS.

## 9. Verify the Deployment

Check the API directly:

```sh
curl http://127.0.0.1:4000/health
```

Check through Nginx:

```sh
curl https://your-domain.com/health
```

Check the authenticated Gangram provider catalog through Nginx:

```sh
curl https://gangram.ai/v1/models \
  -H 'Authorization: Bearer replace-with-a-long-provider-secret' \
  -H 'X-Toking-Provider-Contract: 1'
```

Open:

```text
https://your-domain.com
```

Admin dashboard:

```text
https://your-domain.com/admin
```

## 10. Future Deploys

```sh
cd /root/ganghu
git pull
npm install
npm run prisma:generate
unset DATABASE_URL
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
npm run prisma:seed
npm run build
pm2 restart ganghu-api
sudo nginx -t
sudo systemctl reload nginx
```

If the app lives in `/var/www/ganghu`, use that path instead.

## Troubleshooting

### Prisma Cannot Reach `localhost:5432`

Check the real PostgreSQL port:

```sh
sudo pg_lsclusters
sudo ss -ltnp | grep 5432
```

If `pg_lsclusters` shows PostgreSQL on `5433`, but `5432` is owned by `docker-proxy`, update `.env`:

```env
DATABASE_URL="postgresql://ganghu:replace-with-strong-db-password@127.0.0.1:5433/ai_chat_app?schema=public"
```

Then rerun:

```sh
unset DATABASE_URL
npx prisma migrate deploy --schema apps/api/prisma/schema.prisma
```

### `psql` Rejects `?schema=public`

`psql` does not accept Prisma's `schema` query parameter. Test without it:

```sh
psql "postgresql://ganghu:replace-with-strong-db-password@127.0.0.1:5433/ai_chat_app"
```

Keep `?schema=public` in `.env` for Prisma.

### Password Authentication Fails

Reset the role password in the correct PostgreSQL cluster:

```sh
sudo -u postgres psql -c "SHOW port;"
sudo -u postgres psql -c "ALTER ROLE ganghu WITH LOGIN PASSWORD 'replace-with-strong-db-password';"
```

Then test:

```sh
PGPASSWORD=replace-with-strong-db-password psql -h 127.0.0.1 -p 5433 -U ganghu -d ai_chat_app -c "SELECT current_user;"
```

### Admin Must Log In Again After Refresh

The admin session uses an HttpOnly cookie named `admin_session`. Make sure:

- `WEB_ORIGIN` exactly matches the public frontend URL
- Browser is using the same domain as `WEB_ORIGIN`
- API is reached through the same Nginx domain under `/api`

### PM2 Useful Commands

```sh
pm2 status
pm2 logs ganghu-api
pm2 restart ganghu-api
pm2 stop ganghu-api
pm2 delete ganghu-api
pm2 save
```
