# Relay

**The open-source social publishing workspace for people and agents.**

Plan once, publish across Instagram, Facebook, TikTok, and YouTube, then see what resonated without hopping between dashboards.

![Relay cross-platform analytics dashboard](docs/images/relay-analytics.png)

## What Relay does

- Composes, schedules, and publishes one post or a whole campaign.
- Builds reusable 9:16 photo slideshows from R2 images, with optional per-slide text, bulk title generation, ordered JPEG rendering, and multi-platform publishing through the shared composer.
- Connects Instagram, Facebook Pages, TikTok, and YouTube through OAuth.
- Tracks views, likes, comments, shares, saves, reach, and watch metrics when the platform exposes them.
- Gives AI agents a scoped REST API with idempotent bulk operations.
- Stores media in Cloudflare R2 and provider credentials encrypted in PostgreSQL.
- Runs publishing, token refresh, and analytics collection in a durable background worker.

<table>
  <tr>
    <td width="50%"><img src="docs/images/relay-dashboard.png" alt="Relay workspace overview" /></td>
    <td width="50%"><img src="docs/images/relay-composer.png" alt="Relay cross-platform post composer" /></td>
  </tr>
</table>

## Quick start

Relay ships as a Docker Compose stack with the web app, worker, migrations, and PostgreSQL.

```bash
git clone https://github.com/lapreamarcelo/relay.git
cd relay
cp .env.example .env
docker compose up -d --build
```

Before starting, set the generated secrets and Cloudflare R2 credentials in `.env`. Then open [http://localhost:3000/register](http://localhost:3000/register), enter `RELAY_SETUP_TOKEN`, and create the owner account.

Generate the application secrets with:

```bash
openssl rand -hex 32      # POSTGRES_PASSWORD, BETTER_AUTH_SECRET, RELAY_SETUP_TOKEN
openssl rand -base64 32   # ENCRYPTION_KEY — keep this stable
```

The minimum configuration is documented in [`.env.example`](.env.example). Add provider app credentials only for the networks you want to connect.

## Publishing and analytics

| Platform | Publishing | Analytics collected |
| --- | --- | --- |
| Instagram | Feed, Reel, Story | Views, reach, likes, comments, shares, saves, watch time |
| Facebook Pages | Feed, Reel | Views when available, reactions, comments, shares |
| TikTok | Video with creator-aware privacy controls | Views, likes, comments, shares |
| YouTube | Resumable video upload | Views, likes, comments |

Metrics are saved as timestamped snapshots, so Relay can show both the latest totals and historical changes. The worker checks new posts frequently, then reduces polling as posts age.

Provider permissions and review rules still apply. After upgrading an existing Relay installation, reconnect social accounts so the new analytics scopes are granted.

## Agent API

Create a scoped key under **Settings → API keys**, then let an agent discover accounts and media, build or bulk-generate videos and slideshows, schedule up to 100 posts at once, reschedule, publish immediately, delete, or retrieve analytics history. The MCP adapter exposes these workflows directly; the same REST endpoints can be called from a shell with `curl` or any HTTP client.

```bash
curl "$RELAY_URL/api/v1/analytics?postId=$POST_ID" \
  -H "Authorization: Bearer $RELAY_API_KEY"
```

Every automated create request supports a stable `clientRequestId`, making retries safe. See the complete [Agent API guide](docs/AGENT_API.md).

Relay includes a runnable stdio MCP adapter with media discovery, per-image slideshow text, rendering, and TikTok scheduling tools while keeping authorization and scheduling logic in one place.

## Architecture

```text
Browser / Agent
      │
      ▼
Next.js web + REST API ───── Cloudflare R2
      │
      ▼
PostgreSQL ◀──────── Publishing & analytics worker
                         │
                         ▼
              Social platform APIs
```

This is a pnpm monorepo:

- `apps/web` — Next.js dashboard and API
- `apps/worker` — publishing, credential refresh, and analytics jobs
- `packages/core` — shared domain types
- `packages/database` — PostgreSQL schema and migrations
- `packages/providers` — OAuth, publishing, and analytics adapters

For local development:

```bash
pnpm install
pnpm db:migrate
pnpm dev
```

## Deployment notes

- Production deployments can use `compose.coolify.yaml`; migrations run automatically.
- `APP_URL` must exactly match each provider's registered OAuth callback origin.
- `R2_PUBLIC_URL` must be HTTPS and reachable by the social platforms.
- `R2_RESOLVED_IP` is an optional emergency override for a failing DNS-selected R2 edge; leave it empty normally and only use a trusted Cloudflare IP.
- Keep `ENCRYPTION_KEY` unchanged or existing connected-account tokens cannot be decrypted.
- Close public signup with `ALLOW_REGISTRATION=false` after creating the owner.

## Contributing

Issues and pull requests are welcome. If you add a provider, keep its OAuth, publishing, analytics normalization, and tests together in `packages/providers`.

Relay is under active development. Public posting and analytics availability depend on the permissions approved for your provider applications.
