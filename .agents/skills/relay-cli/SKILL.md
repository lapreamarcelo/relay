---
name: relay-cli
description: Operate a Relay social-publishing workspace through its first-party CLI when an agent needs to inspect media or destinations, edit creative projects, schedule or publish posts, run bulk workflows, or retrieve analytics.
---

# Relay CLI

Use Relay's CLI as the primary agent interface. It is a thin client over the same REST API and worker as the dashboard; do not reproduce publishing logic locally or use the MCP adapter unless the user specifically requests MCP.

## Before operating

- Run commands from the Relay repository as `pnpm relay -- ...`.
- Require `RELAY_URL` and `RELAY_API_KEY` in the environment. If either is missing, ask the user to create a key under **Settings → API keys** and export it. Never ask them to paste the secret into a prompt or commit it.
- Start with read commands such as `accounts list`, `brands list`, `folders list`, and `media list`. Use only IDs returned by this Relay workspace.
- Read [the CLI guide](../../../docs/CLI.md) for command syntax. Read [the Agent API guide](../../../docs/AGENT_API.md) when constructing post, slideshow, video, batch, or analytics JSON.

## Mutation rules

- Treat `status: "publishing"` and `scheduledAt: null` as immediate external publishing. Use them only when the user explicitly wants to publish now.
- For automated post creation, choose and reuse a stable `clientRequestId`; retries with the same ID are idempotent.
- Prefer `draft` when content or timing is not final. Do not infer permission to delete posts/media/projects, change publishing defaults, or start a bulk run.
- Inspect partial-success responses. HTTP 207 results can contain successful and failed entries; do not retry successful entries.
- Existing posts and templates retain their explicit platform settings. Publishing defaults apply only when the workflow omits an explicit value or when Relay's batch endpoint documents that it uses defaults.
- OAuth connections, API-key creation, provider credentials, user administration, and connected-account deletion remain browser-only.

## Creative workflows

The CLI can set every persisted field used by Relay's slideshow and video editors. It cannot reproduce the browser's drag interaction; express positions, dimensions, fonts, colors, fit, music, and labels in project JSON, then retrieve the saved project to verify the normalized values.

Read [references/workflows.md](references/workflows.md) only when executing a slideshow, video, bulk, or analytics workflow.

All CLI output is JSON. Keep intermediate JSON machine-readable, surface Relay validation errors faithfully, and report created project/post IDs plus final schedule or publishing state to the user.
