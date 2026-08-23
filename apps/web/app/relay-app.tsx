"use client";

import { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft, BarChart3, Bell, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight,
  CircleAlert, Clock3, Cloud, Command, Database, ExternalLink, File as FileIcon, FileText, Folder, FolderOpen, Grid2X2, Home, Image as ImageIcon,
  Eye, Heart, Images, Instagram, KeyRound, LayoutGrid, List, LoaderCircle, LogOut, Menu, MessageCircle, Moon, MoreHorizontal, Pencil, Plus, RefreshCw, Search,
  Send, Settings, Share2, ShieldCheck, Sparkles, Sun, Trash2, TrendingUp, Upload, Users, Video, X, Youtube, Zap,
} from "lucide-react";
import { type Brand, type ProviderId, type ProviderPostSettings, type RelayPost, type SocialAccount, type PostStatus } from "@relay/core";
import { providerRegistry } from "@relay/providers";
import SlideshowStudio from "./slideshow-studio";
import { ConfirmModal, PromptModal } from "./confirm-modal";

type View = "home" | "calendar" | "posts" | "analytics" | "slideshows" | "media" | "brands" | "accounts" | "settings";
type NotificationKind = "success" | "error" | "scheduled" | "info";
interface RelayNotification {
  id: string;
  eventKey: string;
  postId: string | null;
  targetId: string | null;
  provider: ProviderId | null;
  kind: NotificationKind;
  title: string;
  message: string;
  externalUrl: string | null;
  readAt: string | null;
  createdAt: string;
}
const BrandsContext = createContext<Brand[]>([]);
const useBrands = () => useContext(BrandsContext);
const AccountsContext = createContext<SocialAccount[]>([]);
const useAccounts = () => useContext(AccountsContext);

const viewLabel: Record<View, string> = { home: "Home", calendar: "Calendar", posts: "Posts", analytics: "Analytics", slideshows: "Slide Studio", media: "Media", brands: "Brands", accounts: "Accounts", settings: "Settings" };
const navItems: { id: View; icon: typeof Home }[] = [
  { id: "home", icon: Home }, { id: "calendar", icon: CalendarDays }, { id: "posts", icon: FileText }, { id: "slideshows", icon: Images }, { id: "analytics", icon: BarChart3 }, { id: "media", icon: ImageIcon },
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
  const labels: Record<string, string> = { draft: "Draft", scheduled: "Scheduled", publishing: "Publishing", processing: "Processing", published: "Published", failed: "Failed", connected: "Connected", warning: "Attention", expired: "Expired" };
  return <span className={`status ${value}`}><span />{labels[value]}</span>;
}

function Topbar({ view, unread, onNotifications, onCompose, onCommand, onMenu }: { view: View; unread: number; onNotifications: () => void; onCompose: () => void; onCommand: () => void; onMenu: () => void }) {
  return <header className="topbar">
    <button className="icon-button mobile-only" aria-label="Open menu" onClick={onMenu}><Menu /></button>
    <div><p className="eyebrow">Personal workspace</p><h1>{viewLabel[view]}</h1></div>
    <div className="top-actions">
      <button className="command-trigger" onClick={onCommand}><Search /><span>Search Relay</span><kbd>⌘ K</kbd></button>
      <button className="notification-trigger" aria-label={`Open notifications${unread ? `, ${unread} unread` : ""}`} onClick={onNotifications}><Bell />{unread > 0 && <span>{unread > 99 ? "99+" : unread}</span>}</button>
      <button className="primary-button" onClick={onCompose}><Plus /> Create post</button>
    </div>
  </header>;
}

function NotificationCenter({ notifications, loading, onClose, onMarkAllRead }: { notifications: RelayNotification[]; loading: boolean; onClose: () => void; onMarkAllRead: () => void }) {
  const [filter, setFilter] = useState<"all" | "problems" | "success">("all");
  const visible = notifications.filter((item) => filter === "all" || (filter === "problems" ? item.kind === "error" : item.kind === "success"));
  const unread = notifications.filter((item) => !item.readAt).length;
  const relative = (value: string) => {
    const seconds = Math.max(0, Math.round((Date.now() - new Date(value).getTime()) / 1_000));
    if (seconds < 60) return "just now";
    if (seconds < 3_600) return `${Math.floor(seconds / 60)}m ago`;
    if (seconds < 86_400) return `${Math.floor(seconds / 3_600)}h ago`;
    return new Date(value).toLocaleDateString([], { month: "short", day: "numeric" });
  };
  return <div className="notification-layer"><button className="notification-scrim" onClick={onClose} aria-label="Close notifications" /><aside className="notification-center" role="dialog" aria-modal="true" aria-labelledby="notification-title"><header><div><p className="eyebrow">Publishing activity</p><h2 id="notification-title">Notifications</h2></div><div>{unread > 0 && <button onClick={onMarkAllRead}>Mark all read</button>}<button className="icon-button" onClick={onClose} aria-label="Close"><X /></button></div></header><div className="notification-filters">{([['all', 'All'], ['problems', 'Problems'], ['success', 'Success']] as const).map(([value, label]) => <button className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{label}{value === "problems" && notifications.some((item) => item.kind === "error") && <span>{notifications.filter((item) => item.kind === "error").length}</span>}</button>)}</div><div className="notification-list">{loading ? <div className="notification-empty"><LoaderCircle className="spin" /><b>Loading activity…</b></div> : visible.length === 0 ? <div className="notification-empty"><Bell /><b>{filter === "all" ? "No publishing activity yet" : `No ${filter} to show`}</b><p>Platform results will appear here after Relay schedules or publishes a post.</p></div> : visible.map((item) => <article className={`${item.kind} ${item.readAt ? "" : "unread"}`} key={item.id}><span className="notification-state">{item.kind === "success" ? <CheckCircle2 /> : item.kind === "error" ? <CircleAlert /> : item.kind === "scheduled" ? <Clock3 /> : <Bell />}</span><div><div><span>{item.provider && <ProviderIcon id={item.provider} />}</span><b>{item.title}</b><time>{relative(item.createdAt)}</time></div><p>{item.message}</p>{item.externalUrl && <a href={item.externalUrl} target="_blank" rel="noreferrer">Open on {item.provider ? providerRegistry.get(item.provider).name : "platform"}<ExternalLink /></a>}</div></article>)}</div><footer><span><span className="notification-legend success" />Published</span><span><span className="notification-legend error" />Needs attention</span><span><span className="notification-legend scheduled" />Scheduled</span></footer></aside></div>;
}

function Sidebar({ active, onChange, mobileOpen, onClose, user, onLogout }: { active: View; onChange: (view: View) => void; mobileOpen: boolean; onClose: () => void; user: { name: string; role: string }; onLogout: () => void }) {
  const accounts = useAccounts();
  return <>
    {mobileOpen && <button className="scrim" onClick={onClose} aria-label="Close menu" />}
    <aside className={`sidebar ${mobileOpen ? "open" : ""}`}>
      <div className="wordmark"><span className="relay-glyph"><i /><i /></span>Relay<button className="icon-button sidebar-close" onClick={onClose}><X /></button></div>
      <nav aria-label="Main navigation">
        {navItems.map((item) => {
          const Icon = item.icon;
          return <div key={item.id} className={item.id === "brands" || item.id === "settings" ? "nav-separator" : ""}>
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

function HomeView({ posts, onCompose, go, userName, initialNow }: { posts: RelayPost[]; onCompose: () => void; go: (v: View) => void; userName: string; initialNow: string }) {
  const brands = useBrands();
  const accounts = useAccounts();
  const scheduled = posts
    .filter((post) => post.status === "scheduled")
    .sort((a, b) => new Date(a.scheduledAt ?? 0).getTime() - new Date(b.scheduledAt ?? 0).getTime());
  const upcoming = scheduled.slice(0, 4);
  const healthyAccounts = accounts.filter((account) => account.status === "connected").length;
  const timezone = brands[0]?.timezone || "UTC";
  const today = new Intl.DateTimeFormat("en-US", { weekday: "long", month: "long", day: "numeric", timeZone: timezone }).format(new Date(initialNow));
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

type AnalyticsMetric = "views" | "reach" | "likes" | "comments" | "shares" | "saves";

const compactMetric = (value: number) => new Intl.NumberFormat("en", { notation: value >= 10_000 ? "compact" : "standard", maximumFractionDigits: 1 }).format(value);

function AnalyticsView({ posts, onCompose }: { posts: RelayPost[]; onCompose: () => void }) {
  const brands = useBrands();
  const rows = posts.flatMap((post) => post.targets.filter((target) => target.analytics).map((target) => ({ post, target, analytics: target.analytics! })));
  const total = (metric: AnalyticsMetric) => rows.reduce((sum, row) => sum + (row.analytics[metric] ?? 0), 0);
  const views = total("views"); const likes = total("likes"); const comments = total("comments"); const shares = total("shares"); const saves = total("saves");
  const interactions = likes + comments + shares + saves;
  const engagementRate = views > 0 ? interactions / views * 100 : 0;
  const ranked = [...rows].sort((a, b) => (b.analytics.views ?? 0) - (a.analytics.views ?? 0));
  const top = ranked[0]; const maxViews = Math.max(1, ...ranked.map((row) => row.analytics.views ?? 0));
  const platforms = providerRegistry.list().map((provider) => {
    const providerRows = rows.filter((row) => row.target.provider === provider.id);
    return { ...provider, posts: providerRows.length, views: providerRows.reduce((sum, row) => sum + (row.analytics.views ?? 0), 0), interactions: providerRows.reduce((sum, row) => sum + (row.analytics.likes ?? 0) + (row.analytics.comments ?? 0) + (row.analytics.shares ?? 0) + (row.analytics.saves ?? 0), 0) };
  }).filter((provider) => provider.posts > 0).sort((a, b) => b.views - a.views);

  if (rows.length === 0) return <div className="page analytics-page page-enter"><div className="analytics-empty"><span><BarChart3 /></span><p className="eyebrow">Performance desk</p><h2>Publish first. Learn next.</h2><p>Relay will begin collecting views and engagement shortly after a connected platform confirms your first post.</p><button className="primary-button" onClick={onCompose}><Plus /> Create a post</button></div></div>;

  return <div className="page analytics-page page-enter">
    <section className="analytics-intro"><div><p className="eyebrow">Cross-platform intelligence</p><h2>What resonated,<br/><em>at a glance.</em></h2><p>Live performance from every connected destination, normalized without erasing what makes each platform different.</p></div><div className="analytics-freshness"><span className="pulse"/><div><b>Analytics are active</b><small>Latest capture {new Date(Math.max(...rows.map((row) => new Date(row.analytics.capturedAt).getTime()))).toLocaleString()}</small></div></div></section>
    <section className="analytics-metrics" aria-label="Performance totals">
      <article><span><Eye /></span><small>Total views</small><b>{compactMetric(views)}</b><em>Across {rows.length} destination{rows.length === 1 ? "" : "s"}</em></article>
      <article><span><Heart /></span><small>Interactions</small><b>{compactMetric(interactions)}</b><em>{engagementRate.toFixed(1)}% by views</em></article>
      <article><span><MessageCircle /></span><small>Comments</small><b>{compactMetric(comments)}</b><em>{compactMetric(likes)} likes</em></article>
      <article><span><Share2 /></span><small>Shares</small><b>{compactMetric(shares)}</b><em>{compactMetric(saves)} saves</em></article>
    </section>
    <section className="analytics-grid">
      <article className="analytics-chart-card"><header><div><p className="eyebrow">Content ranking</p><h3>Views by destination</h3></div><span>Lifetime totals</span></header><div className="analytics-bars">{ranked.slice(0, 7).map((row, index) => <div key={row.target.id}><div className="analytics-bar-copy"><span><b>{String(index + 1).padStart(2, "0")}</b><ProviderIcon id={row.target.provider}/><em>{row.post.text || "Media post"}</em></span><strong>{compactMetric(row.analytics.views ?? 0)}</strong></div><div className="analytics-track"><i style={{ width: `${Math.max(3, (row.analytics.views ?? 0) / maxViews * 100)}%`, "--provider": providerRegistry.get(row.target.provider).color } as React.CSSProperties}/></div></div>)}</div></article>
      <article className="analytics-top-card">{top && <><div className="top-card-kicker"><TrendingUp/><span><b>Top performer</b><small>{providerRegistry.get(top.target.provider).name}</small></span></div>{top.post.mediaUrl ? <img src={top.post.mediaUrl} alt="Top-performing post"/> : <div className="top-card-art"><span className="relay-glyph"><i/><i/></span></div>}<div className="top-card-copy"><p>{top.post.text || "Media post"}</p><span><BrandMark brandId={top.post.brandId} size="small"/>{brands.find((brand) => brand.id === top.post.brandId)?.name ?? "Unassigned"}</span></div><div className="top-card-stats"><span><b>{compactMetric(top.analytics.views ?? 0)}</b><small>Views</small></span><span><b>{compactMetric((top.analytics.likes ?? 0) + (top.analytics.comments ?? 0) + (top.analytics.shares ?? 0))}</b><small>Engagements</small></span></div></>}</article>
    </section>
    <section className="analytics-platforms"><div className="section-heading"><div><p className="eyebrow">Channel mix</p><h3>Performance by platform</h3></div><span>{platforms.length} active channel{platforms.length === 1 ? "" : "s"}</span></div><div>{platforms.map((provider) => <article key={provider.id}><ProviderIcon id={provider.id} selected/><div><b>{provider.name}</b><small>{provider.posts} measured destination{provider.posts === 1 ? "" : "s"}</small></div><span><b>{compactMetric(provider.views)}</b><small>views</small></span><span><b>{compactMetric(provider.interactions)}</b><small>interactions</small></span></article>)}</div></section>
  </div>;
}

function CalendarView({ posts, onCompose, onPostAgain, onDelete }: { posts: RelayPost[]; onCompose: () => void; onPostAgain: (post: RelayPost) => void; onDelete: (post: RelayPost) => void }) {
  const timelinePosts = posts.filter((post) => post.scheduledAt || post.publishedAt || post.createdAt);
  const [mode, setMode] = useState<"Week" | "Month" | "List">("Month");
  const [cursor, setCursor] = useState(() => new Date());
  const today = new Date();
  const dateKey = (date: Date) => `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
  const postTime = (post: RelayPost) => post.scheduledAt ?? post.publishedAt ?? post.createdAt;
  const postsForDate = (date: Date) => timelinePosts.filter((post) => postTime(post) && dateKey(new Date(postTime(post)!)) === dateKey(date));
  const weekStart = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate());
  weekStart.setDate(weekStart.getDate() - ((weekStart.getDay() + 6) % 7));
  const weekDates = Array.from({ length: 7 }, (_, index) => new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + index));
  const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1);
  const calendarStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1 - ((monthStart.getDay() + 6) % 7));
  const monthDates = Array.from({ length: 42 }, (_, index) => new Date(calendarStart.getFullYear(), calendarStart.getMonth(), calendarStart.getDate() + index));
  const label = mode === "List" ? "All saved posts" : mode === "Month"
    ? cursor.toLocaleDateString([], { month: "long", year: "numeric" })
    : `${weekDates[0].toLocaleDateString([], { month: "short", day: "numeric" })}–${weekDates[6].toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`;
  const move = (direction: number) => setCursor((current) => mode === "Month"
    ? new Date(current.getFullYear(), current.getMonth() + direction, 1)
    : new Date(current.getFullYear(), current.getMonth(), current.getDate() + direction * 7));
  return <div className="page page-enter">
    <div className="toolbar"><div className="date-nav">{mode !== "List" && <><button className="secondary-button" onClick={() => setCursor(new Date())}>Today</button><button className="icon-button" aria-label="Previous period" onClick={() => move(-1)}><ChevronLeft /></button><button className="icon-button" aria-label="Next period" onClick={() => move(1)}><ChevronRight /></button></>}<h2>{label}</h2></div><div className="segmented">{(["Month", "Week", "List"] as const).map((item) => <button key={item} className={mode === item ? "active" : ""} onClick={() => setMode(item)}>{item}</button>)}</div></div>
    {mode === "List" ? <div className="list-calendar">{timelinePosts.length > 0 ? timelinePosts.map((post) => <PostRow post={post} onPostAgain={onPostAgain} onDelete={onDelete} key={post.id} />) : <div className="calendar-list-empty"><CalendarDays /><div><b>No saved posts yet</b><span>Scheduled and published posts will remain here.</span></div><button className="secondary-button" onClick={onCompose}><Plus /> Create post</button></div>}</div> : mode === "Month" ? <div className="month-calendar">
      <div className="month-weekdays">{["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((day) => <b key={day}>{day}</b>)}</div>
      <div className="month-grid">{monthDates.map((date) => { const dayPosts = postsForDate(date); const isToday = dateKey(date) === dateKey(today); return <div className={`month-day ${date.getMonth() !== cursor.getMonth() ? "outside" : ""} ${isToday ? "today" : ""}`} key={date.toISOString()}><span>{date.getDate()}</span><div>{dayPosts.slice(0, 3).map((post) => <button key={post.id} title="Create a new post from this one" onClick={() => onPostAgain(post)}><BrandMark brandId={post.brandId} size="small" /><em>{new Date(postTime(post)!).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</em><b>{post.text || "Media post"}</b></button>)}{dayPosts.length > 3 && <small>+{dayPosts.length - 3} more</small>}</div></div>; })}</div>
    </div> : <div className="calendar-shell week-calendar">
      <div className="calendar-head"><span />{weekDates.map((date) => <b key={date.toISOString()} className={dateKey(date) === dateKey(today) ? "today" : ""}>{date.toLocaleDateString([], { weekday: "short", day: "numeric" }).toUpperCase()}</b>)}</div>
      <div className="calendar-grid">{Array.from({ length: 24 }, (_, hour) => <div className="calendar-line" key={hour}><span>{String(hour).padStart(2, "0")}:00</span>{weekDates.map((date) => <div key={date.toISOString()} className="calendar-cell">{postsForDate(date).filter((post) => new Date(postTime(post)!).getHours() === hour).map((post) => <button className={`week-event ${post.status}`} key={post.id} title="Post again" onClick={() => onPostAgain(post)}>{post.text || "Media post"}</button>)}</div>)}</div>)}</div>
    </div>}
  </div>;
}

function settingsSummary(settings: ProviderPostSettings): string {
  if (settings.kind === "instagram") return settings.publishType === "feed" ? "Feed post" : settings.publishType[0].toUpperCase() + settings.publishType.slice(1);
  if (settings.kind === "facebook") return settings.publishType === "feed" ? "Feed post" : "Reel";
  if (settings.kind === "tiktok") return settings.privacyLevel === "SELF_ONLY" ? "Only me" : settings.privacyLevel === "PUBLIC_TO_EVERYONE" ? "Everyone" : settings.privacyLevel === "FOLLOWER_OF_CREATOR" ? "Followers" : "Friends";
  return `${settings.privacyStatus[0].toUpperCase() + settings.privacyStatus.slice(1)} · ${settings.title}`;
}

function PostDetailsModal({ post, onClose, onPostAgain, onDelete }: { post: RelayPost; onClose: () => void; onPostAgain: () => void; onDelete: () => void }) {
  const brands = useBrands();
  const brand = brands.find((item) => item.id === post.brandId);
  const timestamp = post.publishedAt ?? post.scheduledAt ?? post.createdAt;
  return <div className="modal-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close post details" /><section className="post-details-modal" role="dialog" aria-modal="true" aria-labelledby="post-details-title"><header><div><p className="eyebrow">Saved post</p><h2 id="post-details-title">Post details</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X /></button></header><div className="post-details-summary">{post.mediaUrl ? post.mediaType === "video" ? <video src={post.mediaUrl} controls preload="metadata" /> : <img src={post.mediaUrl} alt="Post media" /> : <span><FileText /></span>}<div><Status value={post.status} /><h3>{post.text || "Media post"}</h3><p><BrandMark brandId={post.brandId} size="small" />{brand?.name ?? "Unassigned"}</p>{timestamp && <time>{new Date(timestamp).toLocaleString()}</time>}</div></div><div className="post-target-details"><p className="eyebrow">Destinations</p>{post.targets.map((target) => <article key={target.id}><ProviderIcon id={target.provider} selected /><div><b>{providerRegistry.get(target.provider).name}</b><span>{settingsSummary(target.settings)}</span>{target.analytics && <span className="target-analytics"><em><Eye />{compactMetric(target.analytics.views ?? 0)}</em><em><Heart />{compactMetric(target.analytics.likes ?? 0)}</em><em><MessageCircle />{compactMetric(target.analytics.comments ?? 0)}</em><em><Share2 />{compactMetric(target.analytics.shares ?? 0)}</em></span>}{target.error && <em><CircleAlert />{target.error}</em>}</div><Status value={target.status} />{target.externalUrl && <a className="icon-button" href={target.externalUrl} target="_blank" rel="noreferrer" aria-label={`Open on ${providerRegistry.get(target.provider).name}`}><ExternalLink /></a>}</article>)}</div><footer>{post.status === "scheduled" && <button className="danger-button" onClick={onDelete}><Trash2 /> Cancel schedule</button>}<button className="secondary-button" onClick={onClose}>Close</button><button className="primary-button" onClick={onPostAgain}><RefreshCw /> Post again</button></footer></section></div>;
}

function PostRow({ post, onPostAgain, onDelete }: { post: RelayPost; onPostAgain: (post: RelayPost) => void; onDelete: (post: RelayPost) => void }) {
  const brands = useBrands();
  const brand = brands.find((b) => b.id === post.brandId);
  const timestamp = post.scheduledAt ?? post.publishedAt ?? post.createdAt;
  const [menuOpen, setMenuOpen] = useState(false);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const externalUrl = post.targets.find((target) => target.externalUrl)?.externalUrl;
  return <article className="post-row">
    {post.mediaUrl ? post.mediaType === "video" ? <video src={post.mediaUrl} muted preload="metadata" /> : <img src={post.mediaUrl} alt="" /> : <div className="post-no-media"><FileText /></div>}
    <div className="post-main"><p>{post.text}</p><span><BrandMark brandId={post.brandId} size="small" />{brand?.name ?? "Unassigned"}</span></div>
    <div className="provider-stack">{post.targets.map((target) => <ProviderIcon id={target.provider} key={target.id} />)}</div>
    <div className="post-date"><b>{timestamp ? new Date(timestamp).toLocaleDateString([], { month: "short", day: "numeric" }) : "—"}</b><small>{timestamp ? new Date(timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : "Not scheduled"}</small></div>
    <Status value={post.status} /><button className="icon-button post-menu-trigger" aria-expanded={menuOpen} aria-haspopup="menu" aria-label="Post actions" onClick={() => setMenuOpen((open) => !open)}><MoreHorizontal /></button>
    {menuOpen && <><button className="post-menu-scrim" aria-label="Close post actions" onClick={() => setMenuOpen(false)} /><div className="post-action-menu" role="menu"><button role="menuitem" onClick={() => { setMenuOpen(false); setDetailsOpen(true); }}><FileText /> View details</button><button role="menuitem" onClick={() => { setMenuOpen(false); onPostAgain(post); }}><RefreshCw /> Post again</button>{externalUrl && <a role="menuitem" href={externalUrl} target="_blank" rel="noreferrer"><ExternalLink /> Open on platform</a>}<span /> <button className="danger" role="menuitem" onClick={() => { setMenuOpen(false); onDelete(post); }}><Trash2 /> {post.status === "scheduled" ? "Cancel schedule" : "Delete from Relay"}</button></div></>}
    {detailsOpen && <PostDetailsModal post={post} onClose={() => setDetailsOpen(false)} onPostAgain={() => { setDetailsOpen(false); onPostAgain(post); }} onDelete={() => { setDetailsOpen(false); onDelete(post); }} />}
  </article>;
}

function PostsView({ posts, onPostAgain, onDelete }: { posts: RelayPost[]; onPostAgain: (post: RelayPost) => void; onDelete: (post: RelayPost) => void }) {
  const brands = useBrands();
  const [filter, setFilter] = useState<"all" | PostStatus>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [provider, setProvider] = useState<"all" | ProviderId>("all");
  const [brandId, setBrandId] = useState("all");
  const [mediaFilter, setMediaFilter] = useState<"all" | "with" | "without">("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const activeFilters = Number(provider !== "all") + Number(brandId !== "all") + Number(mediaFilter !== "all") + Number(sort !== "newest");
  const resetFilters = () => { setProvider("all"); setBrandId("all"); setMediaFilter("all"); setSort("newest"); };
  const postTime = (post: RelayPost) => new Date(post.publishedAt ?? post.scheduledAt ?? post.createdAt ?? 0).getTime();
  const shown = posts.filter((post) => filter === "all" || post.status === filter)
    .filter((post) => provider === "all" || post.targets.some((target) => target.provider === provider))
    .filter((post) => brandId === "all" || (brandId === "unassigned" ? !post.brandId : post.brandId === brandId))
    .filter((post) => mediaFilter === "all" || (mediaFilter === "with" ? post.mediaType !== "none" : post.mediaType === "none"))
    .sort((first, second) => sort === "newest" ? postTime(second) - postTime(first) : postTime(first) - postTime(second));
  return <div className="page page-enter"><div className="filterbar"><div className="tabs">{(["all", "draft", "scheduled", "publishing", "processing", "published", "failed"] as const).map((value) => <button className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{value[0].toUpperCase() + value.slice(1)}<span>{value === "all" ? posts.length : posts.filter((p) => p.status === value).length}</span></button>)}</div><button className={`secondary-button filters-trigger ${filtersOpen ? "active" : ""}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}><Grid2X2 /> Filters{activeFilters > 0 && <span>{activeFilters}</span>}</button></div>{filtersOpen && <section className="post-filter-tray" aria-label="Post filters"><div><label>Network<select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}><option value="all">All networks</option>{providerRegistry.list().map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Brand<select value={brandId} onChange={(event) => setBrandId(event.target.value)}><option value="all">All brands</option><option value="unassigned">Unassigned</option>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}</select></label><label>Media<select value={mediaFilter} onChange={(event) => setMediaFilter(event.target.value as typeof mediaFilter)}><option value="all">All posts</option><option value="with">With media</option><option value="without">Text only</option></select></label><label>Order<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div><footer><span>{shown.length} post{shown.length === 1 ? "" : "s"} shown</span><button disabled={activeFilters === 0} onClick={resetFilters}>Reset filters</button><button className="primary-button" onClick={() => setFiltersOpen(false)}>Done</button></footer></section>}<div className="posts-list">{shown.map((post) => <PostRow post={post} onPostAgain={onPostAgain} onDelete={onDelete} key={post.id} />)}{shown.length === 0 && <Empty title="No posts match these filters" body="Adjust or reset the filters to see more posts." />}</div></div>;
}

function AccountsView({ onAccountDeleted }: { onAccountDeleted: (id: string) => void }) {
  const brands = useBrands();
  const accounts = useAccounts();
  const [connect, setConnect] = useState<ProviderId | "choose" | null>(null);
  const [pendingDisconnect, setPendingDisconnect] = useState<SocialAccount | null>(null); const [disconnectBusy, setDisconnectBusy] = useState(false); const [disconnectError, setDisconnectError] = useState("");
  const disconnect = async () => {
    if (!pendingDisconnect) return; setDisconnectBusy(true); setDisconnectError("");
    const response = await fetch("/api/v1/accounts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: pendingDisconnect.id }) });
    if (response.ok) { onAccountDeleted(pendingDisconnect.id); setPendingDisconnect(null); } else setDisconnectError("Relay could not disconnect this account. Please try again.");
    setDisconnectBusy(false);
  };
  const accountRows = (items: SocialAccount[]) => <div className="account-list">{items.map((account) => <article key={account.id}><ProviderIcon id={account.provider} /><div><b>{account.displayName}</b><span>{providerRegistry.get(account.provider).name} · {account.handle}</span></div><div className="followers"><b>{account.tokenExpiresAt ? new Date(account.tokenExpiresAt).toLocaleDateString() : "Managed"}</b><small>token renewal</small></div>{account.status === "expired" ? <button className="status expired status-action" onClick={() => setConnect(account.provider)} title="Reconnect this account"><span />Expired · reconnect</button> : <Status value={account.status} />}<button className="icon-button" aria-label={`Disconnect ${account.displayName}`} title="Disconnect account" onClick={() => { setDisconnectError(""); setPendingDisconnect(account); }}><Trash2 /></button></article>)}</div>;
  const unassigned = accounts.filter((account) => account.brandId === null);
  return <div className="page page-enter"><div className="inline-heading"><div><h2>Connected accounts</h2><p>Connect first. Organize accounts into brands whenever you need to.</p></div><button className="primary-button" onClick={() => setConnect("choose")}><Plus /> Connect account</button></div>{unassigned.length > 0 && <section className="account-group unassigned-group"><div className="brand-header"><span className="brand-mark"><Users /></span><div><h3>Unassigned</h3><p>{unassigned.length} account{unassigned.length === 1 ? "" : "s"} · not in a brand yet</p></div></div>{accountRows(unassigned)}</section>}{brands.map((brand) => { const brandAccounts = accounts.filter((account) => account.brandId === brand.id); if (brandAccounts.length === 0) return null; return <section className="account-group" key={brand.id}><div className="brand-header"><BrandMark brandId={brand.id} /><div><h3>{brand.name}</h3><p>{brandAccounts.length} connected account{brandAccounts.length === 1 ? "" : "s"}</p></div></div>{accountRows(brandAccounts)}</section>; })}{accounts.length === 0 && <Empty title="No accounts connected" body="Connect Instagram, Facebook, TikTok, or YouTube now. Creating a brand is optional." />}{connect && <ConnectModal initialProvider={connect === "choose" ? undefined : connect} onClose={() => setConnect(null)} />}{pendingDisconnect && <ConfirmModal eyebrow="Disconnect account" title={`Disconnect ${pendingDisconnect.displayName}?`} body="Scheduled publishing to this account will stop until it is connected again." confirmLabel="Disconnect" busy={disconnectBusy} error={disconnectError} onClose={() => setPendingDisconnect(null)} onConfirm={() => void disconnect()} />}</div>;
}

interface MediaObject {
  key: string;
  name: string;
  size: number;
  lastModified: string | null;
  etag: string | null;
  url: string;
}

interface MediaProject { id: string; name: string; count: number; createdAt: string }

interface ComposerMedia {
  name: string;
  url: string;
  previewUrl: string;
  type: "image" | "video";
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

function MediaView({ onCompose }: { onCompose: (media: ComposerMedia) => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<MediaObject[]>([]);
  const [projects, setProjects] = useState<MediaProject[]>([]); const [projectId, setProjectId] = useState("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false); const [projectName, setProjectName] = useState(""); const [projectBusy, setProjectBusy] = useState(false); const [projectError, setProjectError] = useState("");
  const [renameItem, setRenameItem] = useState<MediaObject | null>(null); const [renameName, setRenameName] = useState("");
  const [deleteItem, setDeleteItem] = useState<MediaObject | null>(null);

  const loadProjects = async () => {
    try { const response = await fetch("/api/v1/media/projects", { cache: "no-store" }); const payload = await response.json() as { data?: MediaProject[]; error?: string }; if (!response.ok) throw new Error(payload.error || "Could not load media projects"); setProjects(payload.data ?? []); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load media projects"); }
  };

  const load = async (pageCursor: string | null) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ limit: "24" });
      if (pageCursor) params.set("cursor", pageCursor);
      params.set("project", projectId);
      const response = await fetch(`/api/v1/media?${params}`, { cache: "no-store" });
      const payload = await response.json() as { data?: MediaObject[]; pagination?: { nextCursor?: string | null }; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load media");
      setItems(payload.data ?? []); setNextCursor(payload.pagination?.nextCursor ?? null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load media"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadProjects(); }, []);
  useEffect(() => { void load(cursor); }, [cursor, projectId]);

  const upload = async (file: File) => {
    setBusyKey("upload"); setError("");
    try {
      const uploadProjectId = projectId !== "all" && projectId !== "unfiled" ? projectId : undefined;
      const signedResponse = await fetch("/api/v1/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: file.type, projectId: uploadProjectId }) });
      const signed = await signedResponse.json() as { uploadUrl?: string; error?: string };
      if (!signedResponse.ok || !signed.uploadUrl) throw new Error(signed.error || "Could not prepare upload");
      let uploadedDirectly = false;
      try {
        const uploadResponse = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        uploadedDirectly = uploadResponse.ok;
      } catch { uploadedDirectly = false; }
      if (!uploadedDirectly) {
        const form = new FormData(); form.append("file", file); if (uploadProjectId) form.append("projectId", uploadProjectId);
        const fallbackResponse = await fetch("/api/v1/media", { method: "POST", body: form });
        const fallback = await fallbackResponse.json() as { error?: string };
        if (!fallbackResponse.ok) throw new Error(fallback.error || "R2 rejected the upload");
      }
      setCursor(null); setHistory([]); await Promise.all([load(null), loadProjects()]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Upload failed"); }
    finally { setBusyKey(null); if (inputRef.current) inputRef.current.value = ""; }
  };

  const rename = async () => {
    if (!renameItem || !renameName.trim() || renameName.trim() === renameItem.name) { setRenameItem(null); return; }
    setBusyKey(renameItem.key); setError("");
    try {
      const response = await fetch("/api/v1/media", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: renameItem.key, name: renameName.trim() }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not rename media");
      setRenameItem(null); await load(cursor);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Rename failed"); }
    finally { setBusyKey(null); }
  };

  const remove = async () => {
    if (!deleteItem) return;
    setBusyKey(deleteItem.key); setError("");
    try {
      const response = await fetch("/api/v1/media", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: deleteItem.key }) });
      if (!response.ok) { const payload = await response.json() as { error?: string }; throw new Error(payload.error || "Could not delete media"); }
      setDeleteItem(null); await Promise.all([load(cursor), loadProjects()]);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Delete failed"); }
    finally { setBusyKey(null); }
  };

  const createProject = async () => {
    if (!projectName.trim()) return; setProjectBusy(true); setProjectError("");
    try { const response = await fetch("/api/v1/media/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: projectName }) }); const payload = await response.json() as { data?: MediaProject; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error || "Could not create the project"); setProjects((current) => [...current, payload.data!].sort((a, b) => a.name.localeCompare(b.name))); setProjectId(payload.data.id); setCursor(null); setHistory([]); setCreateOpen(false); setProjectName(""); }
    catch (cause) { setProjectError(cause instanceof Error ? cause.message : "Could not create the project"); }
    finally { setProjectBusy(false); }
  };

  const chooseProject = (next: string) => { setProjectId(next); setCursor(null); setHistory([]); };
  const selectedName = projectId === "all" ? "All media" : projectId === "unfiled" ? "Unsorted" : projects.find((project) => project.id === projectId)?.name ?? "Media project";

  return <div className="page page-enter"><div className="inline-heading"><div><h2>Media library</h2><p>Organize Cloudflare media into projects for apps, brands, and campaigns.</p></div><button className="primary-button" disabled={busyKey === "upload"} onClick={() => inputRef.current?.click()}>{busyKey === "upload" ? <LoaderCircle className="spin" /> : <Upload />} {busyKey === "upload" ? "Uploading…" : `Upload to ${selectedName}`}</button><input ref={inputRef} className="visually-hidden" type="file" accept="image/*,video/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void upload(file); }} /></div>
    <section className="media-projects"><header><div><p className="eyebrow">R2 projects</p><h3>Choose a workspace</h3></div><button className="secondary-button" onClick={() => { setProjectName(""); setProjectError(""); setCreateOpen(true); }}><Plus /> New project</button></header><div><button className={projectId === "all" ? "active" : ""} onClick={() => chooseProject("all")}><span><Images /></span><b>All media</b><small>Everything in R2</small></button><button className={projectId === "unfiled" ? "active" : ""} onClick={() => chooseProject("unfiled")}><span><FolderOpen /></span><b>Unsorted</b><small>Existing and loose files</small></button>{projects.map((project) => <button className={projectId === project.id ? "active" : ""} onClick={() => chooseProject(project.id)} key={project.id}><span><Folder /></span><b>{project.name}</b><small>{project.count} item{project.count === 1 ? "" : "s"}</small></button>)}</div></section>
    {error && <div className="media-error"><CircleAlert />{error}<button onClick={() => void load(cursor)}>Retry</button></div>}
    {loading ? <div className="media-loading"><LoaderCircle className="spin" />Loading media from R2…</div> : items.length === 0 ? <Empty title={`${selectedName} is empty`} body="Upload an image or video here, or choose another media project." /> : <div className="media-grid">{items.map((item) => { const kind = mediaKind(item.name); const busy = busyKey === item.key; return <article key={item.key}><div className="media-image">{kind === "image" ? <img src={item.url} alt={item.name} loading="lazy" /> : kind === "video" ? <video src={item.url} preload="metadata" muted /> : <span className="media-file"><FileIcon /></span>}<span>{kind === "video" ? <Video /> : kind === "image" ? <ImageIcon /> : <FileIcon />}{kind}</span><div className="media-actions"><button className="icon-button" disabled={busy} onClick={() => { setRenameItem(item); setRenameName(item.name); }} aria-label={`Rename ${item.name}`}><Pencil /></button><button className="icon-button danger" disabled={busy} onClick={() => setDeleteItem(item)} aria-label={`Delete ${item.name}`}>{busy ? <LoaderCircle className="spin" /> : <Trash2 />}</button></div></div><div><b title={item.key}>{item.name}</b><span>{formatBytes(item.size)}{item.lastModified ? ` · ${new Date(item.lastModified).toLocaleDateString()}` : ""}</span></div>{kind === "file" ? <button className="secondary-button" disabled>Unsupported file</button> : <button className="secondary-button" onClick={() => onCompose({ name: item.name, url: item.url, previewUrl: item.url, type: kind })}>Use in post</button>}</article>; })}</div>}
    <div className="media-pagination"><button className="secondary-button" disabled={loading || history.length === 0} onClick={() => { const previous = history.at(-1) ?? null; setHistory((current) => current.slice(0, -1)); setCursor(previous); }}><ChevronLeft /> Previous</button><span><Cloud />Page {history.length + 1}</span><button className="secondary-button" disabled={loading || !nextCursor} onClick={() => { setHistory((current) => [...current, cursor]); setCursor(nextCursor); }}>Next <ChevronRight /></button></div>
    {createOpen && <PromptModal title="Create a media project" body="Give this collection a name—an app, brand, client, campaign, or anything else." value={projectName} placeholder="e.g. Racketly" confirmLabel="Create project" busy={projectBusy} error={projectError} onChange={setProjectName} onClose={() => setCreateOpen(false)} onConfirm={() => void createProject()} />}
    {renameItem && <PromptModal title="Rename media" body="Update the file name without changing where it is used." value={renameName} confirmLabel="Save name" busy={busyKey === renameItem.key} onChange={setRenameName} onClose={() => setRenameItem(null)} onConfirm={() => void rename()} />}
    {deleteItem && <ConfirmModal eyebrow="Delete media" title={`Delete ${deleteItem.name}?`} body="This permanently removes the file from Cloudflare. Posts already using this URL may lose their media." confirmLabel="Delete media" busy={busyKey === deleteItem.key} onClose={() => setDeleteItem(null)} onConfirm={() => void remove()} />}
  </div>;
}

function BrandModal({ brand, onClose, onSaved }: { brand?: Brand; onClose: () => void; onSaved: (brand: Brand, assignments: { id: string; brandId: string }[]) => void }) {
  const colors = ["#ff5c35", "#d9468f", "#1877f2", "#25875a", "#8a5cf5", "#d18b22"];
  const brands = useBrands(); const accounts = useAccounts();
  const editing = Boolean(brand);
  const [name, setName] = useState(brand?.name ?? "");
  const [color, setColor] = useState(brand?.color ?? colors[0]);
  const [timezone, setTimezone] = useState(() => brand?.timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"));
  const [selectedAccounts, setSelectedAccounts] = useState(() => accounts.filter((account) => account.brandId === brand?.id).map((account) => account.id));
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const monogram = name.trim().split(/\s+/).filter(Boolean).map((part) => part[0]).join("").slice(0, 2).toUpperCase() || "R";

  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault(); setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/brands", { method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: brand?.id, name, color, timezone, accountIds: selectedAccounts }) });
      const payload = await response.json() as { data?: Brand; accountAssignments?: { id: string; brandId: string }[]; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error || `Could not ${editing ? "update" : "create"} the brand.`);
      onSaved(payload.data, payload.accountAssignments ?? []); onClose();
    } catch (reason) { setError(reason instanceof Error ? reason.message : `Could not ${editing ? "update" : "create"} the brand.`); setBusy(false); }
  };

  return <div className="modal-layer"><button className="modal-scrim" disabled={busy} onClick={onClose} aria-label={`Cancel brand ${editing ? "editing" : "creation"}`} /><form className="brand-modal" onSubmit={submit}><header><div><p className="eyebrow">{editing ? "Brand settings" : "New brand"}</p><h2>{editing ? "Edit brand workspace" : "Create a brand workspace"}</h2></div><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="Close"><X /></button></header><p className="brand-definition">A brand optionally groups the social accounts, timezone, and publishing defaults for one project or identity.</p><div className="brand-form-preview" style={{ "--brand": color } as React.CSSProperties}><span>{monogram}</span><div><b>{name.trim() || "Your brand"}</b><small>{timezone} · {selectedAccounts.length} account{selectedAccounts.length === 1 ? "" : "s"}</small></div></div><label htmlFor="brand-name">Brand name</label><input id="brand-name" autoFocus required maxLength={60} value={name} onChange={(event) => setName(event.target.value)} placeholder="Acme Studio" /><label>Brand color</label><div className="color-options">{colors.map((value) => <button type="button" key={value} className={color === value ? "active" : ""} style={{ "--swatch": value } as React.CSSProperties} aria-label={`Use color ${value}`} aria-pressed={color === value} onClick={() => setColor(value)}><span /></button>)}</div><label htmlFor="brand-timezone">Timezone</label><input id="brand-timezone" required value={timezone} onChange={(event) => setTimezone(event.target.value)} placeholder="Europe/Madrid" /><small className="field-help">Used when scheduling posts for every account in this brand.</small><div className="brand-account-heading"><span><b>Social accounts</b><small>Selecting an account moves it from its current brand.</small></span><em>{selectedAccounts.length} selected</em></div><div className="brand-account-picker">{accounts.map((account) => { const locked = account.brandId === brand?.id; const selected = selectedAccounts.includes(account.id); const currentBrand = brands.find((item) => item.id === account.brandId); return <button type="button" className={selected ? "selected" : ""} disabled={locked || busy} key={account.id} onClick={() => setSelectedAccounts(selected ? selectedAccounts.filter((id) => id !== account.id) : [...selectedAccounts, account.id])}><span className="check-box">{selected && <Check />}</span><ProviderIcon id={account.provider} selected={selected} /><span><b>{account.displayName}</b><small>{account.handle} · {locked ? "Already in this brand" : currentBrand ? `Currently in ${currentBrand.name}` : "Currently unassigned"}</small></span>{locked && <em>Assigned</em>}</button>; })}{accounts.length === 0 && <p>No connected accounts yet. You can connect one before or after creating the brand.</p>}</div>{error && <p className="auth-error" role="alert">{error}</p>}<footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !name.trim()}>{busy ? <LoaderCircle className="spin" /> : editing ? <Check /> : <Plus />}{busy ? "Saving…" : editing ? "Save brand" : "Create brand"}</button></footer></form></div>;
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
  return <div className="modal-layer"><button className="modal-scrim" disabled={busy} onClick={onClose} aria-label="Cancel brand deletion" /><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-brand-title" aria-describedby="delete-brand-description"><span className="confirm-icon"><Trash2 /></span><div><p className="eyebrow">Delete brand</p><h2 id="delete-brand-title">Delete {brand.name}?</h2><p id="delete-brand-description">Connected accounts will stay connected and move to Unassigned. The brand itself cannot be recovered.</p></div>{error && <p className="auth-error" role="alert">{error}</p>}<footer><button className="secondary-button" disabled={busy} onClick={onClose}>Keep brand</button><button className="danger-button" disabled={busy} onClick={() => void remove()}>{busy ? <LoaderCircle className="spin" /> : <Trash2 />}{busy ? "Deleting…" : "Delete brand"}</button></footer></section></div>;
}

function BrandsView({ onBrandCreated, onBrandUpdated, onBrandDeleted, onAccountsAssigned }: { onBrandCreated: (brand: Brand) => void; onBrandUpdated: (brand: Brand) => void; onBrandDeleted: (id: string) => void; onAccountsAssigned: (assignments: { id: string; brandId: string }[]) => void }) {
  const brands = useBrands(); const accounts = useAccounts(); const [creating, setCreating] = useState(false); const [editing, setEditing] = useState<Brand | null>(null); const [deleting, setDeleting] = useState<Brand | null>(null);
  const saved = (callback: (brand: Brand) => void) => (brand: Brand, assignments: { id: string; brandId: string }[]) => { callback(brand); onAccountsAssigned(assignments); };
  return <div className="page page-enter"><div className="inline-heading"><div><h2>Brands</h2><p>A brand is an optional workspace for one project’s accounts, timezone, and publishing defaults.</p></div><button className="primary-button" onClick={() => setCreating(true)}><Plus /> New brand</button></div><div className="brand-explainer"><span><LayoutGrid /></span><div><b>Organize only when it helps</b><p>Accounts can remain unassigned. Create a brand later to group or move Instagram, Facebook, TikTok, and YouTube accounts.</p></div></div>{brands.length === 0 ? <Empty title="No brands yet" body="Brands are optional. Create one whenever you want to organize connected accounts." /> : <div className="brand-grid">{brands.map((brand) => <article key={brand.id}><div className="brand-cover" style={{ "--brand": brand.color } as React.CSSProperties}><BrandMark brandId={brand.id} size="large" /></div><div><h3>{brand.name}</h3><p>{accounts.filter((account) => account.brandId === brand.id).length} accounts · {brand.timezone}</p><div className="provider-stack">{accounts.filter((account) => account.brandId === brand.id).map((account) => <ProviderIcon id={account.provider} key={account.id} />)}</div></div><BrandActions brand={brand} onEdit={() => setEditing(brand)} onDelete={() => setDeleting(brand)} /></article>)}</div>}{creating && <BrandModal onClose={() => setCreating(false)} onSaved={saved(onBrandCreated)} />}{editing && <BrandModal brand={editing} onClose={() => setEditing(null)} onSaved={saved(onBrandUpdated)} />}{deleting && <DeleteBrandModal brand={deleting} onClose={() => setDeleting(null)} onDeleted={onBrandDeleted} />}</div>;
}

type SettingsSection = "General" | "Workspace" | "API keys" | "Storage" | "Providers" | "System" | "Appearance";

interface AgentApiKey {
  id: string;
  name: string;
  prefix: string;
  scopes: string[];
  lastUsedAt: string | null;
  createdAt: string;
}

function ApiKeysSettings() {
  const [keys, setKeys] = useState<AgentApiKey[]>([]);
  const [name, setName] = useState("My agent");
  const [secret, setSecret] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState(false);
  const [pendingRevoke, setPendingRevoke] = useState<AgentApiKey | null>(null);

  useEffect(() => {
    void fetch("/api/v1/api-keys", { cache: "no-store" }).then(async (response) => {
      const payload = await response.json() as { data?: AgentApiKey[]; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load API keys.");
      setKeys(payload.data ?? []);
    }).catch((reason) => setError(reason instanceof Error ? reason.message : "Could not load API keys.")).finally(() => setLoading(false));
  }, []);

  const createKey = async () => {
    if (!name.trim()) return;
    setBusy(true); setError(""); setSecret("");
    try {
      const response = await fetch("/api/v1/api-keys", { method: "POST", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      const payload = await response.json() as { data?: AgentApiKey & { secret: string }; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error || "Could not create the API key.");
      const { secret: createdSecret, ...created } = payload.data;
      setKeys((current) => [created, ...current]); setSecret(createdSecret); setName("My agent");
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not create the API key."); }
    finally { setBusy(false); }
  };

  const revoke = async () => {
    if (!pendingRevoke) return; const key = pendingRevoke;
    setError("");
    try {
      const response = await fetch("/api/v1/api-keys", { method: "DELETE", credentials: "same-origin", cache: "no-store", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: key.id }) });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Could not revoke the API key.");
      setKeys((current) => current.filter((item) => item.id !== key.id)); setPendingRevoke(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not revoke the API key."); }
  };

  const copySecret = async () => {
    await navigator.clipboard.writeText(secret);
    setCopied(true); window.setTimeout(() => setCopied(false), 2_000);
  };

  return <>
    <p>Create a limited credential for Codex, Claude, or another trusted agent. It can manage posts and read destination IDs, but cannot change your account or provider connections.</p>
    <div className="api-key-create"><input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="Key name" aria-label="API key name" /><button className="primary-button" disabled={busy || !name.trim()} onClick={() => void createKey()}>{busy ? <LoaderCircle className="spin" /> : <Plus />}{busy ? "Creating…" : "Create key"}</button></div>
    {secret && <div className="api-key-secret" role="status"><b>Copy this key now—it will not be shown again.</b><code>{secret}</code><button className="secondary-button" onClick={() => void copySecret()}>{copied ? <Check /> : <KeyRound />}{copied ? "Copied" : "Copy key"}</button></div>}
    {error && <p className="auth-error" role="alert">{error}</p>}
    <div className="settings-stack">{loading ? <article className="settings-card"><LoaderCircle className="spin" /><div><b>Loading API keys…</b></div></article> : keys.map((key) => <article className="settings-card" key={key.id}><span className="settings-card-icon"><KeyRound /></span><div><b>{key.name}</b><small>{key.prefix} · Created {new Date(key.createdAt).toLocaleDateString()}{key.lastUsedAt ? ` · Last used ${new Date(key.lastUsedAt).toLocaleString()}` : " · Never used"}</small></div><button className="icon-button" aria-label={`Revoke ${key.name}`} onClick={() => setPendingRevoke(key)}><Trash2 /></button></article>)}{!loading && keys.length === 0 && <article className="settings-card"><span className="settings-card-icon"><ShieldCheck /></span><div><b>No agent keys</b><small>Create one when you are ready to connect an agent.</small></div></article>}</div>
    {pendingRevoke && <ConfirmModal eyebrow="Agent access" title={`Revoke “${pendingRevoke.name}”?`} body="Any agent using this key will immediately lose access to Relay." confirmLabel="Revoke key" onClose={() => setPendingRevoke(null)} onConfirm={() => void revoke()} />}
    <p className="settings-footnote">Send the key as <code>Authorization: Bearer relay_sk_…</code>. Treat it like a password and revoke it immediately if exposed.</p>
  </>;
}

function DeleteAccountModal({ email, onClose }: { email: string; onClose: () => void }) {
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const confirmed = confirmation.trim().toLowerCase() === email.trim().toLowerCase();

  const remove = async () => {
    if (!confirmed) return;
    setBusy(true); setError("");
    try {
      const response = await fetch("/api/v1/account", {
        method: "DELETE",
        credentials: "same-origin",
        cache: "no-store",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ confirmation }),
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok) throw new Error(payload?.error || "Relay could not delete your account.");
      window.location.replace("/login");
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Relay could not delete your account.");
      setBusy(false);
    }
  };

  return <div className="modal-layer"><button className="modal-scrim" disabled={busy} onClick={onClose} aria-label="Cancel account deletion" /><section className="confirm-modal delete-account-modal" role="alertdialog" aria-modal="true" aria-labelledby="delete-account-title" aria-describedby="delete-account-description"><span className="confirm-icon"><Trash2 /></span><div><p className="eyebrow">Permanent deletion</p><h2 id="delete-account-title">Delete your Relay account?</h2><p id="delete-account-description">Your profile, sessions, credentials, brands, and connected social accounts will be permanently removed from the database. This cannot be undone.</p></div><label className="confirmation-field" htmlFor="delete-account-confirmation"><span>Type <b>{email}</b> to confirm</span><input id="delete-account-confirmation" type="email" autoFocus autoComplete="off" spellCheck={false} disabled={busy} value={confirmation} onChange={(event) => setConfirmation(event.target.value)} /></label>{error && <p className="auth-error" role="alert">{error}</p>}<footer><button className="secondary-button" disabled={busy} onClick={onClose}>Keep my account</button><button className="danger-button" disabled={busy || !confirmed} onClick={() => void remove()}>{busy ? <LoaderCircle className="spin" /> : <Trash2 />}{busy ? "Deleting everything…" : "Delete account"}</button></footer></section></div>;
}

function SettingsView({ theme, setTheme, go, user }: { theme: string; setTheme: (value: string) => void; go: (view: View) => void; user: { name: string; email: string; role: string } }) {
  const accounts = useAccounts();
  const sections: SettingsSection[] = ["General", "Workspace", "API keys", "Storage", "Providers", "System", "Appearance"];
  const [section, setSection] = useState<SettingsSection>("General");
  const [health, setHealth] = useState<"idle" | "checking" | "healthy" | "error">("idle");
  const [deleteAccount, setDeleteAccount] = useState(false);

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
      {section === "General" && <><p>Your account and local Relay preferences.</p><div className="settings-stack"><article className="settings-card"><span className="settings-card-icon"><Users /></span><div><b>{user.name}</b><small>{user.email}</small></div><Status value="connected" /></article><article className="settings-card"><span className="settings-card-icon"><Clock3 /></span><div><b>Local timezone</b><small>{Intl.DateTimeFormat().resolvedOptions().timeZone}</small></div></article><article className="settings-card"><span className="settings-card-icon"><ShieldCheck /></span><div><b>Session security</b><small>Signed sessions renew during use and expire after 30 days.</small></div></article></div><div className="danger-zone"><div><p className="eyebrow">Danger zone</p><h3>Delete account</h3><span>Permanently remove your profile and all of its related database records.</span></div><button className="danger-outline-button" onClick={() => setDeleteAccount(true)}><Trash2 /> Delete account</button></div></>}
      {section === "Workspace" && <><p>Relay’s optional brands and workspace membership.</p><div className="system-card"><div><span className="workspace-avatar">R</span><b>Relay · Personal workspace</b></div><p>You are signed in as {user.role === "OWNER" ? "the workspace owner" : "a workspace member"}. Brands optionally group social destinations and publishing defaults.</p><button className="secondary-button" onClick={() => go("brands")}><LayoutGrid /> Manage brands</button></div></>}
      {section === "API keys" && <ApiKeysSettings />}
      {section === "Storage" && <><p>Media is stored in the configured Cloudflare R2 bucket.</p><div className="system-card"><div><Cloud /><b>Cloudflare R2</b></div><p>R2 is Relay’s fixed media backend. Files remain available independently of this Docker container.</p><button className="secondary-button" onClick={() => go("media")}><ImageIcon /> Open media library</button></div></>}
      {section === "Providers" && <><p>Publishing destinations available to this Relay installation.</p><div className="settings-stack">{providerRegistry.list().map((provider) => { const count = accounts.filter((account) => account.provider === provider.id).length; return <article className="settings-card" key={provider.id}><ProviderIcon id={provider.id} /><div><b>{provider.name}</b><small>{count === 0 ? "No connected accounts" : `${count} connected account${count === 1 ? "" : "s"}`}</small></div><Status value={count > 0 ? "connected" : "warning"} /></article>; })}</div><button className="secondary-button settings-action" onClick={() => go("accounts")}><Plus /> Manage connections</button></>}
      {section === "System" && <><p>Check the running web service without exposing configuration or secrets.</p><div className={`system-card health-${health}`}><div><span className="pulse" /><b>{health === "checking" ? "Checking Relay…" : health === "healthy" ? "Relay is healthy" : health === "error" ? "Relay did not respond" : "System status"}</b></div><p>{health === "healthy" ? "The authenticated dashboard and health endpoint are responding normally." : health === "error" ? "The health request failed. Check the web container logs." : "Run a fresh check against this deployment."}</p><button className="secondary-button" disabled={health === "checking"} onClick={() => void checkHealth()}>{health === "checking" ? <LoaderCircle className="spin" /> : <RefreshCw />} {health === "checking" ? "Checking…" : "Run health check"}</button></div></>}
      {section === "Appearance" && <><p>Choose how Relay looks on this device.</p><div className="theme-options">{["light", "dark"].map((value) => <button className={theme === value ? "active" : ""} onClick={() => setTheme(value)} key={value}>{value === "light" ? <Sun /> : <Moon />}<span><b>{value[0].toUpperCase() + value.slice(1)}</b><small>{value === "light" ? "Bright and calm" : "Easy on the eyes"}</small></span>{theme === value && <Check />}</button>)}</div></>}
    </section>{deleteAccount && <DeleteAccountModal email={user.email} onClose={() => setDeleteAccount(false)} />}
  </div>;
}

function Empty({ title, body }: { title: string; body: string }) { return <div className="empty"><span><Sparkles /></span><h3>{title}</h3><p>{body}</p></div>; }

function ConnectModal({ onClose, initialProvider }: { onClose: () => void; initialProvider?: ProviderId }) {
  const brands = useBrands();
  const [selected, setSelected] = useState<ProviderId | null>(initialProvider ?? null);
  const [brandId, setBrandId] = useState("");
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
  const begin = (flow: string) => { const query = brandId ? `?brandId=${encodeURIComponent(brandId)}` : ""; window.location.assign(`/api/oauth/${encodeURIComponent(flow)}/start${query}`); };
  return <div className="modal-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close account connection" /><div className="connect-modal" role="dialog" aria-modal="true" aria-labelledby="connect-title"><div className="modal-title"><div><p className="eyebrow">New destination</p><h2 id="connect-title">Connect an account</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X /></button></div><p>Choose a network, then authorize Relay on its secure provider page.</p><label className="connect-brand">Organize in <span>optional</span><select value={brandId} onChange={(event) => setBrandId(event.target.value)}><option value="">No brand — organize later</option>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}</select></label>{brands.length === 0 && <p className="connect-note"><LayoutGrid />You do not need a brand to connect an account.</p>}{error && <p className="auth-error" role="alert">{error}</p>}<div className="connect-list" aria-busy={loading}>{providerRegistry.list().map((item) => { const configured = providerConfig[item.id]?.configured; return <button key={item.id} disabled={loading} aria-pressed={selected === item.id} onClick={() => setSelected(item.id)}><ProviderIcon id={item.id} selected /><span><b>{item.name}</b><small>{loading ? "Checking configuration…" : configured ? "Ready to connect" : "OAuth keys are not configured"}</small></span><ChevronRight /></button>; })}</div>{provider && <div className="connection-panel"><div><ProviderIcon id={provider.id} selected /><span><b>Connect {provider.name}</b><small>{options.some((option) => option.configured) ? "You’ll return to Relay automatically after authorization." : "Add this provider’s OAuth keys and restart Relay."}</small></span></div>{options.map((option) => <button className="primary-button" key={option.flow} disabled={!option.configured} onClick={() => begin(option.flow)}>{connectLabel(option.flow)}<ChevronRight /></button>)}</div>}<p className="safe-note"><Zap /> Tokens are encrypted at rest and never exposed to the browser.</p></div></div>;
}

function LogoutModal({ busy, error, onClose, onConfirm }: { busy: boolean; error: string; onClose: () => void; onConfirm: () => void }) {
  return <div className="modal-layer"><button className="modal-scrim" onClick={busy ? undefined : onClose} aria-label="Cancel sign out" /><section className="confirm-modal" role="alertdialog" aria-modal="true" aria-labelledby="logout-title" aria-describedby="logout-description"><span className="confirm-icon"><LogOut /></span><div><p className="eyebrow">End session</p><h2 id="logout-title">Sign out of Relay?</h2><p id="logout-description">You’ll need your email and password to access the dashboard again.</p></div>{error && <p className="auth-error" role="alert">{error}</p>}<footer><button className="secondary-button" disabled={busy} onClick={onClose}>Stay signed in</button><button className="danger-button" disabled={busy} onClick={onConfirm}>{busy ? <LoaderCircle className="spin" /> : <LogOut />}{busy ? "Signing out…" : "Sign out"}</button></footer></section></div>;
}

function ComposerMediaLibrary({ onClose, onSelect }: { onClose: () => void; onSelect: (media: ComposerMedia) => void }) {
  const [items, setItems] = useState<MediaObject[]>([]);
  const [projects, setProjects] = useState<MediaProject[]>([]); const [projectId, setProjectId] = useState("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { void fetch("/api/v1/media/projects", { cache: "no-store" }).then(async (response) => { const payload = await response.json() as { data?: MediaProject[] }; if (response.ok) setProjects(payload.data ?? []); }); }, []);

  useEffect(() => {
    const controller = new AbortController();
    const params = new URLSearchParams({ limit: "12" });
    if (cursor) params.set("cursor", cursor);
    params.set("project", projectId);
    setLoading(true); setError("");
    void fetch(`/api/v1/media?${params}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as { data?: MediaObject[]; pagination?: { nextCursor?: string | null }; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load the media library");
      setItems(payload.data ?? []); setNextCursor(payload.pagination?.nextCursor ?? null);
    }).catch((reason) => { if (reason instanceof DOMException && reason.name === "AbortError") return; setError(reason instanceof Error ? reason.message : "Could not load the media library"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cursor, projectId]);

  return <div className="modal-layer media-picker-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close media library" /><section className="media-picker" role="dialog" aria-modal="true" aria-labelledby="media-picker-title"><header><div><p className="eyebrow">Cloudflare R2</p><h2 id="media-picker-title">Choose from your library</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X /></button></header><label className="media-project-select"><Folder />Media project<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setCursor(null); setHistory([]); }}><option value="all">All media</option><option value="unfiled">Unsorted</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>{error && <div className="media-error"><CircleAlert />{error}</div>}{loading ? <div className="media-loading"><LoaderCircle className="spin" />Loading your media…</div> : items.length === 0 ? <Empty title="This media project is empty" body="Upload from your device or choose another project." /> : <div className="media-picker-grid">{items.map((item) => { const kind = mediaKind(item.name); if (kind === "file") return null; return <button key={item.key} onClick={() => onSelect({ name: item.name, url: item.url, previewUrl: item.url, type: kind })}><span>{kind === "image" ? <img src={item.url} alt="" /> : <video src={item.url} muted preload="metadata" />}</span><b>{item.name}</b><small>{formatBytes(item.size)} · {kind}</small></button>; })}</div>}<footer><button className="secondary-button" disabled={loading || history.length === 0} onClick={() => { const previous = history.at(-1) ?? null; setHistory((current) => current.slice(0, -1)); setCursor(previous); }}><ChevronLeft /> Previous</button><span>Page {history.length + 1}</span><button className="secondary-button" disabled={loading || !nextCursor} onClick={() => { setHistory((current) => [...current, cursor]); setCursor(nextCursor); }}>Next <ChevronRight /></button></footer></section></div>;
}

function Composer({ onClose, onCreate, initialMedia = null, initialPost = null }: { onClose: () => void; onCreate: (post: RelayPost) => Promise<boolean>; initialMedia?: ComposerMedia | null; initialPost?: RelayPost | null }) {
  const brands = useBrands();
  const accounts = useAccounts();
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const scheduleInputRef = useRef<HTMLInputElement>(null);
  const localPreviewRef = useRef<string | null>(null);
  const reusableBrandId = initialPost && brands.some((brand) => brand.id === initialPost.brandId) ? initialPost.brandId : initialPost?.brandId === "" ? "" : brands[0]?.id ?? "";
  const reusableTargets = initialPost?.targets.filter((target) => accounts.some((account) => account.id === target.accountId && account.brandId === (reusableBrandId || null))) ?? [];
  const reusableSetting = <T extends ProviderPostSettings["kind"],>(kind: T) => reusableTargets.find((target) => target.settings.kind === kind)?.settings as Extract<ProviderPostSettings, { kind: T }> | undefined;
  const instagramDefaults = reusableSetting("instagram");
  const facebookDefaults = reusableSetting("facebook");
  const tiktokDefaults = reusableSetting("tiktok");
  const youtubeDefaults = reusableSetting("youtube");
  const reusableMedia = initialMedia ?? (initialPost?.mediaUrl && initialPost.mediaType !== "none" ? { name: initialPost.mediaUrl.split("/").at(-1) || "Saved media", url: initialPost.mediaUrl, previewUrl: initialPost.mediaUrl, type: initialPost.mediaType } : null);
  const [text, setText] = useState(initialPost?.text ?? ""); const [brandId, setBrandId] = useState(reusableBrandId);
  const available = accounts.filter((account) => account.brandId === (brandId || null));
  const [selected, setSelected] = useState<string[]>(reusableTargets.map((target) => target.accountId));
  const [previewMode, setPreviewMode] = useState<"feed" | "mobile">("feed");
  const [instagramType, setInstagramType] = useState<"feed" | "reel" | "story">(instagramDefaults?.publishType ?? "feed");
  const [facebookType, setFacebookType] = useState<"feed" | "reel">(facebookDefaults?.publishType ?? "feed");
  const [facebookLink, setFacebookLink] = useState(facebookDefaults?.linkUrl ?? "");
  const [tiktokPrivacy, setTiktokPrivacy] = useState<"PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY">(tiktokDefaults?.privacyLevel ?? "SELF_ONLY");
  const [tiktokComments, setTiktokComments] = useState(tiktokDefaults?.allowComments ?? true);
  const [tiktokDuet, setTiktokDuet] = useState(tiktokDefaults?.allowDuet ?? false);
  const [tiktokStitch, setTiktokStitch] = useState(tiktokDefaults?.allowStitch ?? false);
  const [youtubeTitle, setYoutubeTitle] = useState(youtubeDefaults?.title ?? "");
  const [youtubeTags, setYoutubeTags] = useState(youtubeDefaults?.tags.join(", ") ?? "");
  const [youtubePrivacy, setYoutubePrivacy] = useState<"private" | "unlisted" | "public">(youtubeDefaults?.privacyStatus ?? "private");
  const [youtubeMadeForKids, setYoutubeMadeForKids] = useState(youtubeDefaults?.madeForKids ?? false);
  const [media, setMedia] = useState<ComposerMedia | null>(reusableMedia);
  const [mediaSource, setMediaSource] = useState<"choose" | "library" | null>(null);
  const [mediaBusy, setMediaBusy] = useState(false); const [mediaError, setMediaError] = useState("");
  const [schedule, setSchedule] = useState(true);
  const [scheduledAt, setScheduledAt] = useState(() => { const date = new Date(); date.setDate(date.getDate() + 1); date.setHours(9, 30, 0, 0); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); });
  const [saved, setSaved] = useState(true);
  const [submitBusy, setSubmitBusy] = useState(false); const [submitError, setSubmitError] = useState("");
  useEffect(() => { setSaved(false); const timeout = setTimeout(() => setSaved(true), 700); return () => clearTimeout(timeout); }, [text]);
  useEffect(() => () => { if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current); }, []);
  const selectedAccounts = available.filter((account) => selected.includes(account.id));
  const selectedProviders = [...new Set(selectedAccounts.map((account) => account.provider))];
  const youtubeReady = !selectedProviders.includes("youtube") || youtubeTitle.trim().length > 0;
  const hasContent = Boolean(text.trim() || media);
  const canSubmit = Boolean(hasContent && selected.length > 0 && youtubeReady && (!schedule || scheduledAt));
  const addMedia = async (file: File) => {
    setMediaBusy(true); setMediaError("");
    if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current);
    const previewUrl = URL.createObjectURL(file);
    localPreviewRef.current = previewUrl;
    const type = file.type.startsWith("video/") ? "video" as const : "image" as const;
    setMedia({ name: file.name, url: "", previewUrl, type });
    try {
      const signedResponse = await fetch("/api/v1/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: file.type }) });
      const signed = await signedResponse.json() as { uploadUrl?: string; url?: string; error?: string };
      if (!signedResponse.ok || !signed.uploadUrl || !signed.url) throw new Error(signed.error || "Could not prepare the media upload");
      let url = signed.url;
      try {
        const direct = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
        if (!direct.ok) throw new Error("Direct upload failed");
      } catch {
        const form = new FormData(); form.append("file", file);
        const fallbackResponse = await fetch("/api/v1/media", { method: "POST", body: form });
        const fallback = await fallbackResponse.json() as { url?: string; error?: string };
        if (!fallbackResponse.ok || !fallback.url) throw new Error(fallback.error || "R2 rejected the upload");
        url = fallback.url;
      }
      setMedia({ name: file.name, url, previewUrl, type });
    } catch (cause) { URL.revokeObjectURL(previewUrl); localPreviewRef.current = null; setMedia(null); setMediaError(cause instanceof Error ? cause.message : "Media upload failed"); }
    finally { setMediaBusy(false); if (mediaInputRef.current) mediaInputRef.current.value = ""; }
  };
  const chooseLibraryMedia = (item: ComposerMedia) => { if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current); localPreviewRef.current = null; setMedia(item); setMediaSource(null); setMediaError(""); };
  const removeMedia = () => { if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current); localPreviewRef.current = null; setMedia(null); };
  const openSchedulePicker = () => { const input = scheduleInputRef.current; if (!input) return; if (typeof input.showPicker === "function") input.showPicker(); else input.focus(); };
  const settingsFor = (provider: ProviderId): ProviderPostSettings => {
    if (provider === "instagram") return { kind: "instagram", publishType: instagramType };
    if (provider === "facebook") return { kind: "facebook", publishType: facebookType, linkUrl: facebookLink.trim() || undefined };
    if (provider === "tiktok") return { kind: "tiktok", privacyLevel: tiktokPrivacy, allowComments: tiktokComments, allowDuet: tiktokDuet, allowStitch: tiktokStitch };
    return { kind: "youtube", title: youtubeTitle.trim(), tags: [...new Set(youtubeTags.split(",").map((tag) => tag.trim()).filter(Boolean))], privacyStatus: youtubePrivacy, madeForKids: youtubeMadeForKids };
  };
  const submit = async () => {
    if (!canSubmit || submitBusy) return;
    setSubmitBusy(true); setSubmitError("");
    const status = schedule ? "scheduled" as const : "publishing" as const;
    const targets = selectedAccounts.map((account, index) => ({ id: `new-target-${index}`, accountId: account.id, provider: account.provider, status, settings: settingsFor(account.provider) }));
    const created = await onCreate({ id: "", brandId, text, mediaType: media?.type ?? "none", mediaUrl: media?.url, status, scheduledAt: schedule ? new Date(scheduledAt).toISOString() : undefined, targets });
    if (created) onClose();
    else { setSubmitError("Relay could not save this post. Review the message and try again."); setSubmitBusy(false); }
  };
  return <div className="composer-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close composer" /><section className="composer">
    <header><div><button className="icon-button mobile-only" onClick={onClose}><ArrowLeft /></button><span className="composer-mark"><Send /></span><div><p className="eyebrow">{initialPost ? "Post again" : "New post"}</p><h2>Create once. Relay everywhere.</h2></div></div><div><span className={`save-state ${saved ? "saved" : ""}`}>{saved ? <><Check /> Ready</> : "Editing…"}</span><button className="icon-button desktop-only" onClick={onClose}><X /></button></div></header>
    <div className="composer-body"><main>
      <label className="field-label">Brand <span className="optional-label">optional</span></label><div className="brand-select">{accounts.some((account) => account.brandId === null) && <button className={!brandId ? "active" : ""} onClick={() => { setBrandId(""); setSelected([]); }}><span className="brand-mark small"><Users /></span>Unassigned{!brandId && <Check />}</button>}{brands.map((brand) => <button className={brandId === brand.id ? "active" : ""} onClick={() => { setBrandId(brand.id); setSelected([]); }} key={brand.id}><BrandMark brandId={brand.id} size="small" />{brand.name}{brandId === brand.id && <Check />}</button>)}{accounts.length === 0 && <p className="inline-empty">Connect a social account before composing a post.</p>}</div>
      <label className="field-label" htmlFor="caption">Content</label><div className="caption-box"><textarea id="caption" autoFocus value={text} onChange={(event) => setText(event.target.value)} placeholder="What do you want to share?" />{media && <div className="composer-media"><span>{media.type === "video" ? <Video /> : <ImageIcon />}</span><div><b>{media.name}</b><small>{mediaBusy ? "Uploading to Cloudflare R2…" : "Ready from your media library"}</small></div><button aria-label="Remove media" onClick={removeMedia}><X /></button></div>}<div><button disabled={mediaBusy} onClick={() => setMediaSource("choose")}>{mediaBusy ? <LoaderCircle className="spin" /> : <ImageIcon />} {mediaBusy ? "Uploading…" : media ? "Replace media" : "Add media"}</button><input ref={mediaInputRef} className="visually-hidden" type="file" accept="image/*,video/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void addMedia(file); }} /><span>{text.length} / 2,200</span></div></div>{mediaError && <p className="composer-error" role="alert"><CircleAlert />{mediaError}</p>}
      <div className="dest-heading"><div><label className="field-label">Publish to</label><p>Select the destinations for this post.</p></div><button className="select-all-button" onClick={() => setSelected(selected.length === available.length ? [] : available.map((account) => account.id))}>{selected.length === available.length && available.length > 0 ? "Clear" : "Select all"}</button></div>
      <div className="destination-list">{available.map((account) => { const isSelected = selected.includes(account.id); return <button className={isSelected ? "selected" : ""} onClick={() => setSelected(isSelected ? selected.filter((id) => id !== account.id) : [...selected, account.id])} key={account.id}><span className="check-box">{isSelected && <Check />}</span><ProviderIcon id={account.provider} selected={isSelected} /><span><b>{providerRegistry.get(account.provider).name}</b><small>{account.handle}</small></span><em>{isSelected ? <><Check /> Selected</> : "Not selected"}</em></button>; })}{available.length === 0 && <p className="inline-empty">No connected accounts are available.</p>}</div>
      {selectedProviders.length > 0 && <section className="platform-settings"><div className="platform-settings-heading"><span className="field-label">Platform settings</span><p>These values are stored separately for each destination.</p></div>
        {selectedProviders.includes("instagram") && <div className="platform-card"><div className="platform-card-title"><ProviderIcon id="instagram" /><span><b>Instagram</b><small>Choose where the media appears.</small></span></div><label>Publish as<select value={instagramType} onChange={(event) => setInstagramType(event.target.value as typeof instagramType)}><option value="feed">Feed post</option><option value="reel">Reel</option><option value="story">Story</option></select></label></div>}
        {selectedProviders.includes("facebook") && <div className="platform-card"><div className="platform-card-title"><ProviderIcon id="facebook" /><span><b>Facebook</b><small>Page publishing options.</small></span></div><div className="platform-grid"><label>Publish as<select value={facebookType} onChange={(event) => setFacebookType(event.target.value as typeof facebookType)}><option value="feed">Feed post</option><option value="reel">Reel</option></select></label><label>Link URL <span>optional</span><input type="url" value={facebookLink} onChange={(event) => setFacebookLink(event.target.value)} placeholder="https://…" /></label></div></div>}
        {selectedProviders.includes("tiktok") && <div className="platform-card"><div className="platform-card-title"><ProviderIcon id="tiktok" /><span><b>TikTok</b><small>Only account-allowed options will be used at publish time.</small></span></div><label>Who can watch<select value={tiktokPrivacy} onChange={(event) => setTiktokPrivacy(event.target.value as typeof tiktokPrivacy)}><option value="SELF_ONLY">Only me</option><option value="MUTUAL_FOLLOW_FRIENDS">Friends</option><option value="FOLLOWER_OF_CREATOR">Followers</option><option value="PUBLIC_TO_EVERYONE">Everyone</option></select></label><div className="toggle-row"><label><input type="checkbox" checked={tiktokComments} onChange={(event) => setTiktokComments(event.target.checked)} /> Comments</label><label><input type="checkbox" checked={tiktokDuet} onChange={(event) => setTiktokDuet(event.target.checked)} /> Duet</label><label><input type="checkbox" checked={tiktokStitch} onChange={(event) => setTiktokStitch(event.target.checked)} /> Stitch</label></div><p className="settings-note"><CircleAlert /> Relay will query TikTok creator info before publishing and reject unavailable choices.</p></div>}
        {selectedProviders.includes("youtube") && <div className="platform-card"><div className="platform-card-title"><ProviderIcon id="youtube" /><span><b>YouTube</b><small>Video metadata sent with the upload.</small></span></div><label>Video title <span>required</span><input value={youtubeTitle} maxLength={100} onChange={(event) => setYoutubeTitle(event.target.value)} placeholder="Add a YouTube title" /></label><label>Tags <span>comma-separated</span><input value={youtubeTags} onChange={(event) => setYoutubeTags(event.target.value)} placeholder="product, tutorial, behind the scenes" /></label><div className="platform-grid"><label>Visibility<select value={youtubePrivacy} onChange={(event) => setYoutubePrivacy(event.target.value as typeof youtubePrivacy)}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label><label className="checkbox-field"><input type="checkbox" checked={youtubeMadeForKids} onChange={(event) => setYoutubeMadeForKids(event.target.checked)} /> Made for kids</label></div></div>}
      </section>}
    </main><aside className="preview-panel"><div className="preview-head"><span>Preview</span><div className="segmented compact" aria-label="Preview format">{(["feed", "mobile"] as const).map((mode) => <button key={mode} className={previewMode === mode ? "active" : ""} aria-pressed={previewMode === mode} onClick={() => setPreviewMode(mode)}>{mode[0].toUpperCase() + mode.slice(1)}</button>)}</div></div><div className={`social-preview ${previewMode}`}>{previewMode === "mobile" && <div className="phone-status"><b>9:41</b><span>● ◒ ▰</span></div>}<div className="preview-account"><BrandMark brandId={brandId} size="small" /><span><b>{brands.find((brand) => brand.id === brandId)?.name ?? "Unassigned"}</b><small>Preview · just now</small></span><MoreHorizontal /></div>{media ? <div className="preview-media">{media.type === "video" ? <video src={media.previewUrl} muted controls /> : <img src={media.previewUrl} alt={media.name} />}{mediaBusy && <span><LoaderCircle className="spin" />Uploading…</span>}</div> : <div className="preview-placeholder"><span className="preview-glyph"><i /><i /></span><p>Your media will appear here</p></div>}<div className="preview-actions"><span>♡</span><span>◯</span><span>⌁</span></div><p>{text || (media ? "Media ready to publish." : "Start writing to preview your post across social networks.")}</p>{previewMode === "mobile" && <div className="phone-home-indicator" />}</div><div className="validation"><h4>Destination check</h4>{selectedAccounts.map((account) => { const ready = hasContent && (account.provider !== "youtube" || youtubeReady); return <div key={account.id}><ProviderIcon id={account.provider} /><span>{providerRegistry.get(account.provider).name}</span>{ready ? <em className="ready"><Check /> Ready</em> : <em><CircleAlert />{!hasContent ? " Add content" : " Add title"}</em>}</div>; })}</div></aside></div>
    {submitError && <p className="composer-submit-error" role="alert"><CircleAlert />{submitError}</p>}<footer><div className="schedule-choice"><button className={!schedule ? "active" : ""} onClick={() => setSchedule(false)}><Zap /> Publish now</button><button className={schedule ? "active" : ""} onClick={() => setSchedule(true)}><Clock3 /> Schedule</button>{schedule && <div className="schedule-date" role="button" tabIndex={0} onClick={(event) => { if (event.target !== scheduleInputRef.current) openSchedulePicker(); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openSchedulePicker(); } }}><CalendarDays /><input ref={scheduleInputRef} aria-label="Publish date and time" title="Publish date and time" type="datetime-local" value={scheduledAt} min={new Date().toISOString().slice(0, 16)} onChange={(event) => setScheduledAt(event.target.value)} /></div>}</div><button className="publish-button" disabled={!canSubmit || mediaBusy || submitBusy} onClick={() => void submit()}>{submitBusy ? <><LoaderCircle className="spin" />Saving…</> : <>{schedule ? "Schedule post" : "Start publishing"}<Send /></>}</button></footer>
  </section>{mediaSource === "choose" && <div className="modal-layer media-picker-layer"><button className="modal-scrim" onClick={() => setMediaSource(null)} aria-label="Close media options" /><section className="media-source-modal" role="dialog" aria-modal="true" aria-labelledby="media-source-title"><header><div><p className="eyebrow">Add media</p><h2 id="media-source-title">Where is your media?</h2></div><button className="icon-button" onClick={() => setMediaSource(null)} aria-label="Close"><X /></button></header><div><button onClick={() => { setMediaSource(null); mediaInputRef.current?.click(); }}><span><Upload /></span><b>Upload from device</b><small>Choose a new image or video. Relay will save it to R2.</small><ChevronRight /></button><button onClick={() => setMediaSource("library")}><span><Cloud /></span><b>Choose from library</b><small>Reuse media already stored in Cloudflare R2.</small><ChevronRight /></button></div></section></div>}{mediaSource === "library" && <ComposerMediaLibrary onClose={() => setMediaSource(null)} onSelect={chooseLibraryMedia} />}</div>;
}

function CommandMenu({ onClose, go, compose }: { onClose: () => void; go: (v: View) => void; compose: () => void }) { const commands = [{ name: "Create post", icon: Plus, action: compose }, { name: "Create slideshow", icon: Images, action: () => go("slideshows") }, { name: "Open calendar", icon: CalendarDays, action: () => go("calendar") }, { name: "Search posts", icon: Search, action: () => go("posts") }, { name: "Connect account", icon: Users, action: () => go("accounts") }, { name: "Upload media", icon: ImageIcon, action: () => go("media") }]; return <div className="modal-layer command-layer"><button className="modal-scrim" onClick={onClose} /><div className="command-menu"><div><Search /><input autoFocus placeholder="Search or type a command…"/><kbd>ESC</kbd></div><p>Quick actions</p>{commands.map(({ name, icon: Icon, action }) => <button key={name} onClick={() => { action(); onClose(); }}><Icon />{name}<span>↵</span></button>)}<footer><span><Command /> Relay command menu</span><span>↑↓ Navigate · ↵ Select</span></footer></div></div>; }

export default function RelayApp({ user, initialBrands, initialAccounts, initialPosts, initialNow, initialView = "home" }: { user: { name: string; email: string; role: string }; initialBrands: Brand[]; initialAccounts: SocialAccount[]; initialPosts: RelayPost[]; initialNow: string; initialView?: View }) {
  const [view, setView] = useState<View>(initialView); const [posts, setPosts] = useState(initialPosts);
  const [brandList, setBrandList] = useState(initialBrands);
  const [accountList, setAccountList] = useState(initialAccounts);
  const [composer, setComposer] = useState(false); const [composerMedia, setComposerMedia] = useState<ComposerMedia | null>(null); const [composerPost, setComposerPost] = useState<RelayPost | null>(null); const [command, setCommand] = useState(false); const [menu, setMenu] = useState(false); const [theme, setTheme] = useState("light"); const [toast, setToast] = useState(""); const [toastTone, setToastTone] = useState<"success" | "error">("success");
  const [notifications, setNotifications] = useState<RelayNotification[]>([]); const [notificationsOpen, setNotificationsOpen] = useState(false); const [notificationsLoading, setNotificationsLoading] = useState(true);
  const [themeReady, setThemeReady] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false); const [logoutBusy, setLogoutBusy] = useState(false); const [logoutError, setLogoutError] = useState("");
  const [pendingPostDelete, setPendingPostDelete] = useState<RelayPost | null>(null); const [postDeleteBusy, setPostDeleteBusy] = useState(false); const [postDeleteError, setPostDeleteError] = useState("");
  useEffect(() => { const stored = window.localStorage.getItem("relay-theme"); if (stored === "light" || stored === "dark") setTheme(stored); setThemeReady(true); }, []);
  useEffect(() => {
    const url = new URL(window.location.href); const oauth = url.searchParams.get("oauth");
    if (!oauth) return;
    setView("accounts");
    if (oauth === "success") { const count = Number(url.searchParams.get("count") || 1); const provider = url.searchParams.get("provider") || "social"; setToastTone("success"); setToast(`${count} ${provider} account${count === 1 ? "" : "s"} connected successfully`); }
    else { const code = url.searchParams.get("code"); const messages: Record<string, string> = { authorization_denied: "Connection cancelled by the provider", provider_rejected: "The provider rejected the connection. Verify the callback URL, account type, and requested permissions.", account_save_failed: "Authorization succeeded, but Relay could not save the account. Update Relay and retry the connection.", authorization_expired: "This authorization is no longer valid. Please reconnect the account." }; setToastTone("error"); setToast(messages[code ?? ""] ?? "The social account could not be connected. Check its permissions and try again."); }
    url.searchParams.delete("oauth"); url.searchParams.delete("provider"); url.searchParams.delete("count"); url.searchParams.delete("code");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`); const timer = window.setTimeout(() => setToast(""), 5000); return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => { document.documentElement.dataset.theme = theme; if (themeReady) window.localStorage.setItem("relay-theme", theme); }, [theme, themeReady]);
  useEffect(() => {
    let active = true;
    const load = async () => {
      try {
        const response = await fetch("/api/v1/notifications", { cache: "no-store" });
        const payload = await response.json() as { data?: RelayNotification[] };
        if (active && response.ok) setNotifications(payload.data ?? []);
      } finally { if (active) setNotificationsLoading(false); }
    };
    void load(); const interval = window.setInterval(() => void load(), 15_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);
  useEffect(() => {
    let active = true;
    const load = async () => {
      const response = await fetch("/api/v1/posts", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const payload = await response.json() as { data?: RelayPost[] };
      if (active && payload.data) setPosts(payload.data);
    };
    const interval = window.setInterval(() => void load(), 10_000);
    return () => { active = false; window.clearInterval(interval); };
  }, []);
  useEffect(() => { const handle = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommand(true); } if (event.key === "Escape") { setComposer(false); setCommand(false); } }; window.addEventListener("keydown", handle); return () => window.removeEventListener("keydown", handle); }, []);
  const openComposer = (media: ComposerMedia | null = null, post: RelayPost | null = null) => { setComposerMedia(media); setComposerPost(post); setComposer(true); };
  const closeComposer = () => { setComposer(false); setComposerMedia(null); setComposerPost(null); };
  const refreshNotifications = async () => {
    const response = await fetch("/api/v1/notifications", { cache: "no-store" });
    const payload = await response.json() as { data?: RelayNotification[] };
    if (response.ok) setNotifications(payload.data ?? []);
  };
  const recordPostNotifications = async (post: RelayPost) => {
    const items = post.targets.map((target) => {
      const platform = providerRegistry.get(target.provider).name;
      const account = accountList.find((item) => item.id === target.accountId);
      const destination = account ? `${account.displayName} (${account.handle})` : "the selected account";
      const kind: NotificationKind = target.status === "failed" ? "error" : target.status === "published" ? "success" : target.status === "scheduled" ? "scheduled" : "info";
      const title = kind === "error" ? `${platform} could not publish the post` : kind === "success" ? `Post published on ${platform}` : kind === "scheduled" ? `${platform} post scheduled` : `Publishing to ${platform}`;
      const message = kind === "error"
        ? target.error || `${platform} did not provide a detailed reason. Check the connected account, media requirements, and permissions before retrying.`
        : kind === "success" ? `${destination} returned a successful publishing result.`
          : kind === "scheduled" && post.scheduledAt ? `Scheduled for ${new Date(post.scheduledAt).toLocaleString()} on ${destination}.`
            : `Relay queued this post for ${destination}. Waiting for provider confirmation.`;
      return { eventKey: `${post.id}:${target.id}:${target.status}`, postId: post.id, targetId: target.id, provider: target.provider, kind, title, message, externalUrl: target.externalUrl };
    });
    if (items.length === 0) return;
    try {
      const response = await fetch("/api/v1/notifications", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ notifications: items }) });
      if (!response.ok) throw new Error("Could not save publishing activity");
      await refreshNotifications();
    } catch {
      setToastTone("error"); setToast("The post was saved, but Relay could not record its notification history.");
      setTimeout(() => setToast(""), 4500);
    }
  };
  const addPost = async (post: RelayPost): Promise<boolean> => {
    try {
      const response = await fetch("/api/v1/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(post) });
      const payload = await response.json() as { data?: RelayPost; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error || "Relay could not save this post.");
      setPosts((current) => [payload.data!, ...current]); void recordPostNotifications(payload.data);
      setToastTone("success");
      setToast(payload.data.status === "scheduled" ? `Post saved and scheduled for ${payload.data.targets.length} destination${payload.data.targets.length === 1 ? "" : "s"}` : `Publishing started for ${payload.data.targets.length} destination${payload.data.targets.length === 1 ? "" : "s"}`);
      setTimeout(() => setToast(""), 4000);
      return true;
    } catch (reason) {
      setToastTone("error"); setToast(reason instanceof Error ? reason.message : "Relay could not save this post.");
      setTimeout(() => setToast(""), 4500);
      return false;
    }
  };
  const deletePost = async () => {
    if (!pendingPostDelete) return; const post = pendingPostDelete; setPostDeleteBusy(true); setPostDeleteError("");
    try {
      const response = await fetch("/api/v1/posts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: post.id }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Relay could not delete this post.");
      setPosts((current) => current.filter((item) => item.id !== post.id));
      setPendingPostDelete(null);
      setToastTone("success"); setToast("Post removed from Relay. Its media is still available in your library.");
      setTimeout(() => setToast(""), 4000);
    } catch (reason) {
      const message = reason instanceof Error ? reason.message : "Relay could not delete this post."; setPostDeleteError(message); setToastTone("error"); setToast(message); setTimeout(() => setToast(""), 4500);
    } finally { setPostDeleteBusy(false); }
  };
  const markAllNotificationsRead = async () => {
    const readAt = new Date().toISOString();
    setNotifications((current) => current.map((item) => ({ ...item, readAt: item.readAt ?? readAt })));
    await fetch("/api/v1/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
  };
  const requestPostDelete = (post: RelayPost) => { setPostDeleteError(""); setPendingPostDelete(post); };
  const content = useMemo(() => { if (view === "home") return <HomeView posts={posts} onCompose={() => openComposer()} go={setView} userName={user.name} initialNow={initialNow} />; if (view === "calendar") return <CalendarView posts={posts} onCompose={() => openComposer()} onPostAgain={(post) => openComposer(null, post)} onDelete={requestPostDelete} />; if (view === "posts") return <PostsView posts={posts} onPostAgain={(post) => openComposer(null, post)} onDelete={requestPostDelete} />; if (view === "analytics") return <AnalyticsView posts={posts} onCompose={() => openComposer()} />; if (view === "slideshows") return <SlideshowStudio accounts={accountList} brands={brandList} onCreatePost={addPost} />; if (view === "accounts") return <AccountsView onAccountDeleted={(id) => setAccountList((current) => current.filter((item) => item.id !== id))} />; if (view === "media") return <MediaView onCompose={(media) => openComposer(media)} />; if (view === "brands") return <BrandsView onBrandCreated={(brand) => setBrandList((current) => [...current, brand])} onBrandUpdated={(brand) => setBrandList((current) => current.map((item) => item.id === brand.id ? brand : item))} onBrandDeleted={(id) => setBrandList((current) => current.filter((item) => item.id !== id))} onAccountsAssigned={(assignments) => setAccountList((current) => current.map((account) => { const assignment = assignments.find((item) => item.id === account.id); return assignment ? { ...account, brandId: assignment.brandId } : account; }))} />; return <SettingsView theme={theme} setTheme={setTheme} go={setView} user={user} />; }, [view, posts, theme, user, initialNow, accountList, brandList]);
  const logout = async () => {
    setLogoutBusy(true); setLogoutError("");
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Relay could not end your session. Please try again.");
      window.location.replace("/login");
    } catch (reason) { setLogoutError(reason instanceof Error ? reason.message : "Relay could not end your session."); setLogoutBusy(false); }
  };
  const unreadNotifications = notifications.filter((item) => !item.readAt).length;
  return <BrandsContext.Provider value={brandList}><AccountsContext.Provider value={accountList}><div className="app-shell"><Sidebar active={view} onChange={setView} mobileOpen={menu} onClose={() => setMenu(false)} user={user} onLogout={() => { setLogoutError(""); setLogoutConfirm(true); }} /><main className="main"><Topbar view={view} unread={unreadNotifications} onNotifications={() => setNotificationsOpen(true)} onCompose={() => openComposer()} onCommand={() => setCommand(true)} onMenu={() => setMenu(true)} />{content}</main><nav className="mobile-nav">{navItems.slice(0, 3).map(({ id, icon: Icon }) => <button className={view === id ? "active" : ""} onClick={() => setView(id)} key={id}><Icon /><span>{viewLabel[id]}</span></button>)}<button className="mobile-create" onClick={() => openComposer()}><Plus /></button><button className={view === "accounts" ? "active" : ""} onClick={() => setView("accounts")}><Users /><span>Accounts</span></button><button onClick={() => setMenu(true)}><Menu /><span>More</span></button></nav>{composer && <Composer initialMedia={composerMedia} initialPost={composerPost} onClose={closeComposer} onCreate={addPost} />}{command && <CommandMenu onClose={() => setCommand(false)} go={setView} compose={() => openComposer()} />}{notificationsOpen && <NotificationCenter notifications={notifications} loading={notificationsLoading} onClose={() => setNotificationsOpen(false)} onMarkAllRead={() => void markAllNotificationsRead()} />}{logoutConfirm && <LogoutModal busy={logoutBusy} error={logoutError} onClose={() => setLogoutConfirm(false)} onConfirm={() => void logout()} />}{pendingPostDelete && <ConfirmModal eyebrow={pendingPostDelete.status === "scheduled" ? "Cancel schedule" : "Delete post"} title={pendingPostDelete.status === "scheduled" ? "Cancel this scheduled post?" : "Delete this post from Relay?"} body={pendingPostDelete.status === "scheduled" ? "It will be removed from the calendar and will not be published." : "Its media stays in your library, but the saved post and destination details will be removed."} confirmLabel={pendingPostDelete.status === "scheduled" ? "Cancel schedule" : "Delete post"} busy={postDeleteBusy} error={postDeleteError} onClose={() => setPendingPostDelete(null)} onConfirm={() => void deletePost()} />}{toast && <div className={`toast ${toastTone}`}><span>{toastTone === "error" ? <CircleAlert /> : <Check />}</span>{toast}</div>}</div></AccountsContext.Provider></BrandsContext.Provider>;
}
