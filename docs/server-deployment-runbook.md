# Deployment Runbook: `160.187.111.10`

Last verified: 2026-09-22

This runbook documents the actual test deployments on `160.187.111.10`. It
supplements [deploy-debian.md](./deploy-debian.md), which describes a new Debian
installation.

Do not put passwords, API keys, database URLs, session secrets, or raw PM2
environment output in this document or in deployment logs.

## Server access and constraints

- Deployment login: `ssh deploy@160.187.111.10`
- Node used by the deploy account: `/home/deploy/.nvm/versions/node/v24.9.0/bin/node`
- PM2 used by the deploy account: `/home/deploy/.nvm/versions/node/v24.9.0/bin/pm2`
- Deploy-user PM2 state: `/home/deploy/.pm2/dump.pm2`
- The server has approximately 3 GB RAM and 2 GB swap.
- Build TypeScript and Vite assets locally. Do not run the full application
  build on this server because it can cause CPU and memory pressure.
- Run the small Prisma generation and migration steps serially with reduced CPU
  priority.
- The root and deploy accounts have separate PM2 daemons and process lists.
  Never use `sudo pm2` for a deploy-owned application.

## Live instance map

| Public hostname | Ownership | Checkout / frontend root | API | PM2 process | Nginx file | Normal source ref |
| --- | --- | --- | --- | --- | --- | --- |
| `gangram.chat` | `deploy` | `/opt/apps/chatbot-test/gangram`; frontend at `apps/web/dist` | `127.0.0.1:6730` | `gangram-api` | `/etc/nginx/sites-available/gangram` | Explicitly requested branch; often `cn-submit` |
| `android.ganghu.com.cn` | `deploy` | Same Gangram checkout and frontend | Same port 6730 | Same `gangram-api` | `/etc/nginx/sites-available/android.ganghu.com.cn` | Same release as `gangram.chat` |
| `ganghu.llab.so` | `deploy` | `/opt/apps/chatbot-test/ganghu`; frontend at `apps/web/dist` | `127.0.0.1:6714` | `ganghu-test-api` | `/etc/nginx/sites-available/ganghu-test` | `main` |
| `ganghu.chat` | `root` | Nginx root `/var/www/ganghu` | `127.0.0.1:6704` | Root-owned PM2 process | `/etc/nginx/sites-available/ganghu` | Root-managed; do not deploy as `deploy` |

`android.ganghu.com.cn` is an alias at the infrastructure level, but browser
cookies are hostname-specific. Its visitor session or login cookie is therefore
separate from the one on `gangram.chat`.

## PM2 reboot behavior

The server currently has two enabled system services:

- `pm2-deploy.service` restores `/home/deploy/.pm2/dump.pm2`.
- `pm2-root.service` restores the root-owned PM2 process list.

`pm2 save` records the current process list and each saved process state; it does
not itself create the boot hook. The enabled systemd services provide that hook.
After a successful deploy-user deployment, run:

```sh
/home/deploy/.nvm/versions/node/v24.9.0/bin/pm2 save
```

Useful checks:

```sh
systemctl is-enabled pm2-deploy.service
systemctl is-active pm2-deploy.service
/home/deploy/.nvm/versions/node/v24.9.0/bin/pm2 status
```

## Environment boundaries

Each checkout has its own `.env`. Never copy one instance's `.env` over another
instance.

Important non-secret differences:

| Setting | Gangram checkout | Ganghu test checkout |
| --- | --- | --- |
| `API_PORT` | `6730` | `6714` |
| `WEB_ORIGIN` | `https://gangram.chat` | `https://ganghu.llab.so` |
| `VITE_APP_NAME_EN` | `GANGRAM` | `GANGHU AI` |
| `VITE_APP_NAME_ZH` | `GANGRAM` | `工夫 AI` |
| PostgreSQL schema | `gangram` | `public` |

Secret values that must remain server-side include `DATABASE_URL`,
`SESSION_SECRET`, `ADMIN_PASSWORD`, provider keys, payment secrets, and Toking
credentials. Check only whether they are set; do not print their values.

These are test environments. Do not set `NODE_ENV=production` without first
confirming that every configured payment URL uses HTTPS; the API intentionally
rejects HTTP payment URLs in production mode.

JSON values in dotenv files must be valid after dotenv parsing. Prefer raw JSON
or single-quoted JSON:

```dotenv
PAYMENT_OFFERS_JSON='[{"id":"example","amountMinor":1000,"currency":"USD","appTokenAmount":10000}]'
```

Do not wrap JSON in double quotes and escape every inner quote. That leaves
literal backslashes in some dotenv parsers and causes an API startup failure.

## Deployment policy

1. Deploy only the hostname and branch named in the request.
2. Never touch `ganghu.chat` during a deploy-user deployment.
3. Preserve unrelated local and server changes.
4. Deploy committed content only. Do not package uncommitted working-tree files.
5. Build locally with the target instance's branding.
6. Use a Git bundle when the server cannot safely fetch the desired local
   commit from the remote repository.
7. Apply production migrations before activating API code that depends on them.
8. Restart only the target API. A frontend-only change needs no PM2 restart.
9. Keep the previous artifacts until the new release has passed live checks.

## 1. Select and inspect the release

Set target-specific values locally. Example for `ganghu.llab.so`:

```sh
deploy_branch=main
deploy_host=ganghu.llab.so
deploy_dir=/opt/apps/chatbot-test/ganghu
deploy_pm2=ganghu-test-api
deploy_name_en='GANGHU AI'
deploy_name_zh='工夫 AI'
```

For `gangram.chat`, use:

```sh
deploy_branch=cn-submit  # or the branch explicitly requested
deploy_host=gangram.chat
deploy_dir=/opt/apps/chatbot-test/gangram
deploy_pm2=gangram-api
deploy_name_en=GANGRAM
deploy_name_zh=GANGRAM
```

Inspect the local ref and server state:

```sh
git status --short --branch
git log -8 --oneline --decorate "$deploy_branch"

ssh deploy@160.187.111.10 \
  "git -C '$deploy_dir' status --short && \
   git -C '$deploy_dir' rev-parse HEAD && \
   free -m && \
   /home/deploy/.nvm/versions/node/v24.9.0/bin/pm2 status '$deploy_pm2'"
```

Record the current server revision for the bundle and rollback notes:

```sh
server_revision=$(ssh deploy@160.187.111.10 "git -C '$deploy_dir' rev-parse HEAD")
release_revision=$(git rev-parse "$deploy_branch")
release_short=$(git rev-parse --short "$deploy_branch")
git merge-base --is-ancestor "$server_revision" "$deploy_branch"
```

Stop if the ancestry check fails. Resolve the branch history rather than using
`git reset --hard` on the server.

## 2. Build the exact committed branch locally

An isolated export avoids including unrelated working-tree changes:

```sh
build_dir=$(mktemp -d /tmp/chatbot-release.XXXXXX)
git archive "$deploy_branch" | tar -x -C "$build_dir"
```

If `package-lock.json` is unchanged and the local dependencies are current, the
existing dependency directory can be reused for the build:

```sh
ln -s "$(pwd)/node_modules" "$build_dir/node_modules"
```

Otherwise, run `npm ci` in the isolated directory on the local machine.

Validate all workspaces:

```sh
cd "$build_dir"
npm run typecheck
```

Run every API test file. This explicit file list avoids shell `**` differences
that can cause the package test script to run only top-level tests:

```sh
cd "$build_dir/apps/api"
rg --files src -g '*.test.ts' -0 | \
  xargs -0 ../../node_modules/.bin/tsx --test
cd "$build_dir"
```

One PostgreSQL integration test may be skipped when no disposable integration
database is configured. There must be no failed tests.

Build using the target branding:

```sh
VITE_APP_NAME_EN="$deploy_name_en" \
VITE_APP_NAME_ZH="$deploy_name_zh" \
npm run build
```

Expected artifacts:

- `apps/api/dist`
- `apps/web/dist`
- `packages/shared/dist`

## 3. Package and upload

From the repository checkout, create a source bundle containing only the
commits after the server's current revision:

```sh
bundle_file="/tmp/${deploy_pm2}-${release_short}.bundle"
artifact_file="/tmp/${deploy_pm2}-${release_short}-artifacts.tgz"

git bundle create "$bundle_file" \
  "${server_revision}..${deploy_branch}"

tar -C "$build_dir" -czf "$artifact_file" \
  apps/api/dist apps/web/dist packages/shared/dist

shasum -a 256 "$bundle_file" "$artifact_file"
scp "$bundle_file" "$artifact_file" deploy@160.187.111.10:/tmp/
```

Record both SHA-256 values and compare them on the server before using the
files.

For a frontend-only commit, the artifact archive may contain only
`apps/web/dist`; do not restart PM2 in that case.

## 4. Update source and prepare the database

Connect to the target checkout and verify the uploaded hashes:

```sh
ssh deploy@160.187.111.10
cd /opt/apps/chatbot-test/ganghu  # or the confirmed Gangram checkout
release_short=abcdef0             # replace with the new revision
deploy_branch=main                # use the explicitly requested branch
deploy_pm2=ganghu-test-api        # use gangram-api for Gangram
deploy_host=ganghu.llab.so        # use gangram.chat for Gangram
api_port=6714                     # use 6730 for Gangram
bundle_name="${deploy_pm2}-${release_short}.bundle"
artifact_name="${deploy_pm2}-${release_short}-artifacts.tgz"
sha256sum "/tmp/$bundle_name" "/tmp/$artifact_name"
```

Fast-forward the checkout from the bundle:

```sh
git fetch "/tmp/$bundle_name" "$deploy_branch"
git merge --ff-only FETCH_HEAD
```

Set the deploy user's Node path and run Prisma steps serially:

```sh
export PATH=/home/deploy/.nvm/versions/node/v24.9.0/bin:/usr/local/bin:/usr/bin:/bin
nice -n 10 npm run prisma:generate
nice -n 10 npm run prisma:migrate:deploy
```

Do not run `prisma migrate dev` on the server. Do not automatically reverse a
migration during rollback.

### If the target checkout lacks the Prisma CLI

The Ganghu test checkout has previously been installed without the `prisma`
development package. Do not run a large `npm install` during deployment. A
compatible CLI currently exists in the Gangram checkout. First prove all
versions match:

```sh
node -p 'require("@prisma/client/package.json").version'
node -p 'require("/opt/apps/chatbot-test/gangram/node_modules/prisma/package.json").version'
node -p 'require("/opt/apps/chatbot-test/gangram/node_modules/@prisma/client/package.json").version'
```

Only when all versions are identical, use:

```sh
prisma_cli=/opt/apps/chatbot-test/gangram/node_modules/.bin/prisma
nice -n 10 "$prisma_cli" generate --schema apps/api/prisma/schema.prisma
nice -n 10 "$prisma_cli" migrate deploy --schema apps/api/prisma/schema.prisma
```

## 5. Switch the artifacts

Extract into a staging directory and validate it before touching the active
directories:

```sh
stage_dir=$(mktemp -d /tmp/chatbot-stage.XXXXXX)
tar -xzf "/tmp/$artifact_name" -C "$stage_dir"
test -f "$stage_dir/apps/api/dist/server.js"
test -f "$stage_dir/apps/web/dist/index.html"
```

Keep revision-labelled rollback directories:

```sh
test ! -e "apps/api/dist.pre-${release_short}"
test ! -e "apps/web/dist.pre-${release_short}"
test ! -e "packages/shared/dist.pre-${release_short}"

mv apps/api/dist "apps/api/dist.pre-${release_short}"
mv apps/web/dist "apps/web/dist.pre-${release_short}"
mv packages/shared/dist "packages/shared/dist.pre-${release_short}"

mv "$stage_dir/apps/api/dist" apps/api/dist
mv "$stage_dir/apps/web/dist" apps/web/dist
mv "$stage_dir/packages/shared/dist" packages/shared/dist
```

Restart only the selected API:

```sh
/home/deploy/.nvm/versions/node/v24.9.0/bin/pm2 restart "$deploy_pm2" --update-env
```

For a web-only release, replace only `apps/web/dist`. Nginx serves it directly,
so no API restart or Nginx reload is required.

## 6. Verify before declaring success

Check direct API health, public health, the frontend, and the process:

```sh
curl -fsS "http://127.0.0.1:${api_port}/health"
curl -fsS "https://${deploy_host}/health"
curl -fsS -o /dev/null -w '%{http_code}\n' "https://${deploy_host}/"
/home/deploy/.nvm/versions/node/v24.9.0/bin/pm2 status "$deploy_pm2"
free -m
```

Verify the HTML and hashed JavaScript/CSS files return HTTP 200. Compare local
and server SHA-256 hashes for `index.html` and its referenced assets.

Do not trust a PM2 `online` status immediately after restart. A crash-looping
process can appear online briefly. Check again after the API has been up long
enough to bind its port, and confirm that the restart count stops increasing:

```sh
/home/deploy/.nvm/versions/node/v24.9.0/bin/pm2 describe "$deploy_pm2"
```

After all checks pass:

```sh
/home/deploy/.nvm/versions/node/v24.9.0/bin/pm2 save
```

## Rollback

Application migrations on this server are designed to be additive. Do not undo
database migrations automatically. Restore the previous runtime artifacts and
investigate the database separately if necessary.

For an API and frontend rollback:

```sh
pm2_bin=/home/deploy/.nvm/versions/node/v24.9.0/bin/pm2
failed_suffix=$(date +%Y%m%d%H%M%S)
"$pm2_bin" stop "$deploy_pm2"

mv apps/api/dist "apps/api/dist.failed-${failed_suffix}"
mv apps/web/dist "apps/web/dist.failed-${failed_suffix}"
mv packages/shared/dist "packages/shared/dist.failed-${failed_suffix}"

mv "apps/api/dist.pre-${release_short}" apps/api/dist
mv "apps/web/dist.pre-${release_short}" apps/web/dist
mv "packages/shared/dist.pre-${release_short}" packages/shared/dist

"$pm2_bin" restart "$deploy_pm2"
```

Restore a saved `.env.pre-${release_short}` only if that release changed environment
configuration. Verify health and run `pm2 save` after recovery.

## Troubleshooting

### Nginx returns 502

Check the process, local port, and recent error output:

```sh
/home/deploy/.nvm/versions/node/v24.9.0/bin/pm2 status "$deploy_pm2"
curl -i "http://127.0.0.1:${api_port}/health"
/home/deploy/.nvm/versions/node/v24.9.0/bin/pm2 describe "$deploy_pm2"
tail -n 60 "/home/deploy/.pm2/logs/${deploy_pm2}-error.log"
```

Avoid printing full PM2 environment dumps or large logs because they may contain
secrets.

### Payment JSON fails during startup

A message such as `SyntaxError` from `JSON.parse` in `payments/config.js` usually
means `PAYMENT_OFFERS_JSON` or `PAYMENT_METHODS_JSON` contains literal escaped
quotes. Back up `.env`, normalize those two values to valid JSON, restart only
the target API, and verify that the restart count stops increasing.

### API fails only with `NODE_ENV=production`

Production mode requires all payment URLs to use HTTPS. These are test
deployments and may use an internal HTTP payment endpoint. Either configure the
complete HTTPS path before enabling production mode or retain the existing test
mode.

### Memory is low

- Do not run `npm run build` on the server.
- Run Prisma operations one at a time with `nice -n 10`.
- Check `free -m` before and after deployment.
- Do not restart all PM2 applications for a single-instance release.

## Nginx and new hostnames

Use a separate file in `/etc/nginx/sites-available` for each hostname, even when
two hostnames share the same application. This keeps certificates and future
changes isolated. Point the new server block to the existing frontend root and
API port, enable it with a symlink in `/etc/nginx/sites-enabled`, run
`nginx -t`, and obtain a dedicated certificate with Certbot.

Nginx and Certbot operations require root access. They are not part of a normal
application release.

The current test-domain server blocks proxy `/api/` and `/health`. If the
public provider API under `/v1/` is required on a hostname, add and test a
dedicated `/v1/` proxy location as a separate root-level Nginx change; an
application artifact deployment does not modify Nginx.
