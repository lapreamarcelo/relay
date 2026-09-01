# Self-host Relay

Relay runs as four containers: the Next.js web application, a publishing and analytics worker, a one-shot database migrator, and PostgreSQL. Media is stored outside the stack in Cloudflare R2.

This guide covers:

- [Local installation with Docker Compose](#local-installation-with-docker-compose)
- [Production deployment with Coolify](#production-deployment-with-coolify)
- [Upgrades and backups](#upgrades-and-backups)

After Relay is running, follow [Social app setup](SOCIAL_APP_SETUP.md) to connect Facebook, Instagram, TikTok, or YouTube.

## Prerequisites

For a local installation, install:

- Git
- Docker Engine with Docker Compose v2, or Docker Desktop
- OpenSSL for generating secrets

For a production deployment, also prepare:

- a server with [Coolify](https://coolify.io/docs/get-started/introduction) installed
- a domain whose DNS points to the Coolify server
- an HTTPS public URL for Relay

Relay uses [Cloudflare R2](https://developers.cloudflare.com/r2/get-started/) for uploaded and generated media in both environments. Create a bucket and an R2 API token with object read/write access to that bucket. You need:

| Relay variable | Cloudflare value |
| --- | --- |
| `R2_ACCOUNT_ID` | Cloudflare account ID |
| `R2_ACCESS_KEY_ID` | R2 API token access key ID |
| `R2_SECRET_ACCESS_KEY` | R2 API token secret access key |
| `R2_BUCKET_NAME` | Bucket name, such as `relay-media` |
| `R2_PUBLIC_URL` | HTTPS custom domain or public development URL for the bucket |

`R2_PUBLIC_URL` must be reachable by the social networks. A private URL or one protected by Cloudflare Access will prevent providers from fetching image media. A custom domain is recommended for production. Relay derives the S3 endpoint from the account ID; set `R2_ENDPOINT` only when an override is necessary.

## Local installation with Docker Compose

### 1. Clone and configure Relay

```bash
git clone https://github.com/lapreamarcelo/relay.git
cd relay
cp .env.example .env
```

Generate a different value for each hexadecimal secret:

```bash
openssl rand -hex 32
openssl rand -hex 32
openssl rand -hex 32
openssl rand -base64 32
```

Open `.env` and assign the output in order to:

```dotenv
APP_URL=http://localhost:3000
RELAY_PORT=3000
POSTGRES_PASSWORD=<first hex value>
BETTER_AUTH_SECRET=<second hex value>
RELAY_SETUP_TOKEN=<third hex value>
ENCRYPTION_KEY=<base64 value>
ALLOW_REGISTRATION=true

R2_ACCOUNT_ID=<cloudflare account ID>
R2_ACCESS_KEY_ID=<R2 access key ID>
R2_SECRET_ACCESS_KEY=<R2 secret access key>
R2_BUCKET_NAME=relay-media
R2_REGION=auto
R2_PUBLIC_URL=https://media.example.com
```

Use a hexadecimal `POSTGRES_PASSWORD` as shown above. It is inserted into the internal PostgreSQL connection URL, so punctuation that has special meaning in a URL would need percent-encoding.

Provider credentials are optional at this stage. Add only the networks you plan to connect after completing [Social app setup](SOCIAL_APP_SETUP.md).

### 2. Start the stack

```bash
docker compose up -d --build
docker compose ps
```

The first build can take several minutes. The `migrate` container exits successfully after applying the database migrations; this is expected. The `web`, `worker`, and `postgres` services should remain running.

If a service does not start, inspect its logs:

```bash
docker compose logs --tail=200 web worker migrate postgres
```

### 3. Create the owner account

Open [http://localhost:3000/register](http://localhost:3000/register). Enter the `RELAY_SETUP_TOKEN` from `.env` and create the owner account.

After the owner exists, change this setting and recreate the web container:

```dotenv
ALLOW_REGISTRATION=false
```

```bash
docker compose up -d
```

Registration is now closed. Keep the setup token secret even though it is no longer accepted while registration is disabled.

### 4. Verify Relay

The shallow health endpoint verifies that the web process is responding:

```bash
curl --fail http://localhost:3000/health
```

The deep check also verifies PostgreSQL and a recent worker heartbeat:

```bash
curl --fail "http://localhost:3000/health?deep=1"
```

### Local OAuth callbacks

`APP_URL` is the origin Relay uses to build OAuth callbacks. If you change the port or use a tunnel, change `APP_URL`, restart `web` and `worker`, and update every callback in the provider consoles.

YouTube supports a localhost callback for development. Meta and TikTok configurations may require a public HTTPS domain or additional development-mode setup. A stable HTTPS development hostname is the most reliable way to test every provider.

## Production deployment with Coolify

Relay includes `compose.coolify.yaml`, which defines persistent PostgreSQL storage, migrations, health checks, the web application, and the worker.

### 1. Create the resource

1. In Coolify, open the target project and environment and select **New resource**.
2. Choose the public repository, GitHub App, or deploy-key source for Relay.
3. Select **Docker Compose** as the build pack.
4. Set the base directory to the repository root and the Compose location to `compose.coolify.yaml`.
5. Save so Coolify parses the services and environment variables.

Do not use the root `Dockerfile` as a single-service deployment: Relay also needs PostgreSQL, migrations, and the worker from the Compose definition.

### 2. Configure the public web service

Assign the Relay domain only to the `web` service. It listens on internal port `3000`, so enter a Coolify service domain such as:

```text
https://relay.example.com:3000
```

The `:3000` suffix tells Coolify which container port to proxy; users still visit the normal HTTPS URL. Set `APP_URL` without that internal port suffix and without a trailing slash:

```dotenv
APP_URL=https://relay.example.com
```

Do not expose `postgres`, `migrate`, or `worker` publicly.

### 3. Set environment variables

Coolify detects variables referenced by `compose.coolify.yaml`. Set these before the first deployment:

```dotenv
APP_URL=https://relay.example.com
POSTGRES_PASSWORD=<random hex value>
BETTER_AUTH_SECRET=<random hex value, at least 32 characters>
RELAY_SETUP_TOKEN=<private random value, at least 24 characters>
ENCRYPTION_KEY=<base64-encoded 32-byte key>
ALLOW_REGISTRATION=true

R2_ACCOUNT_ID=<cloudflare account ID>
R2_ACCESS_KEY_ID=<R2 access key ID>
R2_SECRET_ACCESS_KEY=<R2 secret access key>
R2_BUCKET_NAME=relay-media
R2_REGION=auto
R2_PUBLIC_URL=https://media.example.com
```

Generate secrets locally with `openssl rand -hex 32` and `openssl rand -base64 32`. Never reuse `POSTGRES_PASSWORD` as an application secret.

Add the applicable social credentials from [Social app setup](SOCIAL_APP_SETUP.md):

```dotenv
FACEBOOK_APP_ID=
FACEBOOK_APP_SECRET=
INSTAGRAM_APP_ID=
INSTAGRAM_APP_SECRET=
TIKTOK_CLIENT_ID=
TIKTOK_CLIENT_SECRET=
YOUTUBE_CLIENT_ID=
YOUTUBE_CLIENT_SECRET=
```

Leave an unused provider pair empty. Keep every secret available at runtime and out of build logs.

### 4. Deploy and create the owner

Deploy the resource. The expected startup sequence is:

1. `postgres` becomes healthy.
2. `migrate` applies migrations and exits with status 0.
3. `web` and `worker` start.
4. `web` becomes healthy at `/health`.

Open `https://relay.example.com/register`, enter `RELAY_SETUP_TOKEN`, and create the owner. Then set `ALLOW_REGISTRATION=false` and redeploy immediately. Relay requires registration to be enabled for the initial owner setup; the setup token protects that first registration.

Verify both endpoints after the worker has had time to report its heartbeat:

```bash
curl --fail https://relay.example.com/health
curl --fail "https://relay.example.com/health?deep=1"
```

### 5. Register OAuth callbacks

Provider callbacks are exact-string matches. Register the callbacks for each enabled connection method using the same origin as `APP_URL`:

| Connection | Production callback |
| --- | --- |
| Facebook Pages | `https://relay.example.com/api/oauth/facebook/callback` |
| Instagram via Facebook | `https://relay.example.com/api/oauth/instagram/callback` |
| Instagram Login | `https://relay.example.com/api/oauth/instagram-standalone/callback` |
| TikTok | `https://relay.example.com/api/oauth/tiktok/callback` |
| YouTube | `https://relay.example.com/api/oauth/youtube/callback` |

Do not add a trailing slash. See [Social app setup](SOCIAL_APP_SETUP.md) for the corresponding console configuration and permissions.

## Upgrades and backups

### Upgrade a local Compose installation

Back up PostgreSQL first, then rebuild from the new revision:

```bash
git pull --ff-only
docker compose up -d --build
docker compose ps
```

The one-shot migrator runs before the updated web and worker services start.

For Coolify, deploy the desired commit through the normal deployment flow. Configure automatic database backups for the PostgreSQL service or its `relay_postgres_data` volume before enabling automatic deployments.

### Back up local PostgreSQL

Create a logical backup without stopping Relay:

```bash
docker compose exec -T postgres pg_dump -U relay -d relay -Fc > relay.dump
```

Store the dump, the contents of the R2 bucket, and the deployment secrets in separate protected locations. In particular, never lose or rotate `ENCRYPTION_KEY` casually: existing provider tokens cannot be decrypted without the original key.

## Troubleshooting

### OAuth reports a redirect mismatch

Confirm that `APP_URL` and the provider callback use the same scheme, hostname, port, path, and trailing-slash behavior. Restart `web` and `worker` after changing `APP_URL`.

### Uploads work but publishing fails

Open one media URL based on `R2_PUBLIC_URL` in a private browser window. It must be publicly reachable over HTTPS, without a login, expiring query string, or access challenge.

### The deep health check is degraded

Inspect the worker logs. The deep endpoint returns a failure when the database is unavailable or the primary worker heartbeat is more than two minutes old.

### Coolify shows “No available server”

Confirm that the domain is attached to `web`, targets internal port `3000`, and that the Compose health check passes. The `migrate` service is intentionally marked `exclude_from_hc` because it exits after completing its one-time job.
