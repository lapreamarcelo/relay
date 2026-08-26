"use client";

import { useEffect, useState } from "react";
import {
  ArrowRight, Bot, Braces, Check, ChevronRight, CircleAlert, Clipboard, Code2,
  Copy, ExternalLink, KeyRound, LockKeyhole, Play, ShieldCheck, Terminal, Workflow,
} from "lucide-react";

const sections = [
  ["quick-start", "Quick start"], ["agents", "Connect an agent"], ["commands", "Command guide"],
  ["workflows", "Common workflows"], ["safety", "Safety model"], ["mcp", "CLI or MCP?"],
] as const;

const commandGroups = [
  { name: "Discover", detail: "Read the workspace before making changes.", commands: ["accounts list", "brands list", "folders list", "media list", "posts list"] },
  { name: "Organize", detail: "Manage brands, campaigns, templates, and R2 media.", commands: ["brands create|update|delete", "campaigns create|update|delete", "templates create|delete", "media upload|rename|move|delete", "folders create|rename"] },
  { name: "Create", detail: "Build, render, and schedule social content.", commands: ["posts create|update|delete", "slideshows create|update|render|schedule", "videos create|update|render|schedule|batch"] },
  { name: "Measure", detail: "Retrieve performance and automate reporting.", commands: ["analytics report", "reports list|create|delete", "settings get|set"] },
];

function CodeBlock({ code, label = "Terminal" }: { code: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    } catch { /* Clipboard access can be blocked by the browser; the code remains selectable. */ }
  };
  return <div className="docs-code">
    <header><span><i /><i /><i /></span><b>{label}</b><button onClick={() => void copy()} aria-label={`Copy ${label} commands`}>{copied ? <Check /> : <Copy />}{copied ? "Copied" : "Copy"}</button></header>
    <pre><code>{code}</code></pre>
  </div>;
}

function Step({ number, title, children }: { number: string; title: string; children: React.ReactNode }) {
  return <article className="docs-step"><span>{number}</span><div><h3>{title}</h3>{children}</div></article>;
}

export default function CliDocs({ onOpenApiKeys }: { onOpenApiKeys: () => void }) {
  const [origin, setOrigin] = useState("https://your-relay.example");
  const [installMode, setInstallMode] = useState<"global" | "repository">("global");
  useEffect(() => setOrigin(window.location.origin), []);

  const install = installMode === "global"
    ? `# From a cloned Relay repository\nnpm install --global ./apps/cli\nrelay --help`
    : `corepack enable\npnpm install\npnpm relay -- --help`;

  return <div className="page docs-page page-enter">
    <section className="docs-hero">
      <div className="docs-hero-copy">
        <p className="eyebrow">Relay developer guide · CLI v0.1</p>
        <h2>Give your agent<br />the <em>publishing desk.</em></h2>
        <p>Install one JSON-first command line, connect it with a scoped API key, and let agents work through the same validation, rendering, scheduling, and publishing system as the Relay dashboard.</p>
        <div><a className="primary-button" href="#quick-start"><Play /> Start in 5 minutes</a><a className="docs-text-link" href="#commands">Explore commands <ArrowRight /></a></div>
      </div>
      <div className="docs-terminal-card" aria-label="Relay CLI example">
        <header><span><i /><i /><i /></span><b>relay — zsh</b><em>JSON only</em></header>
        <div>
          <p><span>$</span> relay accounts list <i>--compact</i></p>
          <pre>{`{"data":[\n  {"provider":"instagram",\n   "handle":"@aster.studio",\n   "status":"connected"}\n]}`}</pre>
          <p><span>$</span> relay posts create <i>--data @launch.json</i></p>
          <pre className="success">{`{"data":{"id":"post_9f2",\n "status":"draft"}}`}</pre>
          <div><ShieldCheck /> Ownership checked <i /> Validation passed <i /> Draft saved</div>
        </div>
      </div>
    </section>

    <div className="docs-shell">
      <aside className="docs-toc" aria-label="On this page"><p>On this page</p>{sections.map(([id, label], index) => <a href={`#${id}`} key={id}><span>0{index + 1}</span>{label}</a>)}<div><Terminal /><b>Need the syntax?</b><small>Run <code>relay --help</code> anywhere.</small></div></aside>
      <main className="docs-content">
        <section id="quick-start" className="docs-section">
          <div className="docs-section-head"><span>01</span><div><p className="eyebrow">Quick start</p><h2>From checkout to first request.</h2><p>The CLI is currently distributed with Relay. Clone the repository once, then run it locally or install its executable globally.</p></div></div>
          <div className="docs-install-switch" role="group" aria-label="Installation method"><button className={installMode === "global" ? "active" : ""} onClick={() => setInstallMode("global")}><Terminal /> Global command<small>Use <code>relay</code> anywhere</small></button><button className={installMode === "repository" ? "active" : ""} onClick={() => setInstallMode("repository")}><Code2 /> Repository-local<small>Use <code>pnpm relay --</code></small></button></div>
          <Step number="1" title="Install the command"><p>Relay requires Node.js 22. The repository workspace uses pnpm 11.</p><CodeBlock code={install} label={installMode === "global" ? "Global install" : "Repository install"} />{installMode === "global" && <p className="docs-note"><CircleAlert /> This installs the checked-out package. <code>@relay/cli</code> is not yet published to npm.</p>}</Step>
          <Step number="2" title="Create an API key"><p>Open <button className="docs-inline-action" onClick={onOpenApiKeys}>Settings → API keys</button>, name the key for the agent or automation, and copy the secret when it appears. Relay shows it once.</p><div className="docs-key-card"><KeyRound /><div><b>Keep the key in the agent environment</b><small>Never paste it into a prompt, command argument, source file, or committed configuration.</small></div><button onClick={onOpenApiKeys}>Open Settings <ChevronRight /></button></div></Step>
          <Step number="3" title="Configure and verify"><p>Set the Relay origin and secret in the shell that launches the agent. Start with read-only discovery commands.</p><CodeBlock label="Environment & connection check" code={`export RELAY_URL="${origin}"\nexport RELAY_API_KEY="relay_sk_..."\n\nrelay health check\nrelay accounts list\nrelay folders list`} /></Step>
        </section>

        <section id="agents" className="docs-section">
          <div className="docs-section-head"><span>02</span><div><p className="eyebrow">Connect an agent</p><h2>The CLI is the hands. The skill is the judgment.</h2><p>The executable provides access; Relay’s skill teaches a compatible agent which commands exist, where request schemas live, and when publishing actions require explicit approval.</p></div></div>
          <div className="docs-two-up">
            <article className="docs-agent-card"><span><Bot /></span><p className="eyebrow">Inside this checkout</p><h3>Automatic discovery</h3><p>Codex discovers <code>.agents/skills/relay-cli</code> while working in the Relay repository. Invoke it explicitly when useful:</p><CodeBlock label="Agent prompt" code={`$relay-cli list my connected destinations and media folders.\n\n$relay-cli create a draft from video <id>; do not publish it.`} /></article>
            <article className="docs-agent-card"><span><Clipboard /></span><p className="eyebrow">From another project</p><h3>Install the skill</h3><p>Copy the complete skill folder into the agent’s skills directory. Keep its workflow references together.</p><CodeBlock label="Codex skill install" code={`mkdir -p ~/.codex/skills\ncp -R .agents/skills/relay-cli ~/.codex/skills/relay-cli`} /><small>If you set a custom <code>$CODEX_HOME</code>, use its <code>skills</code> directory instead. Other agents use their own instruction or skills conventions.</small></article>
          </div>
          <div className="docs-flow" aria-label="Relay CLI architecture"><span><Bot /><b>Agent</b><small>plans the task</small></span><ChevronRight /><span><Terminal /><b>Relay CLI</b><small>sends JSON</small></span><ChevronRight /><span><Braces /><b>REST API</b><small>validates ownership</small></span><ChevronRight /><span><Workflow /><b>Worker</b><small>renders & publishes</small></span></div>
        </section>

        <section id="commands" className="docs-section">
          <div className="docs-section-head"><span>03</span><div><p className="eyebrow">Command guide</p><h2>One predictable grammar.</h2><p>Every successful command writes JSON to stdout. Errors write a JSON error to stderr and exit nonzero, so agents and CI can respond reliably.</p></div></div>
          <CodeBlock label="CLI grammar" code={`relay <resource> <action> [--data JSON|@file|-] [--id ID] [--query key=value]\nrelay media upload --file PATH [--project ID] [--kind media|music]\nrelay request METHOD /api/path [--data JSON|@file|-] [--query key=value]`} />
          <div className="docs-command-grid">{commandGroups.map((group, index) => <article key={group.name}><header><span>0{index + 1}</span><div><h3>{group.name}</h3><p>{group.detail}</p></div></header><div>{group.commands.map((command) => <code key={command}>relay {command}</code>)}</div></article>)}</div>
          <div className="docs-callout"><Braces /><div><b>New endpoint? No CLI release required.</b><p>The raw request command is an escape hatch for any API path: <code>relay request GET /api/v1/posts</code>. Credentials are sent only to the configured Relay origin.</p></div></div>
        </section>

        <section id="workflows" className="docs-section">
          <div className="docs-section-head"><span>04</span><div><p className="eyebrow">Common workflows</p><h2>Useful patterns, ready to copy.</h2></div></div>
          <div className="docs-recipes">
            <details open><summary><span><b>01</b> Create a safe draft</span><ChevronRight /></summary><div><p>Use a stable <code>clientRequestId</code> so retries return the same post instead of creating a duplicate.</p><CodeBlock label="post.json" code={`{\n  "clientRequestId": "launch-42-instagram",\n  "text": "The launch caption",\n  "mediaType": "image",\n  "mediaUrl": "https://media.example/launch.jpg",\n  "status": "draft",\n  "targets": [{\n    "accountId": "account-id",\n    "settings": { "kind": "instagram", "publishType": "feed" }\n  }]\n}`} /><CodeBlock code="relay posts create --data @post.json" /></div></details>
            <details><summary><span><b>02</b> Upload media to Relay</span><ChevronRight /></summary><div><p>The CLI obtains a short-lived signed URL, then streams the file directly to R2.</p><CodeBlock code={`relay folders list\nrelay media upload --file ./clip.mp4 --project folder-id\nrelay media list --query project=folder-id`} /></div></details>
            <details><summary><span><b>03</b> Render, then schedule</span><ChevronRight /></summary><div><p>Creative scheduling renders the saved project first and creates a post from the immutable artifact.</p><CodeBlock code={`relay videos get --id video-id\nrelay videos render --id video-id\nrelay videos schedule --data @schedule-video.json`} /></div></details>
            <details><summary><span><b>04</b> Pull an analytics report</span><ChevronRight /></summary><div><CodeBlock code={`relay analytics report \\\n  --query from=2026-08-01T00:00:00Z \\\n  --query to=2026-08-31T23:59:59Z \\\n  --query provider=instagram`} /></div></details>
          </div>
        </section>

        <section id="safety" className="docs-section">
          <div className="docs-section-head"><span>05</span><div><p className="eyebrow">Safety model</p><h2>Publishing is an external action.</h2><p>The API applies the same ownership and validation rules as the dashboard. The agent still needs clear operating boundaries.</p></div></div>
          <div className="docs-safety-grid"><article><LockKeyhole /><h3>Secrets stay outside prompts</h3><p>Pass the key through the environment. Keys cannot manage users, OAuth connections, provider credentials, or API keys.</p></article><article><ShieldCheck /><h3>Discover before mutation</h3><p>Use only account, brand, folder, media, and project IDs returned by the current Relay workspace.</p></article><article><CircleAlert /><h3>Draft unless timing is explicit</h3><p><code>status: "publishing"</code> and <code>scheduledAt: null</code> trigger immediate external publishing.</p></article><article><Workflow /><h3>Respect partial success</h3><p>HTTP 207 can contain successful and failed items. Retry only failures with their original idempotency keys.</p></article></div>
        </section>

        <section id="mcp" className="docs-section docs-mcp-section">
          <div className="docs-section-head"><span>06</span><div><p className="eyebrow">CLI or MCP?</p><h2>Start with CLI. Add MCP when the client requires it.</h2></div></div>
          <div className="docs-compare"><article className="recommended"><header><Terminal /><span><b>Relay CLI</b><em>Recommended</em></span></header><ul><li>Complete API coverage</li><li>Works with any shell-capable agent</li><li>Direct uploads and raw API access</li><li>Equally useful in scripts and CI</li></ul></article><article><header><Workflow /><span><b>MCP adapter</b><em>Optional</em></span></header><ul><li>Native tool discovery in MCP clients</li><li>Smaller curated tool surface</li><li>Requires a local checkout and client configuration</li><li>Uses the same API and worker underneath</li></ul></article></div>
          <details className="docs-mcp-config"><summary><span><Code2 /> Show local stdio MCP configuration</span><ChevronRight /></summary><div><CodeBlock label="mcp.json" code={`{\n  "mcpServers": {\n    "relay": {\n      "command": "pnpm",\n      "args": ["--dir", "/absolute/path/to/relay", "--filter", "@relay/mcp", "start"],\n      "env": {\n        "RELAY_URL": "${origin}",\n        "RELAY_API_KEY": "relay_sk_..."\n      }\n    }\n  }\n}`} /></div></details>
          <footer><ShieldCheck /><div><b>One source of truth</b><p>Dashboard, CLI, direct REST calls, and MCP all converge on Relay’s API. Publishing logic and credentials never need to be duplicated in an agent.</p></div><a href="#quick-start">Install the CLI <ExternalLink /></a></footer>
        </section>
      </main>
    </div>
  </div>;
}
