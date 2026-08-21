"use client";

import Link from "next/link";
import { FormEvent, useState } from "react";

function readError(payload: unknown): string {
  if (!payload || typeof payload !== "object") return "We could not sign you in.";
  const value = payload as { message?: string; error?: { message?: string } };
  return value.message ?? value.error?.message ?? "Email or password is incorrect.";
}

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");

    try {
      const response = await fetch("/api/auth/sign-in/email", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
      });
      const payload = await response.json().catch(() => null);
      if (!response.ok) throw new Error(readError(payload));

      window.location.assign("/");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "We could not sign you in.");
      setBusy(false);
    }
  }

  return <main className="auth-page">
    <section className="auth-intro">
      <Link className="auth-wordmark" href="/"><span className="relay-glyph"><i /><i /></span>Relay</Link>
      <div><p className="eyebrow">Your publishing control room</p><h1>Welcome back.</h1><p>One secure session for every brand, social account, and scheduled post.</p></div>
      <small>Self-hosted. Your accounts and tokens stay in your database.</small>
    </section>
    <section className="auth-panel">
      <form className="auth-card" onSubmit={submit}>
        <header><p className="eyebrow">Sign in</p><h2>Continue to Relay</h2><p>Your session stays active for 30 days and renews while you use Relay.</p></header>
        <label htmlFor="email">Email address</label>
        <input id="email" name="email" type="email" autoComplete="email" required value={email} onChange={(event) => setEmail(event.target.value)} />
        <label htmlFor="password">Password</label>
        <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(event) => setPassword(event.target.value)} />
        {error && <p className="auth-error" role="alert">{error}</p>}
        <button className="auth-submit" disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
        <p className="auth-switch">Setting up a new instance? <Link href="/register">Create the owner account</Link></p>
      </form>
    </section>
  </main>;
}
