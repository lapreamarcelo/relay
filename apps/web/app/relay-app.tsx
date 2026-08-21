"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight,
  CircleAlert, Clock3, Cloud, Command, Database, File as FileIcon, FileText, Grid2X2, Home, Image as ImageIcon,
  Instagram, KeyRound, LayoutGrid, List, LoaderCircle, LogOut, Menu, Moon, MoreHorizontal, Pencil, Plus, RefreshCw, Search,
  Send, Settings, ShieldCheck, Sparkles, Sun, Trash2, Upload, Users, Video, X, Youtube, Zap,
} from "lucide-react";
import { initialPosts, type Brand, type ProviderId, type ProviderPostSettings, type RelayPost, type SocialAccount, type PostStatus } from "@relay/core";
import { providerRegistry } from "@relay/providers";

type View = "home" | "calendar" | "posts" | "media" | "brands" | "accounts" | "settings";
const BrandsContext = createContext<Brand[]>([]);
const useBrands = () => useContext(BrandsContext);
const AccountsContext = createContext<SocialAccount[]>([]);
const useAccounts = () => useContext(AccountsContext);

const viewLabel: Record<View, string> = { home: "Home", calendar: "Calendar", posts: "Posts", media: "Media", brands: "Brands", accounts: "Accounts", settings: "Settings" };
const navItems: { id: View; icon: typeof Home }[] = [
  { id: "home", icon: Home }, { id: "calendar", icon: CalendarDays }, { id: "posts", icon: FileText }, { id: "media", icon: ImageIcon },
  { id: "brands", icon: LayoutGrid }, { id: "accounts", icon: Users }, { id: "settings", icon: Settings },
];

function BrandMark({ brandId, size = "normal" }: { brandId: string; size?: "small" | "normal" | "large" }) {
  const brands = useBrands();
  const brand = brands.find((item) => item.id === brandId);
  if (!brand) return <span className={`brand-mark ${size}`}>R</span>;
  return <span className={`brand-mark ${size}`} style={{ "--brand": brand.color } as React.CSSProperties}>{brand.monogram}</span>;
}

function ProviderIcon({ id, selected }: { id: ProviderId; selected?: boolean }) {
  const manifest = providerRegistry.get(id);
  const className = `provider-icon provider-${id} ${selected ? "selected" : ""}`;
  if (id === "instagram") return <span className={className} aria-hidden="true" style={{ "--provider": manifest.color } as React.CSSProperties}><Instagram /></span>;
  if (id === "youtube") return <span className={className} aria-hidden="true" style={{ "--provider": manifest.color } as React.CSSProperties}><Youtube /></span>;
  return <span className={`${className} text`} aria-hidden="true" style={{ "--provider": manifest.color } as React.CSSProperties}>{manifest.shortName}</span>;
}

function Status({ value }: { value: PostStatus | "connected" | "warning" | "expired" }) {
  const labels: Record<string, string> = { draft: "Draft", scheduled: "Scheduled", published: "Published", failed: "Failed", connected: "Connected", warning: "Attention", expired: "Expired" };
  return <span className={`status ${value}`}><span />{labels[value]}</span>;
}

function Topbar({ view, onCompose, onCommand, onMenu }: { view: View; onCompose: () => void; onCommand: () => void; onMenu: () => void }) {
  return <header className="topbar">
    <button className="icon-button mobile-only" aria-label="Open menu" onClick={onMenu}><Menu /></button>
    <div><p className="eyebrow">Personal workspace</p><h1>{viewLabel[view]}</h1></div>
    <div className="top-actions">
      <button className="command-trigger" onClick={onCommand}><Search /><span>Search Relay</span><kbd>⌘ K</kbd></button>
      <button className="primary-button" onClick={onCompose}><Plus /> Create post</button>
    </div>
  </header>;
}

function Sidebar({ active, onChange, mobileOpen, onClose, user, onLogout }: { active: View; onChange: (view: View) => void; mobileOpen: boolean; onClose: () => void; user: { name: string; role: string }; onLogout: () => void }) {
  const accounts = useAccounts();
  return <>
    {mobileOpen && <button className="scrim" onClick={onClose} aria-label="Close menu" />}
    <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
      <div className="wordmark"><span className="relay-glyph"><i /><i /></span>Relay<button className="icon-button sidebar-close" onClick={onClose}><X /></button></div>
      <nav aria-label="Main navigation">
        {navItems.map((item, index) => {
          const Icon = item.icon;
          return <div key={item.id} className={index === 4 || index === 6 ? "nav-separator" : ""}>
            <button className={active === item.id ? "active" : ""} onClick={() => { onChange(item.id); onClose(); }}><Icon /><span>{viewLabel[item.id]}</span>{item.id === "accounts" && accounts.length > 0 && <em>{accounts.length}</em>}</button>
          </div>;
        })}
      </nav>
      <div className="sidebar-bottom">
        <button className="workspace-switch"><span className="workspace-avatar">R</span><span><b>Relay</b><small>Personal workspace</small></span><MoreHorizontal /></button>
        <button className="account-row" onClick={onLogout} title="Sign out"><span className="avatar">{user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span><b>{user.name}</b><small>{user.role === "OWNER" ? "Owner · Sign out" : "Member · Sign out"}</small></span><ChevronDown /></button>
      </div>
    </aside>
  </>;
}

function HomeView({ posts, onCompose, go, userName }: { posts: RelayPost[]; onCompose: () => void; go: (v: View) => void; userName: string }) {
  const brands = useBrands();
  const accounts = useAccounts();
  const scheduled = posts
    .filter((post) => post.status === "scheduled")
    .sort((a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime());
  const upcoming = scheduled.slice(0, 4);
  const healthyAccounts = accounts.filter((account) => account.status === "connected").length;
  const today = new Intl.DateTimeFormat(undefined, { weekday: "long", month: "long", day: "numeric" }).format(new Date());
  const firstName = userName.trim().split(/\s+/)[0] || "there";
  return <div className="page home-page page-enter">
    <section className="home-hero">
      <div><p className="eyebrow">{today}</p><h2>Good to see you, {firstName}.</h2><p>{scheduled.length > 0 ? `${scheduled.length} post${scheduled.length === 1 ? " is" : "s are"} ready in your publishing queue.` : "A quiet slate. Plan your next post when inspiration strikes."}</p></div>
      <button className="home-compose" onClick={onCompose}><span><Plus /></span><b>Create a post</b><small>Draft, schedule, or publish</small></button>
    </section>
    <section className="home-summary" aria-label="Workspace summary">
      <button onClick={() => go("calendar")}><b>{scheduled.length}</b><span>Scheduled</span><ChevronRight /></button>
      <button onClick={() => go("accounts")}><b>{healthyAccounts}<small>/{accounts.length}</small></b><span>Accounts ready</span><ChevronRight /></button>
      <button onClick={() => go("brands")}><b>{brands.length}</b><span>{brands.length === 1 ? "Brand" : "Brands"}</span><ChevronRight /></button>
    </section>
    <section className="section-block home-agenda">
      <div className="section-heading"><div><p className="eyebrow">Next up</p><h3>Your publishing queue</h3></div><button className="text-button" onClick={() => go("calendar")}>Open calendar <ChevronRight /></button></div>
      <div className="upcoming-list">
        {upcoming.map((post) => {
          const date = post.scheduledAt ? new Date(post.scheduledAt) : new Date();
          const brand = brands.find((b) => b.id === post.brandId);
          return <article className="upcoming-row" key={post.id}>
            <div className="timeline"><b>{date.toLocaleDateString([], { month: "short", day: "numeric" })}</b><span>{date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span></div>
            <BrandMark brandId={post.brandId} />
            <div className="upcoming-copy"><span>{brand?.name ?? "Unassigned"}</span><h4>{post.text}</h4><div className="provider-stack">{post.targets.map((target) => <ProviderIcon id={target.provider} key={target.id} />)}</div></div>
            {post.mediaUrl ? <img className="post-thumb" src={post.mediaUrl} alt="Post media" /> : <div className="post-thumb placeholder"><FileText /></div>}
            <button className="icon-button"><MoreHorizontal /></button>
          </article>;
        })}
        {upcoming.length === 0 && <div className="home-empty"><span><CalendarDays /></span><div><h3>Nothing scheduled yet</h3><p>Your calendar is clear. Create a post now, or open the calendar to look ahead.</p></div><button className="secondary-button" onClick={() => go("calendar")}>View calendar</button></div>}
      </div>
    </section>
  </div>;
}

function CalendarView({ posts, onCompose }: { posts: RelayPost[]; onCompose: () => void }) {
  const scheduled = posts.filter((p) => p.status === "scheduled" || p.status === "failed");
  const [mode, setMode] = useState<"Week" | "Month" | "List">("Month");
  const [cursor, setCursor] = useState(() => new Date());
  const today = new Date();
  const dateKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const postsForDate = (date: Date) => scheduled.filter((post) => post.scheduledAt && dateKey(new Date(post.scheduledAt)) === dateKey(date));
  const weekStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekDates = Array.from({ length: 7 }, (_, index) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + index));
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const calendarStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - ((monthStart.getDay() + 6) % 7));
  const monthDates = Array.from({ length: 42 }, (_, index) => new Date(calendarStart.getFullYear(), calendarStart.getMonth(), calendarStart.getDate() + index));
  const label = mode === "List" ? "All scheduled posts" : mode === "Month"
    ? cursor.toLocaleDateString([], { month: "long", year: "numeric" })
    : `${weekDates[0].toLocaleDateString([], { month: "short", day: "numeric" })}–${weekDates[6].toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
  const move = (direction: number) => setCursor((current) => mode === "Month"
    ? new Date(current.getFullYear(), current.getMonth() + direction, 1)
    : new Date(current.getFullYear(), current.getMonth(), current.getDate() + direction * 7));
  return <div className="page page-enter">
    <div className="toolbar"><div className="date-nav">{mode !== "List" && <><button className="secondary-button" onClick={() => setCursor(new Date())}>Today</button><button className="icon-button" aria-label="Previous period" onClick={() => move(-1)}><ChevronLeft /></button><button className="icon-button" aria-label="Next period" onClick={() => move(1)}><ChevronRight /></button></>}<h2>{label}</h2></div><div className="segmented">{(["Month", "Week", "List"] as const).map((item) => <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{item}</button>)}</div></div>
    {mode === "List" ? <div className="list-calendar">{scheduled.length > 0 ? scheduled.map((post) => <PostRow post={post} key={post.id} />) : <div className="calendar-list-empty"><CalendarDays /><div><b>No posts scheduled</b><span>Your calendar is clear for now.</span></div><button className="secondary-button" onClick={onCompose}><Plus /> Create post</button></div>}</div> : mode === "Month" ? <div className="month-calendar">
      <div className="month-weekdays">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <b key={day}>{day}</b>)}</div>
      <div className="month-grid">{monthDates.map((date) => { const dayPosts = postsForDate(date); const isToday = dateKey(date) === dateKey(today); return <div className={`month-day ${date.getMonth() !== cursor.getMonth() ? "outside" : ""} ${isToday ? "today" : ""}`} key={date.toISOString()}><span>{date.getDate()}</span><div>{dayPosts.slice(0, 3).map((post) => <button key={post.id} onClick={onCompose}><BrandMark brandId={post.brandId} size="small" /><em>{new Date(post.scheduledAt!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</em><b>{post.text}</b></button>)}{dayPosts.length > 3 && <small>+{dayPosts.length - 3} more</small>}</div></div>; })}</div>
    </div> : <div className="calendar-shell week-calendar">
      <div className="calendar-head"><span />{weekDates.map((date) => <b key={date.toISOString()} className={dateKey(date) === dateKey(today) ? "today" : ""}>{date.toLocaleDateString([], { weekday: "short", day: "numeric" }).toUpperCase()}</b>)}</div>
      <div className="calendar-grid">{[8,9,10,11,12,13,14,15,16,17].map((hour) => <div className="calendar-line" key={hour}><span>{hour}:00</span>{weekDates.map((date) => <div key={date.toISOString()} className="calendar-cell">{postsForDate(date).filter((post) => new Date(post.scheduledAt!).getHours() === hour).map((post) => <button className="week-event" key={post.id} onClick={onCompose}>{post.text}</button>)}</div>)}</div>)}</div>
    </div>}
  </div>;
}

function PostRow({ post }: { post: RelayPost }) {
  const brands = useBrands();
  const brand = brands.find((b) => b.id === post.brandId);
  const timestamp = post.scheduledAt ?? post.publishedAt;
  return <article className="post-row">
    {post.mediaUrl ? <img src={post.mediaUrl} alt="" /> : <div className="post-no-media"><FileText /></div>}
    <div className="post-main"><p>{post.text}</p><span><BrandMark brandId={post.brandId} size="small" />{brand?.name ?? "Unassigned"}</span></div>
    <div className="provider-stack">{post.targets.map((target) => <ProviderIcon id={target.provider} key={target.id} />)}</div>
    <div className="post-date"><b>{timestamp ? new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" }) : "—"}</b><small>{timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Not scheduled"}</small></div>
    <Status value={post.status} /><button className="icon-button"><MoreHorizontal /></button>
  </article>;
}

function PostsView({ posts }: { posts: RelayPost[] }) {
  const [filter, setFilter] = useState<"all" | PostStatus>("all");
  const shown = filter === "all" ? posts : posts.filter((post) => post.status === filter);
  return <div className="page page-enter"><div className="filterbar"><div className="tabs">{(["all", "draft", "scheduled", "published", "failed"] as const).map((value) => <button className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{value[0].toUpperCase() + value.slice(1)}<span>{value === "all" ? posts.length : posts.filter((p) => p.status === value).length}</span></button>)}</div><button className="secondary-button"><Grid2X2 /> Filters</button></div><div className="posts-list">{shown.map((post) => <PostRow post={post} key={post.id} />)}{shown.length === 0 && <Empty title="Nothing here yet" body="Posts with this status will appear here." />}</div></div>;
}

function AccountsView({ onAccountDeleted }: { onAccountDeleted: (id: string) => void }) {
  const brands = useBrands();
  const accounts = useAccounts();
  const [connect, setConnect] = useState<ProviderId | "choose" | null>(null);
  const disconnect = async (account: SocialAccount) => {
    if (!window.confirm(`Disconnect ${account.displayName} from Relay? Scheduled publishing to this account will stop.`)) return;
    const response = await fetch("/api/v1/accounts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: account.id }) });
    if (response.ok) onAccountDeleted(account.id); else window.alert("Relay could not disconnect this account. Please try again.");
  };
  return <div className="page page-enter"><div className="inline-heading"><div><h2>Connected accounts</h2><p>Publish destinations grouped by brand.</p></div><button className="primary-button" disabled={brands.length === 0} onClick={() => setConnect("choose")}><Plus /> Connect account</button></div>{brands.map((brand) => { const brandAccounts = accounts.filter((account) => account.brandId === brand.id); if (brandAccounts.length === 0 && accounts.length > 0) return null; return <section className="account-group" key={brand.id}><div className="brand-header"><BrandMark brandId={brand.id} /><div><h3>{brand.name}</h3><p>{brandAccounts.length} connected account{brandAccounts.length === 1 ? "" : "s"}</p></div></div><div className="account-list">{brandAccounts.map((account) => <article key={account.id}><ProviderIcon id={account.provider} /><div><b>{account.displayName}</b><span>{providerRegistry.get(account.provider).name} · {account.handle}</span></div><div className="followers"><b>{account.tokenExpiresAt ? new Date(account.tokenExpiresAt).toLocaleDateString() : "Managed"}</b><small>token renewal</small></div>{account.status === "expired" ? <button className="status expired status-action" onClick={() => setConnect(account.provider)} title="Reconnect this account"><span />Expired · reconnect</button> : <Status value={account.status} />}<button className="icon-button" aria-label={`Disconnect ${account.displayName}`} title="Disconnect account" onClick={() => void disconnect(account)}><Trash2 /></button></article>)}</div></section>; })}{accounts.length === 0 && <Empty title="No accounts connected" body={brands.length === 0 ? "Create a brand first, then connect your social accounts." : "Connect your first social account to create a publishing destination."} />}{connect && <ConnectModal initialProvider={connect === "choose" ? undefined : connect} onClose={() => setConnect(null)} />}</div>;
}

interface MediaObject {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  etag: string | null;
  url: string;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) { value /= 1024; unit = units[index]; }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function mediaKind(name: string): "image" | "video" | "file" {
  const extension = name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "bmp"].includes(extension ?? "")) return "image";
  if (["mp4", "mov", "m4v", "webm", "avi", "mkv"].includes(extension ?? "")) return "video";
  return "file";
}

function MediaView({ onCompose }: { onCompose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<MediaObject[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");

  const load = async (pageCursor: string | null) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ limit: "24" });
      if (pageCursor) params.set("cursor", pageCursor);
      const response = await fetch(`/api/v1/media?${params}`, { cache: "no-store" });
      const payload = await response.json() as { data?: MediaObject[]; pagination?: { nextCursor?: string | null }; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load media");
      setItems(payload.data ?? []); setNextCursor(payload.pagination?.nextCursor ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load media"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void load(cursor); }, [cursor]);

  const upload = async (file: File) => {
    setBusyKey("upload"); setError("");
    try {
      const signedResponse = await fetch("/api/v1/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: file.type }) });
      const signed = await signedResponse.json() as { uploadUrl?: string; error?: string };
      if (!signedResponse.ok || !signed.uploadUrl) throw new Error(signed.error || "Could not prepare upload");
      let uploadedDirectly = false;
      try {
        const uploadResponse = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        uploadedDirectly = uploadResponse.ok;
      } catch { uploadedDirectly = false; }
      if (!uploadedDirectly) {
        const form = new FormData(); form.append("file", file);
        const fallbackResponse = await fetch("/api/v1/media", { method: "POST", body: form });
        const fallback = await fallbackResponse.json() as { error?: string };
        if (!fallbackResponse.ok) throw new Error(fallback.error || "R2 rejected the upload");
      }
      setCursor(null); setHistory([]); await load(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Upload failed"); }
    finally { setBusyKey(null); if (inputRef.current) inputRef.current.value = ""; }
  };

  const rename = async (item: MediaObject) => {
    const name = window.prompt("Rename media", item.name)?.trim();
    if (!name || name === item.name) return;
    setBusyKey(item.key); setError("");
    try {
      const response = await fetch("/api/v1/media", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: item.key, name }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not rename media");
      await load(cursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Rename failed"); }
    finally { setBusyKey(null); }
  };

  const remove = async (item: MediaObject) => {
    if (!window.confirm(`Delete ${item.name} permanently from R2?`)) return;
    setBusyKey(item.key); setError("");
    try {
      const response = await fetch("/api/v1/media", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: item.key }) });
      if (!response.ok) { const payload = await response.json() as { error?: string }; throw new Error(payload.error || "Could not delete media"); }
      await load(cursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Delete failed"); }
    finally { setBusyKey(null); }
  };

  return <div className="page page-enter"><div className="inline-heading"><div><h2>Media library</h2><p>Cloudflare R2 · 24 objects per page</p></div><button className="primary-button" disabled={busyKey === "upload"} onClick={() => inputRef.current?.click()}>{busyKey === "upload" ? <LoaderCircle className="spin" /> : <Upload />} {busyKey === "upload" ? "Uploading…" : "Upload media"}</button><input ref={inputRef} className="visually-hidden" type="file" accept="image/*,video/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></div>
    {error && <div className="media-error"><CircleAlert />{error}<button onClick={() => void load(cursor)}>Retry</button></div>}
    {loading ? <div className="media-loading"><LoaderCircle className="spin" />Loading media from R2…</div> : items.length === 0 ? <Empty title="Your media library is empty" body="Upload an image or video and it will be stored in Cloudflare R2." /> : <div className="media-grid">{items.map((item) => { const kind = mediaKind(item.name); const busy = busyKey === item.key; return <article key={item.key}><div className="media-image">{kind === "image" ? <img src={item.url} alt={item.name} loading="lazy" /> : kind === "video" ? <video src={item.url} preload="metadata" muted /> : <span className="media-file"><FileIcon /></span>}<span>{kind === "video" ? <Video /> : kind === "image" ? <ImageIcon /> : <FileIcon />}{kind}</span><div className="media-actions"><button className="icon-button" disabled={busy} onClick={() => void rename(item)} aria-label={`Rename ${item.name}`}><Pencil /></button><button className="icon-button danger" disabled={busy} onClick={() => void remove(item)} aria-label={`Delete ${item.name}`}>{busy ? <LoaderCircle className="spin" /> : <Trash2 />}</button></div></div><div><b title={item.key}>{item.name}</b><span>{formatBytes(item.size)}{item.lastModified ? ` · ${new Date(item.lastModified).toLocaleDateString()}` : ""}</span></div><button className="secondary-button" onClick={onCompose}>Use in post</button></article>; })}</div>}
    <div className="media-pagination"><button className="secondary-button" disabled={loading || history.length === 0} onClick={() => { const previous = history.at(-1) ?? null; setHistory((current) => current.slice(0, -1)); setCursor(previous); }}><ChevronLeft /> Previous</button><span><Cloud />Page {history.length + 1}</span><button className="secondary-button" disabled={loading || !nextCursor} onClick={() => { setHistory((current) => [...current, cursor]); setCursor(nextCursor); }}>Next <ChevronRight /></button></div>
  </div>;
}

function BrandModal({ brand, onClose, onSaved }: { brand?: Brand; onClose: () => void; onSaved: (brand: Brand) => void }) {
  const colors = ["#ff5c35", "#d9468f", "#1877f2", "#25875a", "#8a5cf5", "#d18b22"];
  const editing = Boolean(brand);
  const [name, setName] = useState(brand?.name ?? "");
  const [color, setColor] = useState(brand?.color ?? colors[0]);
  const [timezone, setTimezone] = useState(() => brand?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"));
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const monogram = name.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "R";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/brands", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: brand?.id, name, color, timezone }) });
      const payload = await response.json() as { data?: Brand; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error || `Could not ${editing ? "update" : "create"} the brand.`);
      onSaved(payload.data); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Could not ${editing ? "update" : "create"} the brand.`); setBusy(false); }
  };

  return <div className="modal-layer"><button className="modal-scrim" disabled={busy} onClick={onClose} aria-label={`Cancel brand ${editing ? "editing" : "creation"}`} /><form className="brand-modal" onSubmit={submit}><header><div><p className="eyebrow">{editing ? "Brand settings" : "New brand"}</p><h2>{editing ? "Edit publishing identity" : "Create a publishing identity"}</h2></div><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="Close"><X /></button></header><div className="brand-form-preview" style={{ "--brand": color } as React.CSSProperties}><span>{monogram}</span><div><b>{name.trim() || "Your brand"}</b><small>{timezone}</small></div></div><label htmlFor="brand-name">Brand name</label><input id="brand-name" autoFocus required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme Studio" /><label>Brand color</label><div className="color-options">{colors.map((value) => <button type="button" key={value} className={color === value ? "active" : ""} style={{ "--swatch": value } as React.CSSProperties} aria-label={`Use color ${value}`} aria-pressed={color === value} onClick={() => setColor(value)}><span /></button>)}</div><label htmlFor="brand-timezone">Timezone</label><input id="brand-timezone" required value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Europe/Madrid" /><small className="field-help">Use an IANA timezone such as Europe/Madrid or America/New_York.</small>{error && <p className="auth-error" role="alert">{error}</p>}<footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !name.trim()}>{busy ? <LoaderCircle className="spin" /> : editing ? <Check /> : <Plus />}{busy ? "Saving…" : editing ? "Save changes" : "Create brand"}</button></footer></form></div>;
}

function BrandActions({ brand, onEdit, onDelete }: { brand: Brand; onEdit: () => void; onDelete: () => void }) {
  const [open, setOpen] = useState(false); const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const dismiss = (event: PointerEvent) => { if (!root.current?.contains(event.target as Node)) setOpen(false); };
    const escape = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("pointerdown", dismiss); document.addEventListener("keydown", escape);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", escape); };
  }, [open]);
  return <div className="brand-actions" ref={root}><button className="icon-button" aria-label={`Actions for ${brand.name}`} aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}><MoreHorizontal /></button>{open && <div className="brand-actions-menu" role="menu"><button role="menuitem" onClick={() => { setOpen(false); onEdit(); }}><Pencil />Edit brand</button><button className="danger" role="menuitem" onClick={() => { setOpen(false); onDelete(); }}><Trash2 />Delete brand</button></div>}</div>;
}

function DeleteBrandModal({ brand, onClose, onDeleted }: { brand: Brand; onClose: () => void; onDeleted: (id: string) => void }) {
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const remove = async () => {
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/brands", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: brand.id }) });
      const payload = await response.json().catch(() => ({})) as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not delete the brand.");
      onDeleted(brand.id); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not delete the brand."); setBusy(false); }
  };
  return <div className="modal-layer"><button className="modal-scrim" disabled={busy} onClick={onClose} aria-label="Cancel brand deletion" /><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-brand-title" aria-describedby="delete-brand-description"><span className="confirm-icon"><Trash2 /></span><div><p className="eyebrow">Delete brand</p><h2 id="delete-brand-title">Delete {brand.name}?</h2><p id="delete-brand-description">This removes the brand from Relay. This action cannot be undone.</p></div>{error && <p className="auth-error" role="alert">{error}</p>}<footer><button className="secondary-button" disabled={busy} onClick={onClose}>Keep brand</button><button className="danger-button" disabled={busy} onClick={() => void remove()}>{busy ? <LoaderCircle className="spin" /> : <Trash2 />}{busy ? "Deleting…" : "Delete brand"}</button></footer></section></div>;
}

function BrandsView({ onBrandCreated, onBrandUpdated, onBrandDeleted }: { onBrandCreated: (brand: Brand) => void; onBrandUpdated: (brand: Brand) => void; onBrandDeleted: (id: string) => void }) {
  const brands = useBrands(); const accounts = useAccounts(); const [creating, setCreating] = useState(false); const [editing, setEditing] = useState<Brand | null>(null); const [deleting, setDeleting] = useState<Brand | null>(null);
  return <div className="page page-enter"><div className="inline-heading"><div><h2>Brands</h2><p>Keep accounts and publishing defaults organized.</p></div><button className="primary-button" onClick={() => setCreating(true)}><Plus /> New brand</button></div>{brands.length === 0 ? <Empty title="No brands yet" body="Create your first brand to organize accounts and publishing defaults." /> : <div className="brand-grid">{brands.map((brand) => <article key={brand.id}><div className="brand-cover" style={{ "--brand": brand.color } as React.CSSProperties}><BrandMark brandId={brand.id} size="large" /></div><div><h3>{brand.name}</h3><p>{accounts.filter((account) => account.brandId === brand.id).length} accounts · {brand.timezone}</p><div className="provider-stack">{accounts.filter((account) => account.brandId === brand.id).map((account) => <ProviderIcon id={account.provider} key={account.id} />)}</div></div><BrandActions brand={brand} onEdit={() => setEditing(brand)} onDelete={() => setDeleting(brand)} /></article>)}</div>}{creating && <BrandModal onClose={() => setCreating(false)} onSaved={onBrandCreated} />}{editing && <BrandModal brand={editing} onClose={() => setEditing(null)} onSaved={onBrandUpdated} />}{deleting && <DeleteBrandModal brand={deleting} onClose={() => setDeleting(null)} onDeleted={onBrandDeleted} />}</div>;
}

type SettingsSection = "General" | "Workspace" | "API keys" | "Storage" | "Providers" | "System" | "Appearance";

function SettingsView({ theme, setTheme, go, user }: { theme: string; setTheme: (value: string) => void; go: (view: View) => void; user: { name: string; email: string; role: string } }) {
  const accounts = useAccounts();
  const sections: SettingsSection[] = ["General", "Workspace", "API keys", "Storage", "Providers", "System", "Appearance"];
  const [section, setSection] = useState<SettingsSection>("General");
  const [health, setHealth] = useState<"idle" | "checking" | "healthy" | "error">("idle");

  const checkHealth = async () => {
    setHealth("checking");
    try {
      const response = await fetch("/health", { cache: "no-store" });
      if (!response.ok) throw new Error("Health check failed");
      setHealth("healthy");
    } catch { setHealth("error"); }
  };

  return <div className="page page-enter settings-page">
    <aside aria-label="Settings sections">{sections.map((item) => <button className={section === item ? "active" : ""} aria-current={section === item ? "page" : undefined} onClick={() => setSection(item)} key={item}>{item}</button>)}</aside>
    <section className="settings-content"><p className="eyebrow">Settings</p><h2>{section}</h2>
      {section === "General" && <><p>Your account and local Relay preferences.</p><div className="settings-stack"><article className="settings-card"><span className="settings-card-icon"><Users /></span><div><b>{user.name}</b><small>{user.email}</small></div><Status value="connected" /></article><article className="settings-card"><span className="settings-card-icon"><Clock3 /></span><div><b>Local timezone</b><small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small></div></article><article className="settings-card"><span className="settings-card-icon"><ShieldCheck /></span><div><b>Session security</b><small>Signed sessions renew during use and expire after 30 days.</small></div></article></div></>}
      {section === "Workspace" && <><p>Relay’s brands and workspace membership.</p><div className="system-card"><div><span className="workspace-avatar">R</span><b>Relay · Personal workspace</b></div><p>You are signed in as {user.role === "OWNER" ? "the workspace owner" : "a workspace member"}. Brands keep social destinations and publishing defaults organized.</p><button className="secondary-button" onClick={() => go("brands")}><LayoutGrid /> Manage brands</button></div></>}
      {section === "API keys" && <><p>Application credentials are managed securely through server environment variables.</p><div className="settings-stack"><article className="settings-card"><span className="settings-card-icon"><KeyRound /></span><div><b>Server-managed secrets</b><small>Provider secrets are never returned to this browser or shown in the dashboard.</small></div></article><article className="settings-card"><span className="settings-card-icon"><ShieldCheck /></span><div><b>Encrypted account tokens</b><small>Connected-account access and refresh tokens are encrypted before database storage.</small></div></article></div><p className="settings-footnote">Edit `.env` locally or environment variables in Coolify, then restart Relay to apply credential changes.</p></>}
      {section === "Storage" && <><p>Media is stored in the configured Cloudflare R2 bucket.</p><div className="system-card"><div><Cloud /><b>Cloudflare R2</b></div><p>R2 is Relay’s fixed media backend. Files remain available independently of this Docker container.</p><button className="secondary-button" onClick={() => go("media")}><ImageIcon /> Open media library</button></div></>}
      {section === "Providers" && <><p>Publishing destinations available to this Relay installation.</p><div className="settings-stack">{providerRegistry.list().map((provider) => { const count = accounts.filter((account) => account.provider === provider.id).length; return <article className="settings-card" key={provider.id}><ProviderIcon id={provider.id} /><div><b>{provider.name}</b><small>{count === 0 ? "No connected accounts" : `${count} connected account${count === 1 ? "" : "s"}`}</small></div><Status value={count > 0 ? "connected" : "warning"} /></article>; })}</div><button className="secondary-button settings-action" onClick={() => go("accounts")}><Plus /> Manage connections</button></>}
      {section === "System" && <><p>Check the running web service without exposing configuration or secrets.</p><div className={`system-card health-${health}`}><div><span className="pulse" /><b>{health === "checking" ? "Checking Relay…" : health === "healthy" ? "Relay is healthy" : health === "error" ? "Relay did not respond" : "System status"}</b></div><p>{health === "healthy" ? "The authenticated dashboard and health endpoint are responding normally." : health === "error" ? "The health request failed. Check the web container logs." : "Run a fresh check against this deployment."}</p><button className="secondary-button" disabled={health === "checking"} onClick={() => void checkHealth()}>{health === "checking" ? <LoaderCircle className="spin" /> : <RefreshCw />} {health === "checking" ? "Checking…" : "Run health check"}</button></div></>}
      {section === "Appearance" && <><p>Choose how Relay looks on this device.</p><div className="theme-options">{["light", "dark"].map((value) => <button className={theme === value ? "active" : ""} onClick={() => setTheme(value)} key={value}>{value === "light" ? <Sun /> : <Moon />}<span><b>{value[0].toUpperCase() + value.slice(1)}</b><small>{value === "light" ? "Bright and calm" : "Easy on the eyes"}</small></span>{theme === value && <Check />}</button>)}</div></>}
    </section>
  </div>;
}

function Empty({ title, body }: { title: string; body: string }) { return <div className="empty"><span><Sparkles /></span><h3>{title}</h3><p>{body}</p></div>; }

function ConnectModal({ onClose, initialProvider }: { onClose: () => void; initialProvider?: ProviderId }) {
  const brands = useBrands();
  const [selected, setSelected] = useState<ProviderId | null>(initialProvider ?? null);
  const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const [providerConfig, setProviderConfig] = useState<Record<string, { configured: boolean; connectionOptions: { flow: string; configured: boolean }[] }>>({});
  const [loading, setLoading] = useState(true); const [error, setError] = useState("");
  useEffect(() => {
    void fetch("/api/v1/providers", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as { data?: Array<{ id: string; configured: boolean; connectionOptions: { flow: string; configured: boolean }[] }>; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not check provider configuration.");
      setProviderConfig(Object.fromEntries((payload.data ?? []).map((item) => [item.id, item])));
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not check provider configuration.")).finally(() => setLoading(false));
  }, []);
  const provider = selected ? providerRegistry.get(selected) : null;
  const options = selected ? providerConfig[selected]?.connectionOptions ?? [] : [];
  const connectLabel = (flow: string) => flow === "instagram-standalone" ? "Instagram Login" : flow === "instagram" ? "Through a Facebook Page" : `Continue with ${provider?.name ?? "provider"}`;
  const begin = (flow: string) => { if (brandId) window.location.assign(`/api/oauth/${encodeURIComponent(flow)}/start?brandId=${encodeURIComponent(brandId)}`); };
  return <div className="modal-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close account connection" /><div className="connect-modal" role="dialog" aria-modal="true" aria-labelledby="connect-title"><div className="modal-title"><div><p className="eyebrow">New destination</p><h2 id="connect-title">Connect an account</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X /></button></div><p>Choose a network, then authorize Relay on its secure provider page.</p><label className="connect-brand">Add accounts to<select value={brandId} onChange={(event) => setBrandId(event.target.value)}>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}</select></label>{error && <p className="auth-error" role="alert">{error}</p>}<div className="connect-list" aria-busy={loading}>{providerRegistry.list().map((item) => { const configured = providerConfig[item.id]?.configured; return <button key={item.id} disabled={loading} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><ProviderIcon id={item.id} selected /><span><b>{item.name}</b><small>{loading ? "Checking configuration…" : configured ? "Ready to connect" : "OAuth keys are not configured"}</small></span><ChevronRight /></button>; })}</div>{provider && <div className="connection-panel"><div><ProviderIcon id={provider.id} selected /><span><b>Connect {provider.name}</b><small>{options.some((option) => option.configured) ? "You’ll return to Relay automatically after authorization." : "Add this provider’s OAuth keys and restart Relay."}</small></span></div>{options.map((option) => <button className="primary-button" key={option.flow} disabled={!option.configured || !brandId} onClick={() => begin(option.flow)}>{connectLabel(option.flow)}<ChevronRight /></button>)}</div>}<p className="safe-note"><Zap /> Tokens are encrypted at rest and never exposed to the browser.</p></div></div>;
}

function LogoutModal({ busy, error, onClose, onConfirm }: { busy: boolean; error: string; onClose: () => void; onConfirm: () => void }) {
  return <div className="modal-layer"><button className="modal-scrim" onClick={busy ? undefined : onClose} aria-label="Cancel sign out" /><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="logout-title" aria-describedby="logout-description"><span className="confirm-icon"><LogOut /></span><div><p className="eyebrow">End session</p><h2 id="logout-title">Sign out of Relay?</h2><p id="logout-description">You’ll need your email and password to access the dashboard again.</p></div>{error && <p className="auth-error" role="alert">{error}</p>}<footer><button className="secondary-button" disabled={busy} onClick={onClose}>Stay signed in</button><button className="danger-button" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" /> : <LogOut />}{busy ? "Signing out…" : "Sign out"}</button></footer></section></div>;
}

function Composer({ onClose, onCreate }: { onClose: () => void; onCreate: (post: RelayPost) => void }) {
  const brands = useBrands();
  const accounts = useAccounts();
  const [text, setText] = useState(""); const [brandId, setBrandId] = useState(brands[0]?.id ?? "");
  const available = accounts.filter((account) => account.brandId === brandId);
  const [selected, setSelected] = useState<string[]>([]);
  const [previewMode, setPreviewMode] = useState<"feed" | "mobile">("feed");
  const [instagramType, setInstagramType] = useState<"feed" | "reel" | "story">("feed");
  const [facebookType, setFacebookType] = useState<"feed" | "reel">("feed");
  const [facebookLink, setFacebookLink] = useState("");
  const [tiktokPrivacy, setTiktokPrivacy] = useState<"PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY">("SELF_ONLY");
  const [tiktokComments, setTiktokComments] = useState(true);
  const [tiktokDuet, setTiktokDuet] = useState(false);
  const [tiktokStitch, setTiktokStitch] = useState(false);
  const [youtubeTitle, setYoutubeTitle] = useState("");
  const [youtubeTags, setYoutubeTags] = useState("");
  const [youtubePrivacy, setYoutubePrivacy] = useState<"private" | "unlisted" | "public">("private");
  const [youtubeMadeForKids, setYoutubeMadeForKids] = useState(false);
  const [schedule, setSchedule] = useState(true); const [saved, setSaved] = useState(true);
  useEffect(() => { setSaved(false); const timeout = setTimeout(() => setSaved(true), 700); return () => clearTimeout(timeout); }, [text]);
  useEffect(() => { setSelected(accounts.filter((a) => a.brandId === brandId).slice(0, 2).map((a) => a.id)); }, [brandId]);
  const selectedAccounts = available.filter((account) => selected.includes(account.id));
  const selectedProviders = [...new Set(selectedAccounts.map((account) => account.provider))];
  const youtubeReady = !selectedProviders.includes("youtube") || youtubeTitle.trim().length > 0;
  const canSubmit = Boolean(text.trim() && brandId && selected.length > 0 && youtubeReady);
  const settingsFor = (provider: ProviderId): ProviderPostSettings => {
    if (provider === "instagram") return { kind: "instagram", publishType: instagramType };
    if (provider === "facebook") return { kind: "facebook", publishType: facebookType, linkUrl: facebookLink.trim() || undefined };
    if (provider === "tiktok") return { kind: "tiktok", privacyLevel: tiktokPrivacy, allowComments: tiktokComments, allowDuet: tiktokDuet, allowStitch: tiktokStitch };
    return { kind: "youtube", title: youtubeTitle.trim(), tags: [...new Set(youtubeTags.split(",").map((tag) => tag.trim()).filter(Boolean))], privacyStatus: youtubePrivacy, madeForKids: youtubeMadeForKids };
  };
  const submit = () => {
    if (!canSubmit) return;
    const targets = selectedAccounts.map((account, index) => ({ id: `new-target-${index}`, accountId: account.id, provider: account.provider, status: schedule ? "scheduled" as const : "published" as const, settings: settingsFor(account.provider) }));
    const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1); tomorrow.setHours(9, 30, 0, 0);
    onCreate({ id: `post-${Date.now()}`, brandId, text, mediaType: "none", status: schedule ? "scheduled" : "published", scheduledAt: schedule ? tomorrow.toISOString() : undefined, publishedAt: schedule ? undefined : new Date().toISOString(), targets });
    onClose();
  };
  return <div className="composer-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close composer" /><section className="composer">
    <header><div><button className="icon-button mobile-only" onClick={onClose}><ArrowLeft /></button><span className="composer-mark"><Send /></span><div><p className="eyebrow">New post</p><h2>Create once. Relay everywhere.</h2></div></div><div><span className={`save-state ${saved ? "saved" : ""}`}>{saved ? <><Check /> Saved</> : "Saving…"}</span><button className="icon-button desktop-only" onClick={onClose}><X /></button></div></header>
    <div className="composer-body"><main>
      <label className="field-label">Brand</label><div className="brand-select">{brands.map((brand) => <button className={brandId === brand.id ? "active" : ""} onClick={() => setBrandId(brand.id)} key={brand.id}><BrandMark brandId={brand.id} size="small" />{brand.name}{brandId === brand.id && <Check />}</button>)}{brands.length === 0 && <p className="inline-empty">Create a brand before composing a post.</p>}</div>
      <label className="field-label" htmlFor="caption">Content</label><div className="caption-box"><textarea id="caption" autoFocus value={text} onChange={(event) => setText(event.target.value)} placeholder="What do you want to share?" /><div><button><ImageIcon /> Add media</button><span>{text.length} / 2,200</span></div></div>
      <div className="dest-heading"><div><label className="field-label">Publish to</label><p>Select the destinations for this post.</p></div><button onClick={() => setSelected(available.map((account) => account.id))}>Select all</button></div>
      <div className="destination-list">{available.map((account) => { const isSelected = selected.includes(account.id); return <button className={isSelected ? "selected" : ""} onClick={() => setSelected(isSelected ? selected.filter((id) => id !== account.id) : [...selected, account.id])} key={account.id}><span className="check-box">{isSelected && <Check />}</span><ProviderIcon id={account.provider} selected={isSelected} /><span><b>{providerRegistry.get(account.provider).name}</b><small>{account.handle}</small></span><em>{isSelected ? <><Check /> Selected</> : "Not selected"}</em></button>; })}{available.length === 0 && <p className="inline-empty">No connected accounts are available.</p>}</div>
      {selectedProviders.length > 0 && <section className="platform-settings"><div className="platform-settings-heading"><span className="field-label">Platform settings</span><p>These values are stored separately for each destination.</p></div>
        {selectedProviders.includes("instagram") && <div className="platform-card"><div className="platform-card-title"><ProviderIcon id="instagram" /><span><b>Instagram</b><small>Choose where the media appears.</small></span></div><label>Publish as<select value={instagramType} onChange={(event) => setInstagramType(event.target.value as typeof instagramType)}><option value="feed">Feed post</option><option value="reel">Reel</option><option value="story">Story</option></select></label></div>}
        {selectedProviders.includes("facebook") && <div className="platform-card"><div className="platform-card-title"><ProviderIcon id="facebook" /><span><b>Facebook</b><small>Page publishing options.</small></span></div><div className="platform-grid"><label>Publish as<select value={facebookType} onChange={(event) => setFacebookType(event.target.value as typeof facebookType)}><option value="feed">Feed post</option><option value="reel">Reel</option></select></label><label>Link URL <span>optional</span><input type="url" value={facebookLink} onChange={(event) => setFacebookLink(event.target.value)} placeholder="https://…" /></label></div></div>}
        {selectedProviders.includes("tiktok") && <div className="platform-card"><div className="platform-card-title"><ProviderIcon id="tiktok" /><span><b>TikTok</b><small>Only account-allowed options will be used at publish time.</small></span></div><label>Who can watch<select value={tiktokPrivacy} onChange={(event) => setTiktokPrivacy(event.target.value as typeof tiktokPrivacy)}><option value="SELF_ONLY">Only me</option><option value="MUTUAL_FOLLOW_FRIENDS">Friends</option><option value="FOLLOWER_OF_CREATOR">Followers</option><option value="PUBLIC_TO_EVERYONE">Everyone</option></select></label><div className="toggle-row"><label><input type="checkbox" checked={tiktokComments} onChange={(event) => setTiktokComments(event.target.checked)} /> Comments</label><label><input type="checkbox" checked={tiktokDuet} onChange={(event) => setTiktokDuet(event.target.checked)} /> Duet</label><label><input type="checkbox" checked={tiktokStitch} onChange={(event) => setTiktokStitch(event.target.checked)} /> Stitch</label></div><p className="settings-note"><CircleAlert /> Relay will query TikTok creator info before publishing and reject unavailable choices.</p></div>}
        {selectedProviders.includes("youtube") && <div className="platform-card"><div className="platform-card-title"><ProviderIcon id="youtube" /><span><b>YouTube</b><small>Video metadata sent with the upload.</small></span></div><label>Video title <span>required</span><input value={youtubeTitle} maxLength={100} onChange={(event) => setYoutubeTitle(event.target.value)} placeholder="Add a YouTube title" /></label><label>Tags <span>comma-separated</span><input value={youtubeTags} onChange={(event) => setYoutubeTags(event.target.value)} placeholder="product, tutorial, behind the scenes" /></label><div className="platform-grid"><label>Visibility<select value={youtubePrivacy} onChange={(event) => setYoutubePrivacy(event.target.value as typeof youtubePrivacy)}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label><label className="checkbox-field"><input type="checkbox" checked={youtubeMadeForKids} onChange={(event) => setYoutubeMadeForKids(event.target.checked)} /> Made for kids</label></div></div>}
      </section>}
    </main><aside className="preview-panel"><div className="preview-head"><span>Preview</span><div className="segmented compact" aria-label="Preview format">{(["feed", "mobile"] as const).map((mode) => <button key={mode} className={previewMode === mode ? "active" : ""} aria-pressed={previewMode === mode} onClick={() => setPreviewMode(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}</div></div><div className={`social-preview ${previewMode}`}>{previewMode === "mobile" && <div className="phone-status"><b>9:41</b><span>● ◒ ▰</span></div>}<div className="preview-account"><BrandMark brandId={brandId} size="small" /><span><b>{brands.find((brand) => brand.id === brandId)?.name ?? "Unassigned"}</b><small>Preview · just now</small></span><MoreHorizontal /></div><div className="preview-placeholder"><span className="preview-glyph"><i /><i /></span><p>Your media will appear here</p></div><div className="preview-actions"><span>♡</span><span>◯</span><span>⌁</span></div><p>{text || "Start writing to preview your post across social networks."}</p>{previewMode === "mobile" && <div className="phone-home-indicator" />}</div><div className="validation"><h4>Destination check</h4>{selectedAccounts.map((account) => { const ready = Boolean(text.trim()) && (account.provider !== "youtube" || youtubeReady); return <div key={account.id}><ProviderIcon id={account.provider} /><span>{providerRegistry.get(account.provider).name}</span>{ready ? <em className="ready"><Check /> Ready</em> : <em><CircleAlert />{!text.trim() ? " Add content" : " Add title"}</em>}</div>; })}</div></aside></div>
    <footer><div className="schedule-choice"><button className={!schedule ? "active" : ""} onClick={() => setSchedule(false)}><Zap /> Publish now</button><button className={schedule ? "active" : ""} onClick={() => setSchedule(true)}><Clock3 /> Schedule</button>{schedule && <div className="schedule-date"><CalendarDays /><span><b>Tomorrow</b><small>09:30 local time</small></span><ChevronDown /></div>}</div><button className="publish-button" disabled={!canSubmit} onClick={submit}>{schedule ? "Schedule post" : "Publish now"}<Send /></button></footer>
  </section></div>;
}

function CommandMenu({ onClose, go, compose }: { onClose: () => void; go: (v: View) => void; compose: () => void }) { const commands = [{ name: "Create post", icon: Plus, action: compose }, { name: "Open calendar", icon: CalendarDays, action: () => go("calendar") }, { name: "Search posts", icon: Search, action: () => go("posts") }, { name: "Connect account", icon: Users, action: () => go("accounts") }, { name: "Upload media", icon: ImageIcon, action: () => go("media") }]; return <div className="modal-layer command-layer"><button className="modal-scrim" onClick={onClose} /><div className="command-menu"><div><Search /><input autoFocus placeholder="Search or type a command…"/><kbd>ESC</kbd></div><p>Quick actions</p>{commands.map(({ name, icon: Icon, action }) => <button key={name} onClick={() => { action(); onClose(); }}><Icon />{name}<span>↵</span></button>)}<footer><span><Command /> Relay command menu</span><span>↑↓ Navigate · ↵ Select</span></footer></div></div>; }

export default function RelayApp({ user, initialBrands, initialAccounts }: { user: { name: string; email: string; role: string }; initialBrands: Brand[]; initialAccounts: SocialAccount[] }) {
  const [view, setView] = useState<View>("home"); const [posts, setPosts] = useState(initialPosts);
  const [brandList, setBrandList] = useState(initialBrands);
  const [accountList, setAccountList] = useState(initialAccounts);
  const [composer, setComposer] = useState(false); const [command, setCommand] = useState(false); const [menu, setMenu] = useState(false); const [theme, setTheme] = useState("light"); const [toast, setToast] = useState("");
  const [themeReady, setThemeReady] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false); const [logoutBusy, setLogoutBusy] = useState(false); const [logoutError, setLogoutError] = useState("");
  useEffect(() => { const stored = window.localStorage.getItem("relay-theme"); if (stored === "light" || stored === "dark") setTheme(stored); setThemeReady(true); }, []);
  useEffect(() => {
    const url = new URL(window.location.href); const oauth = url.searchParams.get("oauth");
    if (!oauth) return;
    setView("accounts");
    if (oauth === "success") { const count = Number(url.searchParams.get("count") || 1); const provider = url.searchParams.get("provider") || "social"; setToast(`${count} ${provider} account${count === 1 ? "" : "s"} connected successfully`); }
    else { const code = url.searchParams.get("code"); const messages: Record<string, string> = { authorization_denied: "Connection cancelled by the provider", provider_rejected: "The provider rejected the connection. Verify the callback URL, account type, and requested permissions.", account_save_failed: "Authorization succeeded, but Relay could not save the account. Deploy the latest database and OAuth fixes.", authorization_expired: "This authorization is no longer valid. Please reconnect the account." }; setToast(messages[code ?? ""] ?? "The social account could not be connected. Check its permissions and try again."); }
    url.searchParams.delete("oauth"); url.searchParams.delete("provider"); url.searchParams.delete("count"); url.searchParams.delete("code");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`); const timer = window.setTimeout(() => setToast(""), 5000); return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; if (themeReady) window.localStorage.setItem("relay-theme", theme); }, [theme, themeReady]);
  useEffect(() => { const handle = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommand(true); } if (event.key.toLowerCase() === "c" && !["INPUT", "TEXTAREA"].includes((event.target as HTMLElement).tagName)) setComposer(true); if (event.key === "Escape") { setComposer(false); setCommand(false); } }; window.addEventListener("keydown", handle); return () => window.removeEventListener("keydown", handle); }, []);
  const addPost = (post: RelayPost) => { setPosts((current) => [post, ...current]); setToast(post.status === "scheduled" ? "Post scheduled for tomorrow at 09:30" : "Post published successfully"); setTimeout(() => setToast(""), 3500); };
  const content = useMemo(() => { if (view === "home") return <HomeView posts={posts} onCompose={() => setComposer(true)} go={setView} userName={user.name} />; if (view === "calendar") return <CalendarView posts={posts} onCompose={() => setComposer(true)} />; if (view === "posts") return <PostsView posts={posts} />; if (view === "accounts") return <AccountsView onAccountDeleted={(id) => setAccountList((current) => current.filter((item) => item.id !== id))} />; if (view === "media") return <MediaView onCompose={() => setComposer(true)} />; if (view === "brands") return <BrandsView onBrandCreated={(brand) => setBrandList((current) => [...current, brand])} onBrandUpdated={(brand) => setBrandList((current) => current.map((item) => item.id === brand.id ? brand : item))} onBrandDeleted={(id) => setBrandList((current) => current.filter((item) => item.id !== id))} />; return <SettingsView theme={theme} setTheme={setTheme} go={setView} user={user} />; }, [view, posts, theme, user]);
  const logout = async () => {
    setLogoutBusy(true); setLogoutError("");
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Relay could not end your session. Please try again.");
      window.location.replace("/login");
    } catch (reason) { setLogoutError(reason instanceof Error ? reason.message : "Relay could not end your session."); setLogoutBusy(false); }
  };
  return <BrandsContext.Provider value={brandList}><AccountsContext.Provider value={accountList}><div className="app-shell"><Sidebar active={view} onChange={setView} mobileOpen={menu} onClose={() => setMenu(false)} user={user} onLogout={() => { setLogoutError(""); setLogoutConfirm(true); }} /><main className="main"><Topbar view={view} onCompose={() => setComposer(true)} onCommand={() => setCommand(true)} onMenu={() => setMenu(true)} />{content}</main><nav className="mobile-nav">{navItems.slice(0, 3).map(({ id, icon: Icon }) => <button className={view === id ? "active" : ""} onClick={() => setView(id)} key={id}><Icon /><span>{viewLabel[id]}</span></button>)}<button className="mobile-create" onClick={() => setComposer(true)}><Plus /></button><button className={view === "accounts" ? "active" : ""} onClick={() => setView("accounts")}><Users /><span>Accounts</span></button><button onClick={() => setMenu(true)}><Menu /><span>More</span></button></nav>{composer && <Composer onClose={() => setComposer(false)} onCreate={addPost} />}{command && <CommandMenu onClose={() => setCommand(false)} go={setView} compose={() => setComposer(true)} />}{logoutConfirm && <LogoutModal busy={logoutBusy} error={logoutError} onClose={() => setLogoutConfirm(false)} onConfirm={() => void logout()} />}{toast && <div className="toast"><span><Check /></span>{toast}</div>}</div></AccountsContext.Provider></BrandsContext.Provider>;
}
