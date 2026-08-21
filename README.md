# Relay

Relay is an open-source publishing layer for social networks: publish once, everywhere.

The current repository includes database-backed user accounts, sessions, brands, and social accounts; OAuth connections for Instagram, Facebook, TikTok, and YouTube; a responsive dashboard; an authenticated Cloudflare R2 media library; calendar; post library; connected-account health; settings; command menu; provider abstractions; and a runnable encrypted provider-token refresh worker.

> [!IMPORTANT]
> Authentication, social-account OAuth, automatic token renewal, brands, and the R2 media library are functional. Persisted posts, provider publishing adapters, and the publishing queue are still under development. Deploying this version connects accounts but does not yet publish real posts to social networks.

The composer already captures destination-specific metadata so the publishing adapters have a typed contract to implement:

| Platform | Composer settings | Safe default |
| --- | --- | --- |
| Instagram | Feed post, Reel, or Story | Feed post |
| Facebook | Feed post or Reel, plus an optional link URL | Feed post |
| TikTok | Viewer privacy, comments, Duet, and Stitch | Only me; Duet and Stitch off |
| YouTube | Required video title, comma-separated tags, visibility, and made-for-kids declaration | Private |

TikTok is special: the eventual adapter must call `creator_info/query` immediately before publishing and only show/use the privacy and interaction choices returned for that creator. Relay stores the user's choice now and will reject it if it is unavailable when publishing is implemented. YouTube title is required whenever a YouTube destination is selected. These settings are currently held in the in-browser post model; they are not persisted or sent to provider APIs yet.

## Installation

Relay documents two supported paths:

1. **Coolify for production (recommended):** deploy the public GitHub repository with `compose.coolify.yaml`.
2. **Docker for local testing:** copy `.env.example` to `.env` and run `docker compose up -d --build`.

Both paths include PostgreSQL and run database migrations automatically. You do not need to install Node.js or PostgreSQL on the host. Relay itself is lightweight and does not need a GPU. For a server running both self-hosted Coolify and Relay, start with 2 vCPU, 2 GB RAM, 30 GB free disk, and swap enabled. Use 4 GB RAM when the same server also hosts other applications or repeatedly builds several projects.

## Environment variables

For local Docker, copy the template before starting:

```bash
cp .env.example .env
```

For Coolify, do not upload or create an `.env` file. Enter the same variables in the Coolify **Environment Variables** screen.

Generate different random values for the authentication, database, and setup secrets:

```bash
openssl rand -hex 32
```

The provider-token encryption key must instead be exactly 32 bytes encoded as Base64:

```bash
openssl rand -base64 32
```

### Required application settings

| Variable | Required | Purpose |
| --- | --- | --- |
| `APP_URL` | Yes | Exact public origin. Use `http://localhost:3000` locally and `https://relay.example.com` in production. Do not add a trailing slash. |
| `DATABASE_URL` | No | Generated privately by the included Compose files. Do not set it for the documented Docker or Coolify installations. |
| `POSTGRES_PASSWORD` | Docker/Coolify | Password used by the PostgreSQL container. Use a URL-safe value such as 64 hexadecimal characters. |
| `BETTER_AUTH_SECRET` | Yes | Stable random authentication secret with at least 32 characters. Changing it can invalidate authentication state. |
| `ALLOW_REGISTRATION` | Yes | Set to `true` during owner setup and `false` after creating the account. Values are case-sensitive. |
| `RELAY_SETUP_TOKEN` | First setup | Private token, at least 24 characters, required to create the first owner. |
| `DATABASE_POOL_SIZE` | No | Maximum web-process database connections. Defaults to `5`. |
| `ENCRYPTION_KEY` | Provider integration | A stable Base64-encoded 32-byte key used to encrypt provider access and refresh tokens. Generate it with `openssl rand -base64 32`. Never rotate or lose it: existing connected accounts cannot be decrypted without it. |
| `RELAY_PORT` | Docker only | Host port mapped to Relay. Defaults to `3000`. |

The Compose files set `BETTER_AUTH_URL` from `APP_URL`; users do not need to configure it separately.

### Cloudflare R2 storage

Cloudflare R2 is Relay's only media storage provider, including for local Docker installations. There is no `STORAGE_PROVIDER` switch and no local-filesystem storage mode. This keeps uploaded media independent from containers and gives social networks a stable HTTPS URL from which to fetch it.

```env
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
R2_BUCKET_NAME=relay-media
R2_REGION=auto
R2_ENDPOINT=
R2_PUBLIC_URL=https://media.example.com
```

Create these values in Cloudflare:

1. Open **R2 Object Storage**, create a bucket such as `relay-media`, and optionally attach a custom domain such as `media.example.com`.
2. Open **R2 > Overview > Manage API Tokens** and create an R2 token with **Object Read & Write** permission, scoped only to the Relay bucket.
3. Copy the Access Key ID and Secret Access Key immediately; Cloudflare shows the secret only once.
4. Copy your Cloudflare Account ID. Relay can derive the normal endpoint as `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`.
5. Leave `R2_ENDPOINT` blank for a standard bucket. Set the exact endpoint for an EU-jurisdiction bucket or another S3-compatible service.
6. Configure bucket CORS for each exact Relay origin. For the default local deployment and an example production domain:

```json
[
  {
    "AllowedOrigins": [
      "http://localhost:3000",
      "https://relay.example.com"
    ],
    "AllowedMethods": ["PUT"],
    "AllowedHeaders": ["Content-Type"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3600
  }
]
```

`R2_PUBLIC_URL` must be an HTTPS base URL that the social networks can reach. A Cloudflare custom domain is recommended for production. Never prefix R2 credentials with `NEXT_PUBLIC_`, commit them, or expose them to browser code.

Cloudflare references: [R2 S3 credentials and endpoint](https://developers.cloudflare.com/r2/get-started/s3/), [R2 API tokens](https://developers.cloudflare.com/r2/api/tokens/), and [bucket CORS](https://developers.cloudflare.com/r2/buckets/cors/).

Relay lists objects directly from the configured bucket in pages of 24. Uploads first use short-lived signed `PUT` URLs; R2 secrets remain on the server. If bucket CORS is not configured, Relay automatically falls back to an authenticated server upload capped at 100 MB. Configure CORS for efficient large-video uploads. Renaming performs an object copy followed by deletion of the old key, and deletion permanently removes the R2 object. `R2_PUBLIC_URL` must serve the bucket objects publicly so previews and social platforms can fetch them.

### Social provider credentials

These values identify your developer applications. They are not the tokens for individual connected accounts.

```env
# Facebook Pages and Instagram through Facebook Business
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=

# Direct Instagram professional-account login
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=

# TikTok calls these the Client Key and Client Secret
TIKTOK_CLIENT_ID=
TIKTOK_CLIENT_SECRET=

# Google OAuth web client for YouTube
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
```

Keep every secret server-side. Never prefix it with `NEXT_PUBLIC_`, commit `.env`, or paste user access/refresh tokens into environment variables. Relay stores connected-account access and refresh credentials encrypted with AES-256-GCM in PostgreSQL; account APIs never return them to the browser.

Every callback is the exact `APP_URL` followed by the path below. `APP_URL`, the URL sent by Relay, and the URL registered in the provider console must match in scheme, host, port, path, case, and trailing-slash behavior. Do not add a query string, fragment, or trailing slash.

For the documented local default, use these values:

| Connection | Provider-console location | Local callback | Production callback |
| --- | --- | --- | --- |
| Facebook Pages | Meta app > Facebook Login for Business > Settings > Valid OAuth Redirect URIs | `http://localhost:3000/api/oauth/facebook/callback` | `https://relay.example.com/api/oauth/facebook/callback` |
| Instagram through a Facebook Page | The same Meta app and valid-redirect list used for Facebook Login for Business | `http://localhost:3000/api/oauth/instagram/callback` | `https://relay.example.com/api/oauth/instagram/callback` |
| Instagram standalone professional account | Meta app > Instagram > API setup with Instagram login > Business Login > Redirect URI | `http://localhost:3000/api/oauth/instagram-standalone/callback` | `https://relay.example.com/api/oauth/instagram-standalone/callback` |
| YouTube | Google Cloud > APIs & Services > Credentials > OAuth 2.0 Web client > Authorized redirect URIs | `http://localhost:3000/api/oauth/youtube/callback` | `https://relay.example.com/api/oauth/youtube/callback` |
| TikTok | TikTok for Developers > your app > Login Kit > Web redirect URI | Use an HTTPS tunnel or test domain, such as `https://relay-dev.example.com/api/oauth/tiktok/callback` | `https://relay.example.com/api/oauth/tiktok/callback` |

Facebook and Facebook-linked Instagram may use the same Meta app. Add both of those callback URLs to that app's valid OAuth redirect URI configuration. The standalone Instagram flow uses `INSTAGRAM_APP_ID` and `INSTAGRAM_APP_SECRET` and its own Instagram Business Login redirect URI.

If Facebook displays **URL Blocked**, open the exact Meta app whose ID is in `FACEBOOK_APP_ID`, then open **Facebook Login for Business → Settings**. Enable **Client OAuth Login** and **Web OAuth Login**, and add both production callback URLs exactly—one ending in `/api/oauth/facebook/callback` and one ending in `/api/oauth/instagram/callback`. In the app's basic settings, add only the hostname (for example `relay.example.com`) under **App Domains**. Saving a callback in a different Meta app, in the standalone Instagram product, or with a trailing slash does not authorize the URL.

For standalone Instagram, open the exact Meta app whose Instagram App ID is in `INSTAGRAM_APP_ID`, then add `/api/oauth/instagram-standalone/callback` under **Instagram → API setup with Instagram login → Business login settings**. This is separate from the Facebook Login valid-redirect list.

Google accepts localhost redirect URIs for testing. TikTok does not accept Relay's HTTP localhost origin: its redirect must be a static absolute HTTPS URL, and the exact same URL must be sent during authorization. For TikTok development, expose Relay through an HTTPS tunnel, change `APP_URL` to that public origin, and recreate the web container.

If you choose another local port, it must be consistent everywhere. For example:

```env
APP_URL=http://localhost:3010
RELAY_PORT=3010
```

The Facebook callback would then be `http://localhost:3010/api/oauth/facebook/callback`, and the same rule applies to the other local callbacks. For TikTok, use the HTTPS tunnel origin as `APP_URL` instead of localhost.

Relay requests the following authorization scopes. Provider review requirements can change, so confirm them in the provider's current documentation when preparing a public application.

| Provider | Requested access |
| --- | --- |
| Facebook Pages | List the user's Pages, read Page metadata/engagement, and publish Page posts (`pages_show_list`, `pages_read_engagement`, `pages_manage_posts`; business access where required) |
| Instagram through Facebook | Read the linked professional account and publish media (`instagram_basic`, `instagram_content_publish`, plus the Page permissions required to find the linked account) |
| Instagram standalone | Professional-account identity and content publishing (`instagram_business_basic`, `instagram_business_content_publish`) |
| TikTok | Basic creator information and direct-post access (`user.info.basic`, `video.publish`, `video.upload`); public posting requires provider approval/audit |
| YouTube | Upload videos and read the connected channel (`https://www.googleapis.com/auth/youtube.upload`, `https://www.googleapis.com/auth/youtube.readonly`) with offline access |

### Keeping accounts connected

The `worker` container checks due credentials every five minutes. Refresh timing is stored per account rather than relying on browser activity:

- Instagram Login renews long-lived tokens before their 60-day expiry.
- Facebook and Facebook-linked Instagram renew the long-lived Meta authorization and rediscover the Page token.
- TikTok refreshes its 24-hour access token and always persists a rotated refresh token returned by TikTok.
- YouTube uses the offline refresh token to renew short-lived access tokens.

Refresh operations use PostgreSQL leases so two worker instances cannot rotate the same credential simultaneously. Temporary provider failures mark an account as needing attention and are retried. Revoked or expired authorization marks it as expired and the dashboard offers a new OAuth connection. Keep the `worker` service running and keep `ENCRYPTION_KEY` unchanged across deployments.

Official references: [Meta Facebook Login manual flow](https://developers.facebook.com/docs/facebook-login/guides/advanced/manual-flow/), [Instagram API with Facebook Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-facebook-login/), [Instagram API with Instagram Login](https://developers.facebook.com/docs/instagram-platform/instagram-api-with-instagram-login/), [TikTok Login Kit redirect requirements](https://developers.tiktok.com/doc/login-kit-web/), and [Google web-server OAuth](https://developers.google.com/identity/protocols/oauth2/web-server). Comparative self-hosting guides: [Postiz Facebook](https://docs.postiz.com/providers/facebook), [Postiz Instagram](https://docs.postiz.com/providers/instagram), [Postiz TikTok](https://docs.postiz.com/providers/tiktok), and [Postiz YouTube](https://docs.postiz.com/providers/youtube).

## Install with Docker

This is the easiest local and self-hosted installation. Docker starts PostgreSQL, runs the database migration, and then starts Relay.

### 1. Install Docker

Install Docker Desktop on macOS/Windows or Docker Engine plus the Compose plugin on Linux. Verify both components:

```bash
docker --version
docker compose version
```

### 2. Configure Relay

```bash
git clone https://github.com/lapreamarcelo/relay.git
cd relay
cp .env.example .env
```

Edit `.env`, replace the four generated values, and add your R2 credentials. A complete local Docker file needs:

```env
APP_URL=http://localhost:3000
RELAY_PORT=3000
POSTGRES_PASSWORD=<random-hex-value>
BETTER_AUTH_SECRET=<different-random-hex-value>
ALLOW_REGISTRATION=true
RELAY_SETUP_TOKEN=<different-random-hex-value>
ENCRYPTION_KEY=<random-base64-value>
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
R2_BUCKET_NAME=relay-media
R2_REGION=auto
R2_ENDPOINT=
R2_PUBLIC_URL=https://media.example.com
```

You do not need `DATABASE_URL`, `APP_SECRET`, `DATABASE_POOL_SIZE`, or social-provider keys to start Relay locally. Docker creates the private database URL and the pool size defaults to `5`. R2 is the fixed media backend.

### 3. Start the stack

```bash
docker compose up -d --build
docker compose ps
```

The expected services are:

- `postgres`: healthy and persistent.
- `migrate`: exits successfully after preparing the database.
- `web`: healthy and available on port 3000.

Open `http://localhost:3000/register`, enter `RELAY_SETUP_TOKEN`, and create the owner.

### 4. Close registration

Change `.env`:

```env
ALLOW_REGISTRATION=false
```

Apply the change:

```bash
docker compose up -d web
```

### Docker operations

```bash
docker compose ps                   # Service status
docker compose logs -f web          # Relay logs
docker compose logs -f postgres     # Database logs
docker compose up -d --build        # Rebuild/update
docker compose down                 # Stop; preserve database data
```

The database is stored in the `relay_postgres_data` volume. Do **not** run `docker compose down -v` unless you intentionally want to delete every account, session, and persisted record.

### Update a Docker installation

To follow the repository's main branch:

```bash
git pull --ff-only
docker compose up -d --build
docker compose ps
```

The migration service runs before the updated web service starts. Keep the `.env` file and `relay_postgres_data` volume; the update command does not delete either one.

## Deploy with Coolify

This is the recommended production installation. Coolify clones Relay's public GitHub repository, builds it from `compose.coolify.yaml`, starts PostgreSQL, runs migrations, and serves Relay through HTTPS. Users do not need to fork the repository, connect a GitHub account, configure GitHub Actions, use a GHCR image, or create a server-side `.env` file.

### 1. Before opening Coolify

You need:

- The public Relay repository URL: `https://github.com/lapreamarcelo/relay`.
- A Coolify server or Coolify Cloud connected to a server.
- An A record such as `relay.example.com` pointing to that server's public IP address.
- For self-hosted Coolify and Relay on the same server: 2 vCPU, 2 GB RAM, 30 GB free disk, and swap enabled. Choose 4 GB RAM if that server also hosts other applications.

### 2. Select the GitHub repository

In Coolify:

1. Create or select a project and production environment.
2. Click **New Resource**.
3. On the source screen, click **Public Repository**.
4. Paste `https://github.com/lapreamarcelo/relay`.
5. Click **Check Repository**.
6. Select the server on which Relay will run.

No GitHub login or repository permission is required. Do not choose **Dockerfile**, **Docker Compose Empty**, or **Docker Image** for this installation.

### 3. Select Docker Compose

On the application configuration screen set:

| Field | Value |
| --- | --- |
| Branch | `main` |
| Build Pack | `Docker Compose` |
| Base Directory | `/` |
| Docker Compose Location | `/compose.coolify.yaml` |

Click **Continue**. Coolify should load three services: `postgres`, `migrate`, and `web`. Only `web` will be public. `migrate` is expected to exit successfully after preparing the database.

### 4. Add environment variables

Open **Environment Variables** after Coolify has loaded the Compose file. Coolify automatically creates the variables referenced by `compose.coolify.yaml`; fill in those existing rows instead of creating or pasting a second set. Keep them runtime-only and disable Preview availability unless you intentionally use preview deployments.

Use the block below only as a value checklist. Do not import it as additional rows when the same names are already visible in Coolify.

If a name appears twice, check its scope before deleting anything:

- **Production + Preview:** keep the Production value and disable Preview availability when preview deployments are not used. Coolify intentionally keeps these scopes separate.
- **Two entries in the same scope:** keep the entry generated from the Compose file and remove the manually added duplicate.

```env
APP_URL=https://relay.example.com
POSTGRES_PASSWORD=<random-hex-value>
BETTER_AUTH_SECRET=<different-random-hex-value>
ENCRYPTION_KEY=<random-base64-value-from-openssl-rand-base64-32>
RELAY_SETUP_TOKEN=<different-private-random-value>
ALLOW_REGISTRATION=true
DATABASE_POOL_SIZE=5
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ACCESS_KEY_ID=<r2-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
R2_BUCKET_NAME=relay-media
R2_REGION=auto
R2_ENDPOINT=
R2_PUBLIC_URL=https://media.example.com
```

Generate `POSTGRES_PASSWORD`, `BETTER_AUTH_SECRET`, and `RELAY_SETUP_TOKEN` separately with `openssl rand -hex 32`. Generate `ENCRYPTION_KEY` with `openssl rand -base64 32`.

Provider credentials are optional if you only want to inspect Relay. Add the credentials for every provider users should be able to connect:

```env
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
TIKTOK_CLIENT_ID=
TIKTOK_CLIENT_SECRET=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
```

Do not set `DATABASE_URL` in Coolify for this Compose deployment; `compose.coolify.yaml` generates the private connection between `web`, `migrate`, and `postgres`.

### 5. Assign the domain

Open the `web` service and enter this in its **Domains** field, replacing the example hostname:

```text
https://relay.example.com:3000
```

The suffix tells Coolify's proxy which internal port to use. Visitors use the normal HTTPS URL without `:3000`.

Do not assign a domain to `postgres` or `migrate`, and do not expose PostgreSQL with a host port.

### 6. Deploy

Click **Deploy** and open **Deployments** to follow the build. A successful deployment has:

- `postgres`: running and healthy.
- `migrate`: completed successfully and stopped.
- `web`: running and healthy.
- `worker`: running. It has no public domain or port.

If the domain shows **No Available Server**, confirm that the `web` domain includes the internal `:3000` suffix and inspect the `web` logs.

### 7. Create the owner and close registration

Visit:

```text
https://relay.example.com/register
```

Create the owner with `RELAY_SETUP_TOKEN`. Immediately change `ALLOW_REGISTRATION=false` in Coolify and redeploy the application.

### 8. Configure social callbacks

Replace `relay.example.com` with the exact domain in `APP_URL`, then register every provider callback from the [Social provider credentials](#social-provider-credentials) table. Production callbacks must use the public HTTPS domain, never the internal `web:3000` hostname or the PostgreSQL hostname.

### 9. Update Relay

When a new Relay version is available, click **Redeploy** in Coolify. Coolify pulls the current `main` branch, rebuilds the services, and applies database migrations before the updated web service starts.

Do not delete the PostgreSQL persistent volume during an update. Back up PostgreSQL before important updates.

### 10. Production checklist

- Keep `APP_URL` equal to the exact HTTPS domain.
- Close registration after creating the owner.
- Configure scheduled PostgreSQL backups; a persistent Docker volume is not a backup.
- Configure R2 before enabling media uploads; Relay does not support local container storage.
- Back up `BETTER_AUTH_SECRET` and `ENCRYPTION_KEY` securely.
- Do not expose the PostgreSQL service to the public internet.
- Monitor Docker build-cache usage and Cloudflare R2 storage usage.
- Register provider redirect URLs exactly as shown above before connecting an account.
- Confirm the `worker` service remains running so connected-account tokens renew automatically.

Coolify references:

- [Docker Compose deployments](https://coolify.io/docs/knowledge-base/docker/compose)
- [Environment variables](https://coolify.io/docs/knowledge-base/environment-variables)
- [Persistent storage](https://coolify.io/docs/knowledge-base/persistent-storage)

## First-owner security model

The initial account requires all of the following:

1. `ALLOW_REGISTRATION=true`.
2. An empty Relay user table.
3. The exact `RELAY_SETUP_TOKEN` supplied through the registration form.

That account becomes `OWNER`. Later accounts become `MEMBER`. When `ALLOW_REGISTRATION=false`, registration is rejected by the server even if someone manually calls the signup API.

Sessions are stored in PostgreSQL, expire after 30 days, and renew daily while active. Production HTTPS deployments use secure, HTTP-only cookies.

## Development commands

```bash
pnpm dev
pnpm typecheck
pnpm test
pnpm build
pnpm start
pnpm db:migrate
```

Keyboard shortcuts in the dashboard:

- `C`: open the composer.
- `⌘ K` / `Ctrl K`: open the command menu.
- `Esc`: close overlays.

## Repository structure

```text
apps/web              Next.js application and API route handlers
apps/worker           Provider token refresh and publishing guards
packages/database     PostgreSQL/Drizzle auth schema and migrations
packages/core         Provider-neutral Relay domain models
packages/providers    Provider manifests and refresh registry
```

## Current implementation status

Available now:

- Email/password registration and login.
- First-owner setup protection and registration switch.
- Persistent PostgreSQL sessions.
- Server-protected dashboard and data APIs.
- Responsive product interface and composer interactions.
- Empty initial workspace with no seeded brands, accounts, posts, calendar events, or media.
- Authenticated, paginated Cloudflare R2 media listing, upload, rename, and delete operations.
- PostgreSQL-backed brand creation and brand listing.
- OAuth start/callback flows for Facebook Pages, Facebook-linked Instagram, standalone Instagram Login, TikTok, and YouTube.
- Encrypted PostgreSQL social-account persistence and disconnect actions.
- Runnable provider-token refresh worker with rotation, warning/expiry state, and concurrency leases.

Still required for real social publishing:

- Provider publishing implementations and the provider app-review approval required for public/direct posting.
- PostgreSQL persistence for posts and schedules.
- A durable publishing queue and publishing worker loop.
- Delivery retries, monitoring, and operational backups.

The code intentionally does not present these unfinished integrations as production-ready.
