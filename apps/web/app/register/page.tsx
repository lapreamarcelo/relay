"use client";

import Link from "next/link";
import { FormEvent, useEffect, useState } from "react";

type RegistrationStatus = { allowed: boolean; requiresSetupToken: boolean; hasUsers: boolean };

function readError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "We could not create the account.";
  const value = payload as { message?: string; error?: { message?: string } | string };
  if (typeof value.error === "string") return value.error;
  return value.message ?? value.error?.message ?? "We could not create the account.";
}

export default function RegisterPage() {
  const [status, setStatus] = useState<RegistrationStatus | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [setupToken, setSetupToken] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    fetch("/api/v1/auth/registration-status", { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json();
        if (!response.ok) throw new Error(readError(payload));
        setStatus(payload);
      })
      .catch((reason) => setError(reason instanceof Error ? reason.message : "Relay cannot reach its database."));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(status?.requiresSetupToken ? { "x-relay-setup-token": setupToken } : {}),
        },
        body: JSON.stringify({ name, email, password }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(payload));
      window.location.assign("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not create the account.");
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-intro">
      <Link className="auth-wordmark" href="/"><span className="relay-glyph"><i /><i /></span>Relay</Link>
      <div><p className="eyebrow">Private by default</p><h1>Set up your Relay.</h1><p>The first account becomes the owner. Afterward, close registration in your environment.</p></div>
      <small>Passwords are protected with Argon2id. Sessions are stored in PostgreSQL.</small>
    </section>
    <section className="auth-panel">
      <form className="auth-card" onSubmit={submit}>
        <header><p className="eyebrow">Create account</p><h2>{status?.requiresSetupToken ? "Create the owner" : "Join this Relay"}</h2><p>Use at least 12 characters for your password.</p></header>
        {!status && !error && <p className="auth-loading">Checking registration…</p>}
        {status && !status.allowed ? <div className="auth-closed"><h3>Registration is closed</h3><p>The owner disabled new accounts for this instance.</p><Link href="/login">Return to sign in</Link></div> : <>
          <label htmlFor="name">Full name</label>
          <input id="name" name="name" autoComplete="name" required value={name} onChange={(event) => setName(event.target.value)} />
          <label htmlFor="email">Email address</label>
          <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" minLength={12} maxLength={128} autoComplete="new-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
          {status?.requiresSetupToken && <><label htmlFor="setup-token">Private setup token</label><input id="setup-token" name="setup-token" type="password" autoComplete="off" required value={setupToken} onChange={(event) => setSetupToken(event.target.value)} /><p className="auth-hint">This is the RELAY_SETUP_TOKEN from your server environment.</p></>}
          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="auth-submit" disabled={busy || !status}>{busy ? "Creating account…" : "Create account"}</button>
          <p className="auth-switch">Already have an account? <Link href="/login">Sign in</Link></p>
        </>}
      </form>
    </section>
  </main>;
}
