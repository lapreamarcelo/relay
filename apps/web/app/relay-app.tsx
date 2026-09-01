"use client";

import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowLeft, ArrowUp, BarChart3, Bell, BookOpen, CalendarDays, Check, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, ChevronsRight,
  Camera, CircleAlert, Clock3, Cloud, Command, Copy, Database, ExternalLink, File as FileIcon, FileText, Folder, FolderInput, FolderOpen, Grid2X2, Home, Image as ImageIcon,
  Eye, Heart, Images, Instagram, KeyRound, LayoutGrid, List, LoaderCircle, LogOut, Menu, MessageCircle, Moon, MoreHorizontal, Music2, Pencil, Plus, RefreshCw, Search,
  Send, Settings, Share2, ShieldCheck, Sparkles, Sun, Trash2, TrendingUp, Upload, Users, Video, X, Youtube, Zap,
} from "lucide-react";
import { defaultPublishingDefaults, type Brand, type Campaign, type PostTemplate, type ProviderId, type ProviderPostSettings, type PublishingDefaults, type RelayPost, type SocialAccount, type PostStatus } from "@relay/core";
import { validatePostPlan } from "@relay/core/post-validation";
import { providerRegistry } from "@relay/providers";
import SlideshowStudio from "./slideshow-studio";
import { ConfirmModal, PromptModal } from "./confirm-modal";
import PlanningCalendar from "./planning-calendar";
import AnalyticsDashboard from "./analytics-dashboard";
import VideoStudio from "./video-studio";
import { type RelayView as View, parseRelayView, relayViewUrl, viewLabel } from "../lib/app-navigation";
import { useModalAccessibility } from "../lib/use-modal-accessibility";
import { COMPOSER_DRAFT_KEY, parseComposerDraft } from "../lib/composer-draft";
import { alternateByType, defaultScheduleStart, scheduleSeries, type SequenceOrder } from "../lib/schedule-series";
import { automaticInstagramSettings } from "../lib/automatic-post-settings";
import { demoCampaigns, demoMedia, demoMediaProjects, demoMusic, demoNotifications, demoReports, demoSlideshowProjects, demoTemplates, demoVideoProjects } from "../lib/demo-data";
import { CommunitySponsors, FeaturedGoldSponsor, GoldSponsor, SponsorMarketplace } from "./growthcat-sponsors";
import CliDocs from "./cli-docs";

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

const navItems: { id: View; icon: typeof Home }[] = [
  { id: "home", icon: Home }, { id: "calendar", icon: CalendarDays }, { id: "posts", icon: FileText }, { id: "slideshows", icon: Images }, { id: "videos", icon: Video }, { id: "analytics", icon: BarChart3 }, { id: "media", icon: ImageIcon },
  { id: "brands", icon: LayoutGrid }, { id: "accounts", icon: Users }, { id: "settings", icon: Settings },
  { id: "docs", icon: BookOpen },
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
      <SponsorMarketplace />
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
      <GoldSponsor />
      <div className="sidebar-bottom">
        <button className="workspace-switch"><span className="workspace-avatar">R</span><span><b>Relay</b><small>Personal workspace</small></span><MoreHorizontal /></button>
        <button className="account-row" onClick={onLogout} title="Sign out"><span className="avatar">{user.name.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase()}</span><span><b>{user.name}</b><small>{user.role === "OWNER" ? "Owner · Sign out" : "Member · Sign out"}</small></span><ChevronDown /></button>
      </div>
    </aside>
  </>;
}

function PostThumbnail({ post }: { post: RelayPost }) {
  const [unavailable, setUnavailable] = useState(false);
  useEffect(() => setUnavailable(false), [post.mediaType, post.mediaUrl]);

  if (!post.mediaUrl || post.mediaType === "none" || unavailable) {
    const Icon = post.mediaType === "video" ? Video : post.mediaType === "image" ? ImageIcon : FileText;
    return <div className="post-thumb placeholder" role="img" aria-label={unavailable ? "Media preview unavailable" : "No media attached"}><Icon /></div>;
  }

  if (post.mediaType === "video") {
    return <div className="post-thumb video-thumbnail" role="img" aria-label="Video preview">
      <video
        src={post.mediaUrl}
        muted
        playsInline
        preload="metadata"
        onLoadedMetadata={(event) => {
          const video = event.currentTarget;
          if (Number.isFinite(video.duration) && video.duration > 0.1) video.currentTime = Math.min(0.1, video.duration / 2);
        }}
        onError={() => setUnavailable(true)}
      />
      <span aria-hidden="true"><Video /></span>
    </div>;
  }

  return <img className="post-thumb" src={post.mediaUrl} alt="" onError={() => setUnavailable(true)} />;
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
    <FeaturedGoldSponsor />
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
            <PostThumbnail post={post} />
            <button className="icon-button"><MoreHorizontal /></button>
          </article>;
        })}
        {upcoming.length === 0 && <div className="home-empty"><span><CalendarDays /></span><div><h3>Nothing scheduled yet</h3><p>Your calendar is clear. Create a post now, or open the calendar to look ahead.</p></div><button className="secondary-button" onClick={() => go("calendar")}>View calendar</button></div>}
      </div>
    </section>
    <CommunitySponsors />
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

function CalendarView({ posts, onCompose, onPostAgain, onEdit, onRetry, onDelete }: { posts: RelayPost[]; onCompose: () => void; onPostAgain: (post: RelayPost) => void; onEdit: (post: RelayPost) => void; onRetry: (post: RelayPost) => void; onDelete: (post: RelayPost) => void }) {
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
    {mode === "List" ? <div className="list-calendar">{timelinePosts.length > 0 ? timelinePosts.map((post) => <PostRow post={post} onPostAgain={onPostAgain} onEdit={onEdit} onRetry={onRetry} onDelete={onDelete} key={post.id} />) : <div className="calendar-list-empty"><CalendarDays /><div><b>No saved posts yet</b><span>Scheduled and published posts will remain here.</span></div><button className="secondary-button" onClick={onCompose}><Plus /> Create post</button></div>}</div> : mode === "Month" ? <div className="month-calendar">
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
  if (settings.kind === "tiktok") return settings.privacyLevel === "SELF_ONLY" ? "TikTok inbox · manual publish" : settings.privacyLevel === "PUBLIC_TO_EVERYONE" ? "Everyone" : settings.privacyLevel === "FOLLOWER_OF_CREATOR" ? "Followers" : "Friends";
  return `${settings.privacyStatus[0].toUpperCase() + settings.privacyStatus.slice(1)} · ${settings.title}`;
}

function PostDetailsModal({ post, onClose, onPostAgain, onEdit, onRetry, onDelete }: { post: RelayPost; onClose: () => void; onPostAgain: () => void; onEdit: () => void; onRetry: () => void; onDelete: () => void }) {
  const brands = useBrands();
  const brand = brands.find((item) => item.id === post.brandId);
  const timestamp = post.publishedAt ?? post.scheduledAt ?? post.createdAt;
  return <div className="modal-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close post details" /><section className="post-details-modal" role="dialog" aria-modal="true" aria-labelledby="post-details-title"><header><div><p className="eyebrow">Saved post</p><h2 id="post-details-title">Post details</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X /></button></header><div className="post-details-summary">{post.mediaUrl ? post.mediaType === "video" ? <video src={post.mediaUrl} controls preload="metadata" /> : <img src={post.mediaUrl} alt="Post media" /> : <span><FileText /></span>}<div><Status value={post.status} /><h3>{post.text || "Media post"}</h3><p><BrandMark brandId={post.brandId} size="small" />{brand?.name ?? "Unassigned"}{post.campaignName ? ` · ${post.campaignName}` : ""}</p>{timestamp && <time>{new Date(timestamp).toLocaleString()}</time>}</div></div><div className="post-target-details"><p className="eyebrow">Destinations</p>{post.targets.map((target) => <article key={target.id}><ProviderIcon id={target.provider} selected /><div><b>{providerRegistry.get(target.provider).name}</b><span>{settingsSummary(target.settings)}</span>{target.textOverride && <span>Custom caption: {target.textOverride}</span>}{target.analytics && <span className="target-analytics"><em><Eye />{compactMetric(target.analytics.views ?? 0)}</em><em><Heart />{compactMetric(target.analytics.likes ?? 0)}</em><em><MessageCircle />{compactMetric(target.analytics.comments ?? 0)}</em><em><Share2 />{compactMetric(target.analytics.shares ?? 0)}</em></span>}{target.error && <em><CircleAlert />{target.error}</em>}</div><Status value={target.status} />{target.externalUrl && <a className="icon-button" href={target.externalUrl} target="_blank" rel="noreferrer" aria-label={`Open on ${providerRegistry.get(target.provider).name}`}><ExternalLink /></a>}</article>)}</div><footer>{post.status === "scheduled" && <button className="danger-button" onClick={onDelete}><Trash2 /> Cancel schedule</button>}{post.status === "failed" && <button className="secondary-button" onClick={onRetry}><RefreshCw /> Retry failed</button>}<button className="secondary-button" onClick={onClose}>Close</button><button className={post.status === "draft" || post.status === "scheduled" ? "secondary-button" : "primary-button"} onClick={onPostAgain}><Copy /> Duplicate post</button>{(post.status === "draft" || post.status === "scheduled") && <button className="primary-button" onClick={onEdit}><Pencil /> Edit post</button>}</footer></section></div>;
}

function PostRow({ post, onPostAgain, onEdit, onRetry, onDelete }: { post: RelayPost; onPostAgain: (post: RelayPost) => void; onEdit: (post: RelayPost) => void; onRetry: (post: RelayPost) => void; onDelete: (post: RelayPost) => void }) {
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
    {menuOpen && <><button className="post-menu-scrim" aria-label="Close post actions" onClick={() => setMenuOpen(false)} /><div className="post-action-menu" role="menu"><button role="menuitem" onClick={() => { setMenuOpen(false); setDetailsOpen(true); }}><FileText /> View details</button>{(post.status === "draft" || post.status === "scheduled") && <button role="menuitem" onClick={() => { setMenuOpen(false); onEdit(post); }}><Pencil /> Edit post</button>}{post.status === "failed" && <button role="menuitem" onClick={() => { setMenuOpen(false); onRetry(post); }}><RefreshCw /> Retry failed</button>}<button role="menuitem" onClick={() => { setMenuOpen(false); onPostAgain(post); }}><Copy /> Duplicate post</button>{externalUrl && <a role="menuitem" href={externalUrl} target="_blank" rel="noreferrer"><ExternalLink /> Open on platform</a>}<span /> <button className="danger" role="menuitem" onClick={() => { setMenuOpen(false); onDelete(post); }}><Trash2 /> {post.status === "scheduled" ? "Cancel schedule" : "Delete from Relay"}</button></div></>}
    {detailsOpen && <PostDetailsModal post={post} onClose={() => setDetailsOpen(false)} onPostAgain={() => { setDetailsOpen(false); onPostAgain(post); }} onEdit={() => { setDetailsOpen(false); onEdit(post); }} onRetry={() => { setDetailsOpen(false); onRetry(post); }} onDelete={() => { setDetailsOpen(false); onDelete(post); }} />}
  </article>;
}

function PostsView({ posts, onPostAgain, onEdit, onRetry, onDelete }: { posts: RelayPost[]; onPostAgain: (post: RelayPost) => void; onEdit: (post: RelayPost) => void; onRetry: (post: RelayPost) => void; onDelete: (post: RelayPost) => void }) {
  const brands = useBrands();
  const [filter, setFilter] = useState<"all" | PostStatus>("all");
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [provider, setProvider] = useState<"all" | ProviderId>("all");
  const [brandId, setBrandId] = useState("all");
  const [mediaFilter, setMediaFilter] = useState<"all" | "with" | "without">("all");
  const [sort, setSort] = useState<"newest" | "oldest">("newest");
  const [filtersReady, setFiltersReady] = useState(false);
  useEffect(() => { const query = new URL(window.location.href).searchParams; const savedStatus = query.get("status"); if (["draft", "scheduled", "publishing", "processing", "published", "failed"].includes(savedStatus ?? "")) setFilter(savedStatus as PostStatus); setProvider((query.get("provider") as typeof provider) || "all"); setBrandId(query.get("brand") || "all"); const savedMedia = query.get("media"); if (savedMedia === "with" || savedMedia === "without") setMediaFilter(savedMedia); if (query.get("sort") === "oldest") setSort("oldest"); setFiltersReady(true); }, []);
  useEffect(() => { if (!filtersReady) return; const url = new URL(window.location.href); const set = (key: string, value: string, fallback: string) => value === fallback ? url.searchParams.delete(key) : url.searchParams.set(key, value); set("status", filter, "all"); set("provider", provider, "all"); set("brand", brandId, "all"); set("media", mediaFilter, "all"); set("sort", sort, "newest"); window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`); }, [filter, provider, brandId, mediaFilter, sort, filtersReady]);
  const activeFilters = Number(provider !== "all") + Number(brandId !== "all") + Number(mediaFilter !== "all") + Number(sort !== "newest");
  const resetFilters = () => { setProvider("all"); setBrandId("all"); setMediaFilter("all"); setSort("newest"); };
  const postTime = (post: RelayPost) => new Date(post.publishedAt ?? post.scheduledAt ?? post.createdAt ?? 0).getTime();
  const shown = posts.filter((post) => filter === "all" || post.status === filter)
    .filter((post) => provider === "all" || post.targets.some((target) => target.provider === provider))
    .filter((post) => brandId === "all" || (brandId === "unassigned" ? !post.brandId : post.brandId === brandId))
    .filter((post) => mediaFilter === "all" || (mediaFilter === "with" ? post.mediaType !== "none" : post.mediaType === "none"))
    .sort((first, second) => sort === "newest" ? postTime(second) - postTime(first) : postTime(first) - postTime(second));
  return <div className="page page-enter"><div className="filterbar"><div className="tabs">{(["all", "draft", "scheduled", "publishing", "processing", "published", "failed"] as const).map((value) => <button className={filter === value ? "active" : ""} onClick={() => setFilter(value)} key={value}>{value[0].toUpperCase() + value.slice(1)}<span>{value === "all" ? posts.length : posts.filter((p) => p.status === value).length}</span></button>)}</div><button className={`secondary-button filters-trigger ${filtersOpen ? "active" : ""}`} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((open) => !open)}><Grid2X2 /> Filters{activeFilters > 0 && <span>{activeFilters}</span>}</button></div>{filtersOpen && <section className="post-filter-tray" aria-label="Post filters"><div><label>Network<select value={provider} onChange={(event) => setProvider(event.target.value as typeof provider)}><option value="all">All networks</option>{providerRegistry.list().map((item) => <option value={item.id} key={item.id}>{item.name}</option>)}</select></label><label>Brand<select value={brandId} onChange={(event) => setBrandId(event.target.value)}><option value="all">All brands</option><option value="unassigned">Unassigned</option>{brands.map((brand) => <option value={brand.id} key={brand.id}>{brand.name}</option>)}</select></label><label>Media<select value={mediaFilter} onChange={(event) => setMediaFilter(event.target.value as typeof mediaFilter)}><option value="all">All posts</option><option value="with">With media</option><option value="without">Text only</option></select></label><label>Order<select value={sort} onChange={(event) => setSort(event.target.value as typeof sort)}><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label></div><footer><span>{shown.length} post{shown.length === 1 ? "" : "s"} shown</span><button disabled={activeFilters === 0} onClick={resetFilters}>Reset filters</button><button className="primary-button" onClick={() => setFiltersOpen(false)}>Done</button></footer></section>}<div className="posts-list">{shown.map((post) => <PostRow post={post} onPostAgain={onPostAgain} onEdit={onEdit} onRetry={onRetry} onDelete={onDelete} key={post.id} />)}{shown.length === 0 && <Empty title="No posts match these filters" body="Adjust or reset the filters to see more posts." />}</div></div>;
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

interface MediaProject { id: string; name: string; kind: "media" | "music"; count: number; createdAt: string }

interface ComposerMedia {
  name: string;
  url: string;
  previewUrl: string;
  type: "image" | "video";
  urls?: string[];
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = units[0];
  for (let index = 1; value >= 1024 && index < units.length; index += 1) { value /= 1024; unit = units[index]; }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${unit}`;
}

function mediaProjectId(key: string): string {
  return /^media-projects\/([0-9a-f-]{36})\/(?:media|music)\//i.exec(key)?.[1] ?? "unfiled";
}

function MoveMediaModal({ item, projects, value, busy, error, onChange, onClose, onConfirm }: { item: MediaObject; projects: MediaProject[]; value: string; busy: boolean; error: string; onChange: (value: string) => void; onClose: () => void; onConfirm: () => void }) {
  const sourceProjectId = mediaProjectId(item.key);
  const destinations = projects.filter((project) => project.id !== sourceProjectId);
  return <div className="modal-layer"><button className="modal-scrim" disabled={busy} onClick={onClose} aria-label="Cancel moving media" /><form className="prompt-modal move-media-modal" role="dialog" aria-modal="true" aria-labelledby="move-media-title" onSubmit={(event) => { event.preventDefault(); onConfirm(); }}><header><div><p className="eyebrow">Media library</p><h2 id="move-media-title">Move media to another folder</h2><p>Relay will preserve references from scheduled posts and creative projects.</p></div><button type="button" className="icon-button" disabled={busy} onClick={onClose} aria-label="Close"><X /></button></header><div className="move-media-file"><span><FolderInput /></span><div><b>{item.name}</b><small>Choose its new R2 folder</small></div></div><label htmlFor="move-media-folder">Destination folder</label><select id="move-media-folder" autoFocus value={value} onChange={(event) => onChange(event.target.value)}>{sourceProjectId !== "unfiled" && <option value="unfiled">Unsorted</option>}{destinations.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select>{error && <p className="auth-error" role="alert">{error}</p>}<footer><button type="button" className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !value}>{busy ? <LoaderCircle className="spin" /> : <FolderInput />}{busy ? "Moving…" : "Move file"}</button></footer></form></div>;
}

function mediaKind(name: string): "image" | "video" | "audio" | "file" {
  const extension = name.split(".").pop()?.toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "webp", "avif", "svg", "bmp"].includes(extension ?? "")) return "image";
  if (["mp4", "mov", "m4v", "webm", "avi", "mkv"].includes(extension ?? "")) return "video";
  if (["mp3", "m4a", "aac", "wav", "ogg", "flac"].includes(extension ?? "")) return "audio";
  return "file";
}

function MediaPreviewModal({ item, onClose }: { item: MediaObject; onClose: () => void }) {
  const kind = mediaKind(item.name);
  const [unavailable, setUnavailable] = useState(false);
  return <div className="modal-layer media-preview-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close media preview" /><section className="media-preview-modal" role="dialog" aria-modal="true" aria-labelledby="media-preview-title"><header><div><p className="eyebrow">R2 media preview</p><h2 id="media-preview-title">{item.name}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X /></button></header><div className="media-preview-stage">{unavailable ? <div className="media-preview-unavailable"><CircleAlert /><b>Preview unavailable</b><span>The original file may be unavailable or unsupported by this browser.</span></div> : kind === "image" ? <img src={item.url} alt={item.name} onError={() => setUnavailable(true)} /> : kind === "video" ? <video src={item.url} controls playsInline preload="metadata" onError={() => setUnavailable(true)} /> : <div className="media-preview-unavailable"><FileIcon /><b>No visual preview</b><span>This file type cannot be displayed here.</span></div>}</div><footer><div><b>{kind}</b><span>{formatBytes(item.size)}{item.lastModified ? ` · Updated ${new Date(item.lastModified).toLocaleDateString()}` : ""}</span></div><a className="secondary-button" href={item.url} target="_blank" rel="noreferrer">Open original <ExternalLink /></a></footer></section></div>;
}

function sequenceSettings(provider: ProviderId, item: MediaObject, defaults: PublishingDefaults, durationMs?: number): ProviderPostSettings {
  const kind = mediaKind(item.name) as "image" | "video";
  if (provider === "instagram") return automaticInstagramSettings(kind === "video" ? defaults.instagram.videoPublishType : defaults.instagram.imagePublishType, kind, durationMs);
  if (provider === "facebook") return { kind: "facebook", publishType: kind === "video" ? defaults.facebook.videoPublishType : "feed" };
  if (provider === "tiktok") return { kind: "tiktok", ...defaults.tiktok, allowComments: defaults.tiktok.privacyLevel === "SELF_ONLY" ? false : defaults.tiktok.allowComments, allowDuet: defaults.tiktok.privacyLevel === "SELF_ONLY" ? false : defaults.tiktok.allowDuet, allowStitch: defaults.tiktok.privacyLevel === "SELF_ONLY" ? false : defaults.tiktok.allowStitch };
  return { kind: "youtube", title: item.name.replace(/\.[^.]+$/, "").slice(0, 100) || "Relay video", tags: [], privacyStatus: defaults.youtube.privacyStatus, madeForKids: defaults.youtube.madeForKids };
}

function readVideoDurationMs(url: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const video = document.createElement("video");
    let timeout = 0;
    const finish = (complete: () => void) => { window.clearTimeout(timeout); video.onloadedmetadata = null; video.onerror = null; video.removeAttribute("src"); video.load(); complete(); };
    timeout = window.setTimeout(() => finish(() => reject(new Error("Relay timed out while choosing an Instagram Reel cover frame."))), 15_000);
    video.preload = "metadata";
    video.onloadedmetadata = () => {
      const durationMs = Math.round(video.duration * 1_000);
      finish(() => Number.isFinite(durationMs) && durationMs > 0 ? resolve(durationMs) : reject(new Error("Relay could not read a video duration for its Instagram Reel cover.")));
    };
    video.onerror = () => finish(() => reject(new Error("Relay could not read a video duration for its Instagram Reel cover.")));
    video.src = url;
  });
}

function MediaSequenceModal({ items, publishingDefaults, demoMode, onClose, onComplete }: { items: MediaObject[]; publishingDefaults: PublishingDefaults; demoMode: boolean; onClose: () => void; onComplete: (message: string) => void }) {
  const accounts = useAccounts().filter((account) => account.status === "connected");
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  const [ordered, setOrdered] = useState(items); const [orderMode, setOrderMode] = useState<SequenceOrder>("selected");
  const [accountIds, setAccountIds] = useState<string[]>([]); const [startAt, setStartAt] = useState(defaultScheduleStart); const [intervalDays, setIntervalDays] = useState(1);
  const [caption, setCaption] = useState(""); const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const requestId = useRef(`media-sequence-${crypto.randomUUID()}`).current;
  const schedule = scheduleSeries(startAt, ordered.length, intervalDays);
  const hasImages = ordered.some((item) => mediaKind(item.name) === "image");
  const hasVideos = ordered.some((item) => mediaKind(item.name) === "video");
  const selectableAccounts = accounts.filter((account) => account.provider !== "youtube" || !hasImages);
  const selectedAccounts = selectableAccounts.filter((account) => accountIds.includes(account.id));
  const needsInstagramFrames = selectedAccounts.some((account) => account.provider === "instagram") && publishingDefaults.instagram.videoPublishType === "reel";
  const changeOrder = (mode: SequenceOrder) => { setOrderMode(mode); setOrdered(mode === "alternate" ? alternateByType(items, (item) => mediaKind(item.name) as "image" | "video") : items); };
  const move = (index: number, direction: -1 | 1) => { const target = index + direction; if (target < 0 || target >= ordered.length) return; setOrderMode("selected"); setOrdered((current) => { const next = [...current]; [next[index], next[target]] = [next[target], next[index]]; return next; }); };
  const submit = async () => {
    if (!selectedAccounts.length) { setError("Choose at least one connected destination."); return; }
    if (!schedule.length || new Date(schedule[0]).getTime() <= Date.now()) { setError("Choose a future first publishing time."); return; }
    setBusy(true); setError("");
    try {
      if (demoMode) { onComplete(`${ordered.length} demo posts added to the sequence preview.`); return; }
      const brandIds = [...new Set(selectedAccounts.map((account) => account.brandId ?? ""))];
      const videoDurations = needsInstagramFrames ? Object.fromEntries(await Promise.all(ordered.filter((item) => mediaKind(item.name) === "video").map(async (item) => [item.key, await readVideoDurationMs(item.url)] as const))) : {};
      const posts = ordered.map((item, index) => ({
        clientRequestId: `${requestId}-${index}`,
        brandId: brandIds.length === 1 ? brandIds[0] : undefined,
        text: caption.replaceAll("{filename}", item.name.replace(/\.[^.]+$/, "")),
        mediaType: mediaKind(item.name), mediaUrl: item.url, status: "scheduled", scheduledAt: schedule[index],
        targets: selectedAccounts.map((account) => ({ accountId: account.id, settings: sequenceSettings(account.provider, item, publishingDefaults, videoDurations[item.key]) })),
      }));
      const response = await fetch("/api/v1/posts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ posts }) });
      const payload = await response.json() as { summary?: { created: number; failed: number }; data?: Array<{ error?: string }>; error?: string };
      if (!response.ok && response.status !== 207) throw new Error(payload.error || "Could not schedule this sequence.");
      const created = payload.summary?.created ?? 0; const failed = payload.summary?.failed ?? 0;
      if (!created) throw new Error(payload.data?.find((item) => item.error)?.error || "No posts were scheduled.");
      onComplete(`${created} post${created === 1 ? "" : "s"} scheduled${failed ? `; ${failed} failed` : ""}.`);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not schedule this sequence."); setBusy(false); }
  };
  return <div className="modal-layer media-sequence-layer"><button className="modal-scrim" disabled={busy} onClick={onClose} aria-label="Close sequence scheduler"/><section className="media-sequence-modal" role="dialog" aria-modal="true" aria-labelledby="media-sequence-title"><header><div><p className="eyebrow">Bulk publishing</p><h2 id="media-sequence-title">Schedule a media sequence</h2><p>One asset becomes one post. Review the exact order and dates before scheduling.</p></div><button className="icon-button" disabled={busy} onClick={onClose} aria-label="Close"><X/></button></header>{error && <p className="video-batch-error" role="alert"><CircleAlert/>{error}</p>}<div className="media-sequence-body"><section className="media-sequence-queue"><div className="sequence-heading"><div><p className="eyebrow">Order</p><b>{ordered.length} posts</b></div><div className="segmented"><button className={orderMode === "selected" ? "active" : ""} onClick={() => changeOrder("selected")}>Selected</button><button className={orderMode === "alternate" ? "active" : ""} disabled={!hasImages || !hasVideos} onClick={() => changeOrder("alternate")}>Alternate types</button></div></div><div className="sequence-list">{ordered.map((item,index) => { const kind = mediaKind(item.name) as "image" | "video"; return <article key={item.key}><span>{kind === "image" ? <img src={item.url} alt=""/> : <video src={item.url} muted preload="metadata"/>}</span><div><b>{item.name}</b><small>{kind} · {schedule[index] ? new Date(schedule[index]).toLocaleString([], { dateStyle: "medium", timeStyle: "short" }) : "Choose a start time"}</small></div><div><button className="icon-button" disabled={index === 0} onClick={() => move(index,-1)} aria-label={`Move ${item.name} earlier`}><ArrowUp/></button><button className="icon-button" disabled={index === ordered.length - 1} onClick={() => move(index,1)} aria-label={`Move ${item.name} later`}><ArrowDown/></button></div></article>; })}</div></section><aside className="media-sequence-settings"><section><p className="eyebrow">Timing</p><label>First publish<input type="datetime-local" value={startAt} onChange={(event) => { setStartAt(event.target.value); setError(""); }}/></label><label>Cadence<select value={intervalDays <= 2 ? intervalDays : "custom"} onChange={(event) => { const value = event.target.value; setIntervalDays(value === "custom" ? Math.max(3, intervalDays) : Number(value)); }}><option value="1">Every day</option><option value="2">Every other day</option><option value="custom">Every X days</option></select></label>{intervalDays > 2 && <label>Days between posts<input type="number" min="3" max="365" value={intervalDays} onChange={(event) => setIntervalDays(Math.min(365, Math.max(3, Number(event.target.value) || 3)))}/></label>}<small>Times use {timezone} and stay at the same local clock time.</small></section><section><p className="eyebrow">Destinations</p>{selectableAccounts.map((account) => <label className="batch-account" key={account.id}><input type="checkbox" checked={accountIds.includes(account.id)} onChange={(event) => setAccountIds((current) => event.target.checked ? [...current, account.id] : current.filter((id) => id !== account.id))}/><span>{account.displayName}<small>{account.provider} · {account.handle}</small></span></label>)}{hasImages && accounts.some((account) => account.provider === "youtube") && <small>YouTube is hidden because this sequence contains images.</small>}{!selectableAccounts.length && <small>Connect a compatible social account before scheduling.</small>}</section><section><p className="eyebrow">Caption <span>optional</span></p><label>Shared template<textarea value={caption} maxLength={2200} onChange={(event) => setCaption(event.target.value)} placeholder="Use {filename} to insert each file name."/></label><small>Relay uses your saved publishing defaults for each platform.</small></section></aside></div><footer><span>{ordered.length && schedule.length ? `${new Date(schedule[0]).toLocaleDateString()} – ${new Date(schedule.at(-1)!).toLocaleDateString()}` : "Choose a valid schedule"}</span><button className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={busy || !selectedAccounts.length || !schedule.length} onClick={() => void submit()}>{busy ? <LoaderCircle className="spin"/> : <CalendarDays/>}{busy ? "Scheduling…" : `Schedule ${ordered.length} posts`}</button></footer></section></div>;
}

function MediaView({ onCompose, publishingDefaults = defaultPublishingDefaults, demoMode = false, initialItems = [], initialMusicItems = [], initialProjects = [] }: { onCompose: (media: ComposerMedia) => void; publishingDefaults?: PublishingDefaults; demoMode?: boolean; initialItems?: MediaObject[]; initialMusicItems?: MediaObject[]; initialProjects?: MediaProject[] }) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [items, setItems] = useState<MediaObject[]>(initialItems);
  const [assetKind, setAssetKind] = useState<"media" | "music">("media");
  const [projects, setProjects] = useState<MediaProject[]>(initialProjects); const [projectId, setProjectId] = useState("all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(!demoMode);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [uploadProgress, setUploadProgress] = useState("");
  const [error, setError] = useState("");
  const [createOpen, setCreateOpen] = useState(false); const [projectName, setProjectName] = useState(""); const [projectBusy, setProjectBusy] = useState(false); const [projectError, setProjectError] = useState("");
  const [renameProject, setRenameProject] = useState<MediaProject | null>(null); const [renameProjectName, setRenameProjectName] = useState("");
  const [deleteProject, setDeleteProject] = useState<MediaProject | null>(null);
  const [renameItem, setRenameItem] = useState<MediaObject | null>(null); const [renameName, setRenameName] = useState("");
  const [moveItem, setMoveItem] = useState<MediaObject | null>(null); const [moveProjectId, setMoveProjectId] = useState(""); const [moveError, setMoveError] = useState("");
  const [previewItem, setPreviewItem] = useState<MediaObject | null>(null);
  const [deleteItem, setDeleteItem] = useState<MediaObject | null>(null);
  const [selectedItems, setSelectedItems] = useState<MediaObject[]>([]); const [sequenceOpen, setSequenceOpen] = useState(false); const [sequenceNotice, setSequenceNotice] = useState("");
  const [sequencePublishingDefaults, setSequencePublishingDefaults] = useState(publishingDefaults);

  const loadProjects = async () => {
    try { const response = await fetch("/api/v1/media/projects", { cache: "no-store" }); const payload = await response.json() as { data?: MediaProject[]; error?: string }; if (!response.ok) throw new Error(payload.error || "Could not load media projects"); setProjects(payload.data ?? []); }
    catch (cause) { if (!demoMode) setError(cause instanceof Error ? cause.message : "Could not load media projects"); }
  };

  const load = async (pageCursor: string | null) => {
    setLoading(true); setError("");
    try {
      const params = new URLSearchParams({ limit: "24", kind: assetKind });
      if (pageCursor) params.set("cursor", pageCursor);
      params.set("project", projectId);
      const response = await fetch(`/api/v1/media?${params}`, { cache: "no-store" });
      const payload = await response.json() as { data?: MediaObject[]; pagination?: { nextCursor?: string | null }; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load media");
      setItems(payload.data ?? []); setNextCursor(payload.pagination?.nextCursor ?? null);
    } catch (cause) { if (!demoMode) setError(cause instanceof Error ? cause.message : "Could not load media"); }
    finally { setLoading(false); }
  };

  useEffect(() => { void loadProjects(); }, []);
  useEffect(() => { if (demoMode) return; void fetch("/api/v1/settings/publishing", { cache: "no-store" }).then(async (response) => { const payload = await response.json() as { data?: PublishingDefaults }; if (response.ok && payload.data) setSequencePublishingDefaults(payload.data); }).catch(() => undefined); }, [demoMode]);
  useEffect(() => { void load(cursor); }, [cursor, projectId, assetKind]);

  const uploadOne = async (file: File, uploadProjectId: string | undefined, uploadKind: "media" | "music") => {
    const signedResponse = await fetch("/api/v1/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: file.type, projectId: uploadProjectId, kind: uploadKind }) });
    const signed = await signedResponse.json() as { uploadUrl?: string; error?: string };
    if (!signedResponse.ok || !signed.uploadUrl) throw new Error(signed.error || `Could not prepare ${file.name}`);
    let uploadedDirectly = false;
    try {
      const uploadResponse = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file });
      uploadedDirectly = uploadResponse.ok;
    } catch { uploadedDirectly = false; }
    if (!uploadedDirectly) {
      const form = new FormData(); form.append("file", file); form.append("kind", uploadKind); if (uploadProjectId) form.append("projectId", uploadProjectId);
      const fallbackResponse = await fetch("/api/v1/media", { method: "POST", body: form });
      const fallback = await fallbackResponse.json() as { error?: string };
      if (!fallbackResponse.ok) throw new Error(fallback.error || `R2 rejected ${file.name}`);
    }
  };

  const uploadFiles = async (fileList: FileList | null) => {
    const files = Array.from(fileList ?? []);
    if (!files.length) return;
    const uploadProjectId = projectId !== "all" && projectId !== "unfiled" ? projectId : undefined;
    const uploadKind = assetKind;
    const failures: string[] = [];
    setBusyKey("upload"); setError("");
    try {
      for (let index = 0; index < files.length; index += 1) {
        setUploadProgress(files.length > 1 ? `Uploading ${index + 1} of ${files.length}…` : "Uploading…");
        try { await uploadOne(files[index], uploadProjectId, uploadKind); }
        catch (cause) { failures.push(cause instanceof Error ? cause.message : `${files[index].name} failed`); }
      }
      setCursor(null); setHistory([]); await Promise.all([load(null), loadProjects()]);
      if (failures.length) setError(`${files.length - failures.length} of ${files.length} files uploaded. ${failures.join(" ")}`);
    } finally {
      setBusyKey(null); setUploadProgress(""); if (inputRef.current) inputRef.current.value = "";
    }
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
    try { const response = await fetch("/api/v1/media/projects", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: projectName, kind: assetKind }) }); const payload = await response.json() as { data?: MediaProject; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error || "Could not create the project"); setProjects((current) => [...current, payload.data!].sort((a, b) => a.name.localeCompare(b.name))); setProjectId(payload.data.id); setCursor(null); setHistory([]); setCreateOpen(false); setProjectName(""); }
    catch (cause) { setProjectError(cause instanceof Error ? cause.message : "Could not create the project"); }
    finally { setProjectBusy(false); }
  };

  const renameFolder = async () => {
    if (!renameProject || !renameProjectName.trim() || renameProjectName.trim() === renameProject.name) { setRenameProject(null); return; }
    setProjectBusy(true); setProjectError("");
    try {
      const response = await fetch("/api/v1/media/projects", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: renameProject.id, name: renameProjectName.trim() }) });
      const payload = await response.json() as { data?: MediaProject; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error || "Could not rename the folder");
      setProjects((current) => current.map((project) => project.id === payload.data!.id ? payload.data! : project).sort((a, b) => a.name.localeCompare(b.name)));
      setRenameProject(null);
    } catch (cause) { setProjectError(cause instanceof Error ? cause.message : "Could not rename the folder"); }
    finally { setProjectBusy(false); }
  };

  const removeFolder = async () => {
    if (!deleteProject) return;
    setProjectBusy(true); setProjectError("");
    try {
      const response = await fetch("/api/v1/media/projects", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: deleteProject.id }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not delete the folder");
      const deletedId = deleteProject.id;
      setProjects((current) => current.filter((project) => project.id !== deletedId));
      setSelectedItems((current) => current.filter((item) => mediaProjectId(item.key) !== deletedId));
      setDeleteProject(null); setProjectId("all"); setCursor(null); setHistory([]);
    } catch (cause) { setProjectError(cause instanceof Error ? cause.message : "Could not delete the folder"); }
    finally { setProjectBusy(false); }
  };

  const chooseProject = (next: string) => { setProjectId(next); setCursor(null); setHistory([]); };
  const switchAssetKind = (next: "media" | "music") => { setAssetKind(next); setSelectedItems([]); if (demoMode) setItems(next === "music" ? initialMusicItems : initialItems); setProjectId("all"); setCursor(null); setHistory([]); };
  const visibleProjects = projects.filter((project) => (project.kind ?? "media") === assetKind);
  const selectedProject = projects.find((project) => project.id === projectId);
  const selectedName = projectId === "all" ? assetKind === "music" ? "All music" : "All media" : projectId === "unfiled" ? "Unsorted" : selectedProject?.name ?? "Asset folder";

  const openMove = (item: MediaObject) => {
    const source = mediaProjectId(item.key);
    const firstFolder = visibleProjects.find((project) => project.id !== source)?.id;
    setMoveItem(item); setMoveProjectId(source === "unfiled" ? firstFolder ?? "" : "unfiled"); setMoveError("");
  };

  const move = async () => {
    if (!moveItem || !moveProjectId) return;
    setBusyKey(moveItem.key); setMoveError(""); setError("");
    try {
      const response = await fetch("/api/v1/media", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ key: moveItem.key, projectId: moveProjectId, kind: assetKind }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not move the file");
      setMoveItem(null); await Promise.all([load(cursor), loadProjects()]);
    } catch (cause) { setMoveError(cause instanceof Error ? cause.message : "Could not move the file"); }
    finally { setBusyKey(null); }
  };

  const toggleSelected = (item: MediaObject) => setSelectedItems((current) => current.some((selected) => selected.key === item.key) ? current.filter((selected) => selected.key !== item.key) : current.length >= 100 ? current : [...current, item]);

  return <div className="page page-enter"><div className="inline-heading"><div><h2>Asset library</h2><p>Keep videos, images, and licensed music in named R2 folders that you and your agents can reuse.</p></div><button className="primary-button" disabled={busyKey === "upload"} onClick={() => inputRef.current?.click()}>{busyKey === "upload" ? <LoaderCircle className="spin" /> : <Upload />} {busyKey === "upload" ? uploadProgress : `Upload to ${selectedName}`}</button><input ref={inputRef} className="visually-hidden" type="file" multiple accept={assetKind === "music" ? "audio/*" : "image/*,video/*"} onChange={(event) => void uploadFiles(event.target.files)} /></div>
    <div className="asset-kind-tabs"><button className={assetKind === "media" ? "active" : ""} onClick={() => switchAssetKind("media")}><Images/> Images & videos</button><button className={assetKind === "music" ? "active" : ""} onClick={() => switchAssetKind("music")}><Music2/> Music</button></div>
    <section className="media-projects"><header><div><p className="eyebrow">R2 folders</p><h3>Choose a reusable asset folder</h3></div><div className="media-project-header-actions">{selectedProject && <><button className="secondary-button" onClick={() => { setRenameProject(selectedProject); setRenameProjectName(selectedProject.name); setProjectError(""); }}><Pencil /> Rename folder</button><button className="danger-outline-button" onClick={() => { setDeleteProject(selectedProject); setProjectError(""); }}><Trash2 /> Delete folder</button></>}<button className="secondary-button" onClick={() => { setProjectName(""); setProjectError(""); setCreateOpen(true); }}><Plus /> New folder</button></div></header><div><button className={projectId === "all" ? "active" : ""} onClick={() => chooseProject("all")}><span><Images /></span><b>{assetKind === "music" ? "All music" : "All media"}</b><small>{assetKind === "music" ? "Every audio track" : "Every visual asset"}</small></button><button className={projectId === "unfiled" ? "active" : ""} onClick={() => chooseProject("unfiled")}><span><FolderOpen /></span><b>Unsorted</b><small>Existing and loose files</small></button>{visibleProjects.map((project) => <button className={projectId === project.id ? "active" : ""} onClick={() => chooseProject(project.id)} key={project.id}><span><Folder /></span><b>{project.name}</b><small>{project.count} item{project.count === 1 ? "" : "s"}</small></button>)}</div></section>
    {sequenceNotice && <div className="slideshow-notice success">{sequenceNotice}<button onClick={() => setSequenceNotice("")}><X/></button></div>}
    {selectedItems.length > 0 && <section className="media-selection-bar"><b>{selectedItems.length} selected</b><span>Selection stays active while you browse folders and pages.</span><button className="secondary-button" onClick={() => setSelectedItems([])}>Clear</button><button className="primary-button" onClick={() => setSequenceOpen(true)}><CalendarDays/> Schedule sequence</button></section>}
    {error && <div className="media-error"><CircleAlert />{error}<button onClick={() => void load(cursor)}>Retry</button></div>}
    {loading ? <div className="media-loading"><LoaderCircle className="spin" />Loading media from R2…</div> : items.length === 0 ? <Empty title={`${selectedName} is empty`} body={assetKind === "music" ? "Upload an audio track here, or choose another music folder." : "Upload an image or video here, or choose another media folder."} /> : <div className="media-grid">{items.map((item) => { const kind = mediaKind(item.name); const busy = busyKey === item.key; const selected = selectedItems.some((selectedItem) => selectedItem.key === item.key); return <article className={selected ? "selected" : ""} key={item.key}><div className="media-image">{kind === "image" ? <img src={item.url} alt={item.name} loading="lazy" /> : kind === "video" ? <video src={item.url} preload="metadata" muted /> : kind === "audio" ? <div className="media-audio"><Music2/><audio src={item.url} controls preload="metadata"/></div> : <span className="media-file"><FileIcon /></span>}{(kind === "image" || kind === "video") && <button className="media-select" aria-label={selected ? `Deselect ${item.name}` : `Select ${item.name}`} aria-pressed={selected} onClick={() => toggleSelected(item)}>{selected && <Check/>}</button>}<span>{kind === "video" ? <Video /> : kind === "image" ? <ImageIcon /> : kind === "audio" ? <Music2/> : <FileIcon />}{kind}</span><div className="media-actions">{(kind === "image" || kind === "video") && <button className="icon-button" disabled={busy} onClick={() => setPreviewItem(item)} aria-label={`Preview ${item.name}`} title="Preview"><Eye /></button>}<button className="icon-button" disabled={busy || visibleProjects.length === 0} onClick={() => openMove(item)} aria-label={`Move ${item.name}`} title="Move to folder"><FolderInput /></button><button className="icon-button" disabled={busy} onClick={() => { setRenameItem(item); setRenameName(item.name); }} aria-label={`Rename ${item.name}`}><Pencil /></button><button className="icon-button danger" disabled={busy} onClick={() => setDeleteItem(item)} aria-label={`Delete ${item.name}`}>{busy ? <LoaderCircle className="spin" /> : <Trash2 />}</button></div></div><div><b title={item.key}>{item.name}</b><span>{formatBytes(item.size)}{item.lastModified ? ` · ${new Date(item.lastModified).toLocaleDateString()}` : ""}</span></div>{kind === "audio" ? <button className="secondary-button" disabled>Ready for Video Studio</button> : kind === "file" ? <button className="secondary-button" disabled>Unsupported file</button> : <button className="secondary-button" onClick={() => onCompose({ name: item.name, url: item.url, previewUrl: item.url, type: kind })}>Use in post</button>}</article>; })}</div>}
    <div className="media-pagination"><button className="secondary-button" disabled={loading || history.length === 0} onClick={() => { const previous = history.at(-1) ?? null; setHistory((current) => current.slice(0, -1)); setCursor(previous); }}><ChevronLeft /> Previous</button><span><Cloud />Page {history.length + 1}</span><button className="secondary-button" disabled={loading || !nextCursor} onClick={() => { setHistory((current) => [...current, cursor]); setCursor(nextCursor); }}>Next <ChevronRight /></button></div>
    {createOpen && <PromptModal title="Create an asset folder" body="Name it after an app, brand, campaign, music mood, or anything else. Agents will see the same folder name." value={projectName} placeholder="e.g. Product launch" confirmLabel="Create folder" busy={projectBusy} error={projectError} onChange={setProjectName} onClose={() => setCreateOpen(false)} onConfirm={() => void createProject()} />}
    {renameProject && <PromptModal title="Rename asset folder" body="Only the folder label changes. Its R2 objects and links stay in place." value={renameProjectName} confirmLabel="Rename folder" busy={projectBusy} error={projectError} onChange={setRenameProjectName} onClose={() => setRenameProject(null)} onConfirm={() => void renameFolder()} />}
    {deleteProject && <ConfirmModal eyebrow="Delete R2 folder" title={`Delete ${deleteProject.name}?`} body={`This permanently removes the folder and its ${deleteProject.count} item${deleteProject.count === 1 ? "" : "s"} from Cloudflare. Posts and creative projects using those URLs may lose their media.`} confirmLabel="Delete folder" busy={projectBusy} error={projectError} onClose={() => setDeleteProject(null)} onConfirm={() => void removeFolder()} />}
    {renameItem && <PromptModal title="Rename media" body="Update the file name without changing where it is used." value={renameName} confirmLabel="Save name" busy={busyKey === renameItem.key} onChange={setRenameName} onClose={() => setRenameItem(null)} onConfirm={() => void rename()} />}
    {moveItem && <MoveMediaModal item={moveItem} projects={visibleProjects} value={moveProjectId} busy={busyKey === moveItem.key} error={moveError} onChange={setMoveProjectId} onClose={() => setMoveItem(null)} onConfirm={() => void move()} />}
    {previewItem && <MediaPreviewModal key={previewItem.key} item={previewItem} onClose={() => setPreviewItem(null)} />}
    {deleteItem && <ConfirmModal eyebrow="Delete media" title={`Delete ${deleteItem.name}?`} body="This permanently removes the file from Cloudflare. Posts already using this URL may lose their media." confirmLabel="Delete media" busy={busyKey === deleteItem.key} onClose={() => setDeleteItem(null)} onConfirm={() => void remove()} />}
    {sequenceOpen && <MediaSequenceModal items={selectedItems} publishingDefaults={sequencePublishingDefaults} demoMode={demoMode} onClose={() => setSequenceOpen(false)} onComplete={(message) => { setSequenceNotice(message); setSelectedItems([]); setSequenceOpen(false); }}/>}</div>;
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

type SettingsSection = "General" | "Workspace" | "Publishing" | "API keys" | "Storage" | "Providers" | "System" | "Appearance";

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
    <p>Create a content-management credential for Codex, Claude, or another trusted agent. It can manage posts, brands, media, creative projects, analytics, and publishing defaults, but cannot change your identity, keys, or provider connections.</p>
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

function PublishingDefaultsSettings({ defaults, onSaved }: { defaults: PublishingDefaults; onSaved: (value: PublishingDefaults) => void }) {
  const [draft, setDraft] = useState(defaults);
  const [busy, setBusy] = useState(false); const [error, setError] = useState(""); const [saved, setSaved] = useState(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(defaults);
  const save = async () => {
    setBusy(true); setError(""); setSaved(false);
    try {
      const response = await fetch("/api/v1/settings/publishing", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify(draft) });
      const payload = await response.json().catch(() => null) as { data?: PublishingDefaults; error?: string } | null;
      if (!response.ok || !payload?.data) throw new Error(payload?.error || "Could not save publishing defaults.");
      setDraft(payload.data); onSaved(payload.data); setSaved(true);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not save publishing defaults."); }
    finally { setBusy(false); }
  };
  return <><p>Choose the starting values used when you create a new post. Existing posts and templates keep their own settings.</p><div className="provider-defaults">
    <article><header><ProviderIcon id="instagram" selected /><div><b>Instagram</b><small>Relay chooses a format from the media type.</small></div></header><div className="provider-default-fields"><label>Single image<select aria-label="Instagram image default" value={draft.instagram.imagePublishType} onChange={(event) => { setSaved(false); setDraft((current) => ({ ...current, instagram: { ...current.instagram, imagePublishType: event.target.value as PublishingDefaults["instagram"]["imagePublishType"] } })); }}><option value="feed">Feed post</option><option value="story">Story</option></select></label><label>Video<select aria-label="Instagram video default" value={draft.instagram.videoPublishType} onChange={(event) => { setSaved(false); setDraft((current) => ({ ...current, instagram: { ...current.instagram, videoPublishType: event.target.value as PublishingDefaults["instagram"]["videoPublishType"] } })); }}><option value="reel">Reel</option><option value="feed">Feed post</option><option value="story">Story</option></select></label></div><p>Carousels always use Feed because Instagram does not accept them as Reels or Stories.</p></article>
    <article><header><ProviderIcon id="facebook" selected /><div><b>Facebook</b><small>Relay chooses the available format from the media type.</small></div></header><div className="provider-default-fields"><label>Single image<select aria-label="Facebook image default" value="feed" disabled><option value="feed">Feed post</option></select></label><label>Video<select aria-label="Facebook video default" value={draft.facebook.videoPublishType} onChange={(event) => { setSaved(false); setDraft((current) => ({ ...current, facebook: { videoPublishType: event.target.value as PublishingDefaults["facebook"]["videoPublishType"] } })); }}><option value="reel">Reel</option><option value="feed">Feed post</option></select></label></div><p>Facebook images—including multi-photo posts—publish to the Page feed. Only videos can use Reels.</p></article>
    <article><header><ProviderIcon id="tiktok" selected /><div><b>TikTok</b><small>Delivery, privacy, and interaction defaults.</small></div></header><div className="provider-default-fields"><label>Visibility<select aria-label="TikTok visibility default" value={draft.tiktok.privacyLevel} onChange={(event) => { setSaved(false); setDraft((current) => ({ ...current, tiktok: { ...current.tiktok, privacyLevel: event.target.value as PublishingDefaults["tiktok"]["privacyLevel"] } })); }}><option value="SELF_ONLY">Only me · finish in TikTok</option><option value="MUTUAL_FOLLOW_FRIENDS">Friends</option><option value="FOLLOWER_OF_CREATOR">Followers</option><option value="PUBLIC_TO_EVERYONE">Everyone</option></select></label></div><div className="provider-default-toggles"><label><input type="checkbox" disabled={draft.tiktok.privacyLevel === "SELF_ONLY"} checked={draft.tiktok.privacyLevel === "SELF_ONLY" ? false : draft.tiktok.allowComments} onChange={(event) => { setSaved(false); setDraft((current) => ({ ...current, tiktok: { ...current.tiktok, allowComments: event.target.checked } })); }} /> Comments</label><label><input type="checkbox" disabled={draft.tiktok.privacyLevel === "SELF_ONLY"} checked={draft.tiktok.privacyLevel === "SELF_ONLY" ? false : draft.tiktok.allowDuet} onChange={(event) => { setSaved(false); setDraft((current) => ({ ...current, tiktok: { ...current.tiktok, allowDuet: event.target.checked } })); }} /> Duet</label><label><input type="checkbox" disabled={draft.tiktok.privacyLevel === "SELF_ONLY"} checked={draft.tiktok.privacyLevel === "SELF_ONLY" ? false : draft.tiktok.allowStitch} onChange={(event) => { setSaved(false); setDraft((current) => ({ ...current, tiktok: { ...current.tiktok, allowStitch: event.target.checked } })); }} /> Stitch</label></div>{draft.tiktok.privacyLevel === "SELF_ONLY" && <p className="settings-note"><CircleAlert /> Sends media to the TikTok inbox for manual review and publishing.</p>}</article>
    <article><header><ProviderIcon id="youtube" selected /><div><b>YouTube</b><small>Upload visibility and audience defaults.</small></div></header><div className="provider-default-fields"><label>Visibility<select aria-label="YouTube visibility default" value={draft.youtube.privacyStatus} onChange={(event) => { setSaved(false); setDraft((current) => ({ ...current, youtube: { ...current.youtube, privacyStatus: event.target.value as PublishingDefaults["youtube"]["privacyStatus"] } })); }}><option value="public">Public</option><option value="unlisted">Unlisted</option><option value="private">Private</option></select></label></div><div className="provider-default-toggles"><label><input type="checkbox" checked={draft.youtube.madeForKids} onChange={(event) => { setSaved(false); setDraft((current) => ({ ...current, youtube: { ...current.youtube, madeForKids: event.target.checked } })); }} /> Made for kids</label></div><p>Titles, tags, and links stay post-specific.</p></article>
  </div>{error && <p className="auth-error" role="alert">{error}</p>}<div className="publishing-default-actions"><button className="primary-button" disabled={busy || !dirty} onClick={() => void save()}>{busy ? <LoaderCircle className="spin" /> : <Check />}{busy ? "Saving…" : "Save publishing defaults"}</button>{saved && <span><Check /> Defaults saved</span>}</div></>;
}

function SettingsView({ theme, setTheme, go, user, publishingDefaults, onPublishingDefaultsChanged, initialSection = "General" }: { theme: string; setTheme: (value: string) => void; go: (view: View) => void; user: { name: string; email: string; role: string }; publishingDefaults: PublishingDefaults; onPublishingDefaultsChanged: (value: PublishingDefaults) => void; initialSection?: SettingsSection }) {
  const accounts = useAccounts();
  const sections: SettingsSection[] = ["General", "Workspace", "Publishing", "API keys", "Storage", "Providers", "System", "Appearance"];
  const [section, setSection] = useState<SettingsSection>(initialSection);
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
      {section === "Publishing" && <PublishingDefaultsSettings defaults={publishingDefaults} onSaved={onPublishingDefaultsChanged} />}
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

function ComposerMediaLibrary({ onClose, onSelect, imagesOnly = false, jpegOnly = false, title = "Choose from your library" }: { onClose: () => void; onSelect: (media: ComposerMedia) => void; imagesOnly?: boolean; jpegOnly?: boolean; title?: string }) {
  const [items, setItems] = useState<MediaObject[]>([]);
  const [projects, setProjects] = useState<MediaProject[]>([]); const [projectId, setProjectId] = useState("all");
  const [mediaType, setMediaType] = useState<"all" | "image" | "video">(imagesOnly ? "image" : "all");
  const [cursor, setCursor] = useState<string | null>(null);
  const [history, setHistory] = useState<(string | null)[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => { void fetch("/api/v1/media/projects", { cache: "no-store" }).then(async (response) => { const payload = await response.json() as { data?: MediaProject[] }; if (response.ok) setProjects(payload.data ?? []); }); }, []);

  const pageParams = (pageCursor: string | null) => {
    const params = new URLSearchParams({ limit: "12", project: projectId });
    if (pageCursor) params.set("cursor", pageCursor);
    if (mediaType !== "all") params.set("mediaType", mediaType);
    return params;
  };

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true); setError("");
    void fetch(`/api/v1/media?${pageParams(cursor)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => {
      const payload = await response.json() as { data?: MediaObject[]; pagination?: { nextCursor?: string | null }; error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not load the media library");
      setItems(payload.data ?? []); setNextCursor(payload.pagination?.nextCursor ?? null);
    }).catch((reason) => { if (reason instanceof DOMException && reason.name === "AbortError") return; setError(reason instanceof Error ? reason.message : "Could not load the media library"); }).finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [cursor, projectId, mediaType]);

  const goToLastPage = async () => {
    if (!nextCursor) return;
    setLoading(true); setError("");
    try {
      const previousCursors = [...history, cursor];
      let lastCursor = nextCursor;
      let lastItems: MediaObject[] = [];
      let remaining: string | null = nextCursor;
      while (remaining) {
        lastCursor = remaining;
        const response = await fetch(`/api/v1/media?${pageParams(remaining)}`, { cache: "no-store" });
        const payload = await response.json() as { data?: MediaObject[]; pagination?: { nextCursor?: string | null }; error?: string };
        if (!response.ok) throw new Error(payload.error || "Could not load the last media page");
        lastItems = payload.data ?? [];
        remaining = payload.pagination?.nextCursor ?? null;
        if (remaining) previousCursors.push(lastCursor);
      }
      setItems(lastItems); setCursor(lastCursor); setHistory(previousCursors); setNextCursor(null);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Could not load the last media page"); }
    finally { setLoading(false); }
  };

  const visibleItems = items.filter((item) => { const kind = mediaKind(item.name); return imagesOnly ? kind === "image" && (jpegOnly ? /\.jpe?g$/i.test(item.name) : /\.(jpe?g|png)$/i.test(item.name)) : kind === "image" || kind === "video"; });
  const emptyTitle = imagesOnly ? jpegOnly ? "No JPEG covers here" : "No images here" : "This media project is empty";
  const emptyBody = imagesOnly ? jpegOnly ? "Choose another folder or upload a JPEG from your device." : "Choose another folder or upload a JPEG or PNG from your device." : "Upload from your device or choose another project.";
  return <div className="modal-layer media-picker-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close media library" /><section className="media-picker" role="dialog" aria-modal="true" aria-labelledby="media-picker-title"><header><div><p className="eyebrow">Cloudflare R2</p><h2 id="media-picker-title">{title}</h2></div><button className="icon-button" onClick={onClose} aria-label="Close"><X /></button></header><div className="media-picker-filters"><label className="media-project-select"><Folder />Media project<select value={projectId} onChange={(event) => { setProjectId(event.target.value); setCursor(null); setHistory([]); }}><option value="all">All media</option><option value="unfiled">Unsorted</option>{projects.map((project) => <option value={project.id} key={project.id}>{project.name}</option>)}</select></label>{!imagesOnly && <label className="media-project-select"><Images />Media type<select aria-label="Media type" value={mediaType} onChange={(event) => { setMediaType(event.target.value as typeof mediaType); setCursor(null); setHistory([]); }}><option value="all">Images & videos</option><option value="image">Images only</option><option value="video">Videos only</option></select></label>}</div>{error && <div className="media-error"><CircleAlert />{error}</div>}{loading ? <div className="media-loading"><LoaderCircle className="spin" />Loading your media…</div> : visibleItems.length === 0 ? <Empty title={emptyTitle} body={emptyBody} /> : <div className="media-picker-grid">{visibleItems.map((item) => { const kind = mediaKind(item.name) as "image" | "video"; return <button key={item.key} onClick={() => onSelect({ name: item.name, url: item.url, previewUrl: item.url, type: kind })}><span>{kind === "image" ? <img src={item.url} alt="" /> : <video src={item.url} muted preload="metadata" />}</span><b>{item.name}</b><small>{formatBytes(item.size)} · {kind}</small></button>; })}</div>}<footer><button className="secondary-button" disabled={loading || history.length === 0} onClick={() => { const previous = history.at(-1) ?? null; setHistory((current) => current.slice(0, -1)); setCursor(previous); }}><ChevronLeft /> Previous</button><span>Page {history.length + 1}</span><button className="secondary-button" disabled={loading || !nextCursor} onClick={() => { setHistory((current) => [...current, cursor]); setCursor(nextCursor); }}>Next <ChevronRight /></button><button className="secondary-button" disabled={loading || !nextCursor} onClick={() => void goToLastPage()}>Last <ChevronsRight /></button></footer></section></div>;
}

function VideoFramePicker({ videoUrl, initialOffsetMs, platform = "Video", captureImage = false, onClose, onSelect }: { videoUrl: string; initialOffsetMs?: number; platform?: string; captureImage?: boolean; onClose: () => void; onSelect: (offsetMs: number, image?: Blob) => void | Promise<void> }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [durationMs, setDurationMs] = useState(0);
  const [offsetMs, setOffsetMs] = useState(initialOffsetMs ?? 0);
  const [busy, setBusy] = useState(false); const [error, setError] = useState("");
  const position = (next: number) => { const normalized = Math.max(0, Math.min(next, durationMs)); setOffsetMs(normalized); if (videoRef.current) videoRef.current.currentTime = normalized / 1_000; };
  const select = async () => {
    if (!videoRef.current) return;
    setBusy(true); setError("");
    try {
      let image: Blob | undefined;
      if (captureImage) {
        const video = videoRef.current; const longest = Math.max(video.videoWidth, video.videoHeight); const scale = Math.min(1, 1280 / longest);
        const canvas = document.createElement("canvas"); canvas.width = Math.max(1, Math.round(video.videoWidth * scale)); canvas.height = Math.max(1, Math.round(video.videoHeight * scale));
        const context = canvas.getContext("2d"); if (!context) throw new Error("This browser could not capture the frame.");
        context.drawImage(video, 0, 0, canvas.width, canvas.height);
        image = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("This browser could not create the thumbnail.")), "image/jpeg", .86));
        if (image.size > 2 * 1024 * 1024) image = await new Promise<Blob>((resolve, reject) => canvas.toBlob((blob) => blob ? resolve(blob) : reject(new Error("This browser could not compress the thumbnail.")), "image/jpeg", .65));
        if (image.size > 2 * 1024 * 1024) throw new Error("The selected frame is larger than YouTube's 2 MB thumbnail limit.");
      }
      await onSelect(offsetMs, image);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not use this frame."); }
    finally { setBusy(false); }
  };
  return <div className="modal-layer media-picker-layer"><button className="modal-scrim" disabled={busy} onClick={onClose} aria-label="Close frame picker" /><section className="frame-picker" role="dialog" aria-modal="true" aria-labelledby="frame-picker-title"><header><div><p className="eyebrow">{platform} cover</p><h2 id="frame-picker-title">Choose a frame</h2></div><button className="icon-button" disabled={busy} onClick={onClose} aria-label="Close"><X /></button></header><video ref={videoRef} crossOrigin={captureImage ? "anonymous" : undefined} src={videoUrl} muted playsInline preload="auto" onLoadedMetadata={(event) => { const duration = Math.round(event.currentTarget.duration * 1_000); const initial = Math.min(initialOffsetMs ?? Math.round(duration / 2), duration); setDurationMs(duration); setOffsetMs(initial); event.currentTarget.currentTime = initial / 1_000; }} onSeeked={(event) => event.currentTarget.pause()} /><label>Frame position <span>{(offsetMs / 1_000).toFixed(1)}s</span><input type="range" min="0" max={durationMs || 1} step="100" value={Math.min(offsetMs, durationMs || 1)} disabled={busy} onChange={(event) => position(Number(event.target.value))} /></label>{error && <p className="composer-error" role="alert"><CircleAlert />{error}</p>}<footer><button className="secondary-button" disabled={busy} onClick={onClose}>Cancel</button><button className="primary-button" disabled={!durationMs || busy} onClick={() => void select()}>{busy ? <LoaderCircle className="spin" /> : <Check />} {busy ? "Creating thumbnail…" : "Use this frame"}</button></footer></section></div>;
}

type ComposerMode = "create" | "duplicate" | "edit";

function Composer({ onClose, onSave, publishingDefaults, initialMedia = null, initialPost = null, initialText = "", initialBrandId, initialScheduledAt, mode = "create", demoMode = false, initialCampaigns = [], initialTemplates = [] }: { onClose: () => void; onSave: (post: RelayPost, mode: ComposerMode) => Promise<boolean>; publishingDefaults: PublishingDefaults; initialMedia?: ComposerMedia | null; initialPost?: RelayPost | null; initialText?: string; initialBrandId?: string; initialScheduledAt?: Date | null; mode?: ComposerMode; demoMode?: boolean; initialCampaigns?: Campaign[]; initialTemplates?: PostTemplate[] }) {
  const brands = useBrands();
  const accounts = useAccounts();
  const mediaInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const youtubeThumbnailInputRef = useRef<HTMLInputElement>(null);
  const scheduleInputRef = useRef<HTMLInputElement>(null);
  const localPreviewRef = useRef<string | null>(null);
  const localCoverPreviewRef = useRef<string | null>(null);
  const localYoutubeThumbnailPreviewRef = useRef<string | null>(null);
  const requestedBrandId = initialPost?.brandId ?? initialBrandId;
  const reusableBrandId = requestedBrandId && brands.some((brand) => brand.id === requestedBrandId) ? requestedBrandId : requestedBrandId === "" ? "" : brands[0]?.id ?? "";
  const reusableTargets = initialPost?.targets.filter((target) => accounts.some((account) => account.id === target.accountId && account.brandId === (reusableBrandId || null))) ?? [];
  const reusableSetting = <T extends ProviderPostSettings["kind"],>(kind: T) => reusableTargets.find((target) => target.settings.kind === kind)?.settings as Extract<ProviderPostSettings, { kind: T }> | undefined;
  const instagramDefaults = reusableSetting("instagram");
  const facebookDefaults = reusableSetting("facebook");
  const tiktokDefaults = reusableSetting("tiktok");
  const youtubeDefaults = reusableSetting("youtube");
  const reusableMedia = initialMedia ?? (initialPost?.mediaUrl && initialPost.mediaType !== "none" ? { name: initialPost.mediaUrl.split("/").at(-1) || "Saved media", url: initialPost.mediaUrl, previewUrl: initialPost.mediaUrl, type: initialPost.mediaType, urls: initialPost.mediaUrls } : null);
  const [text, setText] = useState(initialPost?.text ?? initialText); const [brandId, setBrandId] = useState(reusableBrandId);
  const [campaignId, setCampaignId] = useState(initialPost?.campaignId ?? "");
  const [campaigns, setCampaigns] = useState<Campaign[]>(initialCampaigns); const [templates, setTemplates] = useState<PostTemplate[]>(initialTemplates);
  const [campaignCreateOpen, setCampaignCreateOpen] = useState(false); const [campaignName, setCampaignName] = useState("");
  const [campaignCreateBusy, setCampaignCreateBusy] = useState(false); const [campaignCreateError, setCampaignCreateError] = useState("");
  const available = accounts.filter((account) => account.brandId === (brandId || null));
  const [selected, setSelected] = useState<string[]>(reusableTargets.map((target) => target.accountId));
  const [variants, setVariants] = useState<Partial<Record<ProviderId, string>>>(() => Object.fromEntries(reusableTargets.filter((target) => target.textOverride).map((target) => [target.provider, target.textOverride])));
  const [previewMode, setPreviewMode] = useState<"feed" | "mobile">("feed");
  const [previewProvider, setPreviewProvider] = useState<ProviderId | null>(reusableTargets[0]?.provider ?? null);
  const [instagramType, setInstagramType] = useState<"feed" | "reel" | "story">(instagramDefaults?.publishType ?? (reusableMedia?.type === "video" ? publishingDefaults.instagram.videoPublishType : publishingDefaults.instagram.imagePublishType));
  const [instagramCoverUrl, setInstagramCoverUrl] = useState(instagramDefaults?.coverUrl ?? "");
  const [instagramCoverPreview, setInstagramCoverPreview] = useState(instagramDefaults?.coverUrl ?? "");
  const [instagramThumbOffsetMs, setInstagramThumbOffsetMs] = useState<number | undefined>(instagramDefaults?.thumbOffsetMs);
  const [videoDurationMs, setVideoDurationMs] = useState(0);
  const [facebookType, setFacebookType] = useState<"feed" | "reel">(facebookDefaults?.publishType ?? (reusableMedia?.type === "video" ? publishingDefaults.facebook.videoPublishType : "feed"));
  const [facebookLink, setFacebookLink] = useState(facebookDefaults?.linkUrl ?? "");
  const [tiktokPrivacy, setTiktokPrivacy] = useState<"PUBLIC_TO_EVERYONE" | "MUTUAL_FOLLOW_FRIENDS" | "FOLLOWER_OF_CREATOR" | "SELF_ONLY">(tiktokDefaults?.privacyLevel ?? publishingDefaults.tiktok.privacyLevel);
  const [tiktokComments, setTiktokComments] = useState(tiktokDefaults?.allowComments ?? publishingDefaults.tiktok.allowComments);
  const [tiktokDuet, setTiktokDuet] = useState(tiktokDefaults?.allowDuet ?? publishingDefaults.tiktok.allowDuet);
  const [tiktokStitch, setTiktokStitch] = useState(tiktokDefaults?.allowStitch ?? publishingDefaults.tiktok.allowStitch);
  const [tiktokThumbOffsetMs, setTiktokThumbOffsetMs] = useState<number | undefined>(tiktokDefaults?.thumbOffsetMs);
  const [youtubeTitle, setYoutubeTitle] = useState(youtubeDefaults?.title ?? "");
  const [youtubeTags, setYoutubeTags] = useState(youtubeDefaults?.tags.join(", ") ?? "");
  const [youtubePrivacy, setYoutubePrivacy] = useState<"private" | "unlisted" | "public">(youtubeDefaults?.privacyStatus ?? publishingDefaults.youtube.privacyStatus);
  const [youtubeMadeForKids, setYoutubeMadeForKids] = useState(youtubeDefaults?.madeForKids ?? publishingDefaults.youtube.madeForKids);
  const [youtubeThumbnailUrl, setYoutubeThumbnailUrl] = useState(youtubeDefaults?.thumbnailUrl ?? "");
  const [youtubeThumbnailPreview, setYoutubeThumbnailPreview] = useState(youtubeDefaults?.thumbnailUrl ?? "");
  const [mediaOrientation, setMediaOrientation] = useState<"unknown" | "portrait" | "landscape" | "square">("unknown");
  const instagramTypeTouched = useRef(Boolean(instagramDefaults)); const facebookTypeTouched = useRef(Boolean(facebookDefaults));
  const [media, setMedia] = useState<ComposerMedia | null>(reusableMedia);
  const previousMediaShape = useRef(`${reusableMedia?.type ?? "none"}:${(reusableMedia?.urls?.length ?? (reusableMedia ? 1 : 0)) > 1 ? "multi" : "single"}`);
  const [mediaSource, setMediaSource] = useState<"choose" | "library" | null>(null);
  const [coverSource, setCoverSource] = useState<"instagram-library" | "instagram-frame" | "tiktok-frame" | "youtube-library" | "youtube-frame" | null>(null);
  const [coverBusy, setCoverBusy] = useState(false); const [coverError, setCoverError] = useState("");
  const [mediaBusy, setMediaBusy] = useState(false); const [mediaError, setMediaError] = useState("");
  const [schedule, setSchedule] = useState(initialPost?.status === "scheduled" || !initialPost);
  const [scheduledAt, setScheduledAt] = useState(() => { const date = initialPost?.scheduledAt ? new Date(initialPost.scheduledAt) : initialScheduledAt ? new Date(initialScheduledAt) : new Date(); if (!initialPost?.scheduledAt && !initialScheduledAt) date.setDate(date.getDate() + 1); if (!initialPost?.scheduledAt) date.setHours(9, 30, 0, 0); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); });
  const [recovered, setRecovered] = useState(false);
  const [saved, setSaved] = useState(true);
  const [submitBusy, setSubmitBusy] = useState(false); const [submitError, setSubmitError] = useState("");
  useEffect(() => { if (demoMode) return; void Promise.all([fetch("/api/v1/campaigns", { cache: "no-store" }), fetch("/api/v1/templates", { cache: "no-store" })]).then(async ([campaignResponse, templateResponse]) => { const [campaignPayload, templatePayload] = await Promise.all([campaignResponse.json(), templateResponse.json()]) as [{ data?: Campaign[] }, { data?: PostTemplate[] }]; if (campaignResponse.ok) setCampaigns(campaignPayload.data ?? []); if (templateResponse.ok) setTemplates(templatePayload.data ?? []); }).catch(() => undefined); }, [demoMode]);
  useEffect(() => { if (mode !== "create" || initialScheduledAt) return; const draft = parseComposerDraft(window.localStorage.getItem(COMPOSER_DRAFT_KEY)); if (!draft) return; setText(draft.text); setBrandId(draft.brandId); setCampaignId(draft.campaignId); setSelected(draft.selected); setVariants(draft.variants); setSchedule(draft.schedule); setScheduledAt(draft.scheduledAt); if (draft.media) setMedia(draft.media); setRecovered(true); }, [mode, initialScheduledAt]);
  useEffect(() => { setSaved(false); const timeout = setTimeout(() => { if (mode === "create") window.localStorage.setItem(COMPOSER_DRAFT_KEY, JSON.stringify({ version: 1, text, brandId, campaignId, selected, variants, media: media?.url ? media : undefined, schedule, scheduledAt, updatedAt: new Date().toISOString() })); setSaved(true); }, 700); return () => clearTimeout(timeout); }, [text, brandId, campaignId, selected, variants, media, schedule, scheduledAt, mode]);
  useEffect(() => () => { if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current); if (localCoverPreviewRef.current) URL.revokeObjectURL(localCoverPreviewRef.current); if (localYoutubeThumbnailPreviewRef.current) URL.revokeObjectURL(localYoutubeThumbnailPreviewRef.current); }, []);
  useEffect(() => { setMediaOrientation("unknown"); }, [media?.previewUrl]);
  const mediaCount = media?.urls?.length ?? (media ? 1 : 0);
  const unavailableReason = (account: SocialAccount) => account.provider === "youtube" && media?.type === "image" ? "YouTube requires video" : account.provider === "instagram" && mediaCount > 10 ? "Instagram supports up to 10 slides" : "";
  const selectableAccounts = available.filter((account) => !unavailableReason(account));
  useEffect(() => { setSelected((current) => current.filter((id) => { const account = accounts.find((item) => item.id === id); return account && !unavailableReason(account); })); }, [media?.type, mediaCount, accounts]);
  useEffect(() => {
    const shape = `${media?.type ?? "none"}:${mediaCount > 1 ? "multi" : "single"}`;
    if (mediaCount > 1) { setInstagramType("feed"); setFacebookType("feed"); previousMediaShape.current = shape; return; }
    if (shape === previousMediaShape.current) return;
    previousMediaShape.current = shape;
    if (!instagramTypeTouched.current) setInstagramType(media?.type === "video" ? publishingDefaults.instagram.videoPublishType : publishingDefaults.instagram.imagePublishType);
    if (media?.type !== "video") setFacebookType("feed");
    else if (!facebookTypeTouched.current) setFacebookType(publishingDefaults.facebook.videoPublishType);
  }, [media?.type, mediaCount, publishingDefaults]);
  const selectedAccounts = selectableAccounts.filter((account) => selected.includes(account.id));
  const selectedProviders = [...new Set(selectedAccounts.map((account) => account.provider))];
  const activePreviewProvider = previewProvider && selectedProviders.includes(previewProvider) ? previewProvider : selectedProviders[0] ?? null;
  const isInstagramImmersivePreview = activePreviewProvider === "instagram" && (instagramType === "reel" || instagramType === "story");
  const isFacebookReelPreview = activePreviewProvider === "facebook" && facebookType === "reel";
  const isTikTokPreview = activePreviewProvider === "tiktok";
  const isYoutubeShortPreview = activePreviewProvider === "youtube" && media?.type === "video" && mediaOrientation !== "landscape";
  const isYoutubeWatchPreview = activePreviewProvider === "youtube" && !isYoutubeShortPreview;
  const isImmersivePreview = isInstagramImmersivePreview || isFacebookReelPreview || isTikTokPreview || isYoutubeShortPreview;
  const previewSurfaceLabel = activePreviewProvider === "tiktok" ? "Following   For You" : activePreviewProvider === "youtube" ? "Shorts" : instagramType === "story" && activePreviewProvider === "instagram" ? "Stories" : "Reels";
  const previewText = (activePreviewProvider ? variants[activePreviewProvider]?.trim() : "") || text || (media ? "Media ready to publish." : "Start writing to preview your post across social networks.");
  const previewBrandName = brands.find((brand) => brand.id === brandId)?.name ?? "Unassigned";
  const recordMediaDimensions = (width: number, height: number) => { if (!width || !height) return; const ratio = width / height; setMediaOrientation(ratio < .86 ? "portrait" : ratio > 1.14 ? "landscape" : "square"); };
  const recordVideoMetadata = (video: HTMLVideoElement) => {
    recordMediaDimensions(video.videoWidth, video.videoHeight);
    if (!Number.isFinite(video.duration) || video.duration <= 0) return;
    const duration = Math.round(video.duration * 1_000); setVideoDurationMs(duration);
    if (!instagramCoverUrl && instagramThumbOffsetMs === undefined) setInstagramThumbOffsetMs(Math.round(duration / 2));
    if (tiktokThumbOffsetMs === undefined) setTiktokThumbOffsetMs(Math.round(duration / 2));
  };
  const timezone = brands.find((brand) => brand.id === brandId)?.timezone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  const youtubeReady = !selectedProviders.includes("youtube") || youtubeTitle.trim().length > 0;
  const hasContent = Boolean(text.trim() || media);
  const addMedia = async (file: File) => {
    setMediaBusy(true); setMediaError("");
    if (localYoutubeThumbnailPreviewRef.current) URL.revokeObjectURL(localYoutubeThumbnailPreviewRef.current); localYoutubeThumbnailPreviewRef.current = null;
    setInstagramCoverUrl(""); setInstagramCoverPreview(""); setInstagramThumbOffsetMs(undefined); setTiktokThumbOffsetMs(undefined); setYoutubeThumbnailUrl(""); setYoutubeThumbnailPreview(""); setVideoDurationMs(0);
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
  const clearYoutubeThumbnail = () => { if (localYoutubeThumbnailPreviewRef.current) URL.revokeObjectURL(localYoutubeThumbnailPreviewRef.current); localYoutubeThumbnailPreviewRef.current = null; setYoutubeThumbnailUrl(""); setYoutubeThumbnailPreview(""); };
  const resetCovers = () => { setInstagramCoverUrl(""); setInstagramCoverPreview(""); setInstagramThumbOffsetMs(undefined); setTiktokThumbOffsetMs(undefined); clearYoutubeThumbnail(); setVideoDurationMs(0); };
  const chooseLibraryMedia = (item: ComposerMedia) => { if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current); localPreviewRef.current = null; setMedia(item); setMediaSource(null); setMediaError(""); resetCovers(); };
  const removeMedia = () => { if (localPreviewRef.current) URL.revokeObjectURL(localPreviewRef.current); localPreviewRef.current = null; setMedia(null); resetCovers(); };
  const uploadCover = async (file: File, target: "instagram" | "youtube") => {
    const type = file.type.trim().toLowerCase();
    if (target === "instagram" && type !== "image/jpeg") { setCoverError("Instagram Reel covers uploaded through Relay must be JPEG files."); return; }
    if (target === "youtube" && type !== "image/jpeg" && type !== "image/png") { setCoverError("YouTube thumbnails uploaded through Relay must be JPEG or PNG files."); return; }
    if (target === "youtube" && file.size > 2 * 1024 * 1024) { setCoverError("YouTube thumbnails must be 2 MB or smaller."); return; }
    setCoverBusy(true); setCoverError("");
    const previewRef = target === "instagram" ? localCoverPreviewRef : localYoutubeThumbnailPreviewRef;
    if (previewRef.current) URL.revokeObjectURL(previewRef.current);
    const previewUrl = URL.createObjectURL(file); previewRef.current = previewUrl;
    if (target === "instagram") setInstagramCoverPreview(previewUrl); else setYoutubeThumbnailPreview(previewUrl);
    try {
      const signedResponse = await fetch("/api/v1/media", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fileName: file.name, contentType: file.type }) });
      const signed = await signedResponse.json() as { uploadUrl?: string; url?: string; error?: string };
      if (!signedResponse.ok || !signed.uploadUrl || !signed.url) throw new Error(signed.error || "Could not prepare the cover upload");
      let url = signed.url;
      try { const direct = await fetch(signed.uploadUrl, { method: "PUT", headers: { "Content-Type": file.type }, body: file }); if (!direct.ok) throw new Error("Direct upload failed"); }
      catch { const form = new FormData(); form.append("file", file); const fallbackResponse = await fetch("/api/v1/media", { method: "POST", body: form }); const fallback = await fallbackResponse.json() as { url?: string; error?: string }; if (!fallbackResponse.ok || !fallback.url) throw new Error(fallback.error || "R2 rejected the cover upload"); url = fallback.url; }
      if (target === "instagram") { setInstagramCoverUrl(url); setInstagramThumbOffsetMs(undefined); } else setYoutubeThumbnailUrl(url);
    } catch (cause) { URL.revokeObjectURL(previewUrl); previewRef.current = null; if (target === "instagram") { setInstagramCoverPreview(""); setInstagramCoverUrl(""); } else { setYoutubeThumbnailPreview(""); setYoutubeThumbnailUrl(""); } setCoverError(cause instanceof Error ? cause.message : "Cover upload failed"); }
    finally { setCoverBusy(false); const input = target === "instagram" ? coverInputRef.current : youtubeThumbnailInputRef.current; if (input) input.value = ""; }
  };
  const chooseCoverImage = (item: ComposerMedia, target: "instagram" | "youtube") => { const previewRef = target === "instagram" ? localCoverPreviewRef : localYoutubeThumbnailPreviewRef; if (previewRef.current) URL.revokeObjectURL(previewRef.current); previewRef.current = null; if (target === "instagram") { setInstagramCoverUrl(item.url); setInstagramCoverPreview(item.previewUrl); setInstagramThumbOffsetMs(undefined); } else { setYoutubeThumbnailUrl(item.url); setYoutubeThumbnailPreview(item.previewUrl); } setCoverSource(null); setCoverError(""); };
  const useMiddleCover = () => { if (localCoverPreviewRef.current) URL.revokeObjectURL(localCoverPreviewRef.current); localCoverPreviewRef.current = null; setInstagramCoverUrl(""); setInstagramCoverPreview(""); setInstagramThumbOffsetMs(videoDurationMs ? Math.round(videoDurationMs / 2) : undefined); setCoverError(""); };
  const openSchedulePicker = () => { const input = scheduleInputRef.current; if (!input) return; if (typeof input.showPicker === "function") input.showPicker(); else input.focus(); };
  const settingsFor = (provider: ProviderId): ProviderPostSettings => {
    if (provider === "instagram") return { kind: "instagram", publishType: instagramType, coverUrl: media?.type === "video" && instagramType === "reel" ? instagramCoverUrl || undefined : undefined, thumbOffsetMs: media?.type === "video" && instagramType === "reel" && !instagramCoverUrl ? instagramThumbOffsetMs : undefined };
    if (provider === "facebook") return { kind: "facebook", publishType: facebookType, linkUrl: facebookLink.trim() || undefined };
    if (provider === "tiktok") return { kind: "tiktok", privacyLevel: tiktokPrivacy, allowComments: tiktokPrivacy === "SELF_ONLY" ? false : tiktokComments, allowDuet: tiktokPrivacy === "SELF_ONLY" ? false : tiktokDuet, allowStitch: tiktokPrivacy === "SELF_ONLY" ? false : tiktokStitch, thumbOffsetMs: media?.type === "video" && tiktokPrivacy !== "SELF_ONLY" ? tiktokThumbOffsetMs : undefined };
    return { kind: "youtube", title: youtubeTitle.trim(), tags: [...new Set(youtubeTags.split(",").map((tag) => tag.trim()).filter(Boolean))], privacyStatus: youtubePrivacy, madeForKids: youtubeMadeForKids, thumbnailUrl: media?.type === "video" ? youtubeThumbnailUrl || undefined : undefined };
  };
  const plannedDestinations = selectedAccounts.map((account) => ({ provider: account.provider, settings: settingsFor(account.provider), textOverride: variants[account.provider] }));
  const validationIssues = validatePostPlan({ text, mediaType: media?.type ?? "none", mediaCount, scheduledAt: schedule ? scheduledAt : null, destinations: plannedDestinations });
  if (selectedProviders.includes("instagram") && media?.type === "video" && instagramType === "reel" && !instagramCoverUrl && instagramThumbOffsetMs === undefined) validationIssues.push({ provider: "instagram", field: "settings", message: "Waiting for the video duration to choose its middle cover frame." });
  if (selectedProviders.includes("tiktok") && media?.type === "video" && tiktokPrivacy !== "SELF_ONLY" && tiktokThumbOffsetMs === undefined) validationIssues.push({ provider: "tiktok", field: "settings", message: "Waiting for the video duration to choose its middle cover frame." });
  const canSaveDraft = Boolean(hasContent && selected.length > 0);
  const canSubmit = Boolean(hasContent && selected.length > 0 && youtubeReady && validationIssues.length === 0 && !coverBusy);
  const applyTemplate = (templateId: string) => {
    const template = templates.find((item) => item.id === templateId); if (!template) return;
    setText(template.text); if (template.brandId) { setBrandId(template.brandId); setSelected([]); }
    const instagram = template.settings.instagram; if (instagram?.kind === "instagram") { instagramTypeTouched.current = true; setInstagramType(instagram.publishType); setInstagramCoverUrl(instagram.coverUrl ?? ""); setInstagramCoverPreview(instagram.coverUrl ?? ""); setInstagramThumbOffsetMs(instagram.thumbOffsetMs); }
    const facebook = template.settings.facebook; if (facebook?.kind === "facebook") { facebookTypeTouched.current = true; setFacebookType(facebook.publishType); setFacebookLink(facebook.linkUrl ?? ""); }
    const tiktok = template.settings.tiktok; if (tiktok?.kind === "tiktok") { setTiktokPrivacy(tiktok.privacyLevel); setTiktokComments(tiktok.allowComments); setTiktokDuet(tiktok.allowDuet); setTiktokStitch(tiktok.allowStitch); setTiktokThumbOffsetMs(tiktok.thumbOffsetMs); }
    const youtube = template.settings.youtube; if (youtube?.kind === "youtube") { setYoutubeTitle(youtube.title); setYoutubeTags(youtube.tags.join(", ")); setYoutubePrivacy(youtube.privacyStatus); setYoutubeMadeForKids(youtube.madeForKids); setYoutubeThumbnailUrl(youtube.thumbnailUrl ?? ""); setYoutubeThumbnailPreview(youtube.thumbnailUrl ?? ""); }
  };
  const saveTemplate = async () => {
    const name = text.trim().split(/\s+/).slice(0, 6).join(" ") || "Untitled template";
    const settings = Object.fromEntries(selectedProviders.map((provider) => [provider, settingsFor(provider)]));
    const response = await fetch("/api/v1/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name, brandId, text, mediaType: media?.type ?? "none", settings }) });
    const payload = await response.json() as { data?: PostTemplate; error?: string }; if (response.ok && payload.data) setTemplates((current) => [payload.data!, ...current]); else setSubmitError(payload.error || "Could not save the template.");
  };
  const createCampaign = async () => {
    if (!campaignName.trim() || campaignCreateBusy) return;
    setCampaignCreateBusy(true); setCampaignCreateError("");
    try {
      const response = await fetch("/api/v1/campaigns", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: campaignName.trim(), brandId }) });
      const payload = await response.json() as { data?: Campaign; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error || "Could not create the campaign.");
      setCampaigns((current) => [payload.data!, ...current.filter((campaign) => campaign.id !== payload.data!.id)]);
      setCampaignId(payload.data.id); setCampaignName(""); setCampaignCreateOpen(false);
    } catch (cause) { setCampaignCreateError(cause instanceof Error ? cause.message : "Could not create the campaign."); }
    finally { setCampaignCreateBusy(false); }
  };
  const submit = async (requestedStatus?: "draft") => {
    if ((requestedStatus === "draft" ? !canSaveDraft : !canSubmit) || submitBusy) return;
    setSubmitBusy(true); setSubmitError("");
    const status = requestedStatus ?? (schedule ? "scheduled" as const : "publishing" as const);
    const targets = selectedAccounts.map((account, index) => ({ id: reusableTargets.find((target) => target.accountId === account.id)?.id ?? `new-target-${index}`, accountId: account.id, provider: account.provider, status, settings: settingsFor(account.provider), textOverride: variants[account.provider]?.trim() || undefined }));
    const created = await onSave({ id: mode === "edit" ? initialPost?.id ?? "" : "", brandId, campaignId: campaignId || undefined, text, mediaType: media?.type ?? "none", mediaUrl: media?.url, mediaUrls: media?.urls?.length ? media.urls : media?.url ? [media.url] : undefined, status, scheduledAt: status === "scheduled" ? new Date(scheduledAt).toISOString() : undefined, targets }, mode);
    if (created && mode === "create") window.localStorage.removeItem(COMPOSER_DRAFT_KEY);
    if (created) onClose();
    else { setSubmitError("Relay could not save this post. Review the message and try again."); setSubmitBusy(false); }
  };
  const previewMediaNode = (immersive = false) => media ? <div className={immersive ? "reel-media" : "preview-media"}>{media.type === "video" ? <video src={media.previewUrl} muted controls={!immersive} playsInline loop={immersive} autoPlay={immersive} onLoadedMetadata={(event) => recordVideoMetadata(event.currentTarget)} /> : <img src={media.previewUrl} alt={media.name} onLoad={(event) => recordMediaDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />}{mediaBusy && <span><LoaderCircle className="spin" />Uploading…</span>}</div> : <div className="preview-placeholder"><span className="preview-glyph"><i /><i /></span><p>Your media will appear here</p></div>;
  return <div className="composer-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close composer" /><section className="composer" role="dialog" aria-modal="true" aria-label={mode === "edit" ? "Edit post" : "Create post"}>
    <header><div><button className="icon-button mobile-only" onClick={onClose}><ArrowLeft /></button><span className="composer-mark"><Send /></span><div><p className="eyebrow">{mode === "edit" ? "Edit post" : mode === "duplicate" ? "Post again" : recovered ? "Draft recovered" : "New post"}</p><h2>{mode === "edit" ? "Refine it before it leaves." : "Create once. Relay everywhere."}</h2></div></div><div><span className={`save-state ${saved ? "saved" : ""}`}>{saved ? <><Check /> {mode === "create" ? "Draft saved" : "Ready"}</> : "Saving…"}</span><button className="icon-button desktop-only" onClick={onClose}><X /></button></div></header>
    <div className="composer-body"><main>
      <span className="field-label" id="composer-brand-label">Brand <span className="optional-label">optional</span></span><div className="brand-select" role="group" aria-labelledby="composer-brand-label">{accounts.some((account) => account.brandId === null) && <button className={!brandId ? "active" : ""} onClick={() => { setBrandId(""); setCampaignId(""); setSelected([]); }}><span className="brand-mark small"><Users /></span>Unassigned{!brandId && <Check />}</button>}{brands.map((brand) => <button className={brandId === brand.id ? "active" : ""} onClick={() => { setBrandId(brand.id); setCampaignId(""); setSelected([]); }} key={brand.id}><BrandMark brandId={brand.id} size="small" />{brand.name}{brandId === brand.id && <Check />}</button>)}{accounts.length === 0 && <p className="inline-empty">Connect a social account before composing a post.</p>}</div>
      <div className="composer-planning-row"><label>Campaign <span>optional</span><div className="campaign-select-row"><select value={campaignId} onChange={(event) => setCampaignId(event.target.value)}><option value="">No campaign</option>{campaigns.filter((campaign) => !campaign.brandId || campaign.brandId === brandId).map((campaign) => <option value={campaign.id} key={campaign.id}>{campaign.name}</option>)}</select><button type="button" className="campaign-create-button" onClick={() => { setCampaignCreateError(""); setCampaignCreateOpen(true); }}><Plus /> Create</button></div></label><label>Start from template <span>optional</span><select defaultValue="" onChange={(event) => { applyTemplate(event.target.value); event.currentTarget.value = ""; }}><option value="">Choose a template</option>{templates.filter((template) => !template.brandId || template.brandId === brandId).map((template) => <option value={template.id} key={template.id}>{template.name}</option>)}</select></label><button className="secondary-button" disabled={!text.trim()} onClick={() => void saveTemplate()}><FileText /> Save template</button></div>
      <label className="field-label" htmlFor="caption">Content</label><div className="caption-box"><textarea id="caption" autoFocus value={text} onChange={(event) => setText(event.target.value)} placeholder="What do you want to share?" />{media && <div className="composer-media"><span>{media.type === "video" ? <Video /> : <ImageIcon />}</span><div><b>{media.name}</b><small>{mediaBusy ? "Uploading to Cloudflare R2…" : mediaCount > 1 ? `${mediaCount} ordered slides ready` : "Ready from your media library"}</small></div><button aria-label="Remove media" onClick={removeMedia}><X /></button></div>}<div><button disabled={mediaBusy} onClick={() => setMediaSource("choose")}>{mediaBusy ? <LoaderCircle className="spin" /> : <ImageIcon />} {mediaBusy ? "Uploading…" : media ? "Replace media" : "Add media"}</button><input ref={mediaInputRef} className="visually-hidden" type="file" accept="image/*,video/*" onChange={(event) => { const file = event.target.files?.[0]; if (file) void addMedia(file); }} /><span>{text.length} / 2,200</span></div></div>{mediaError && <p className="composer-error" role="alert"><CircleAlert />{mediaError}</p>}
      <div className="dest-heading"><div><label className="field-label">Publish to</label><p>Select the destinations for this post.</p></div><button className="select-all-button" onClick={() => setSelected(selected.length === selectableAccounts.length ? [] : selectableAccounts.map((account) => account.id))}>{selected.length === selectableAccounts.length && selectableAccounts.length > 0 ? "Clear" : "Select all"}</button></div>
      <div className="destination-list">{available.map((account) => { const reason = unavailableReason(account); const isSelected = selected.includes(account.id); return <button className={isSelected ? "selected" : ""} disabled={Boolean(reason)} aria-describedby={reason ? `destination-${account.id}-reason` : undefined} onClick={() => setSelected(isSelected ? selected.filter((id) => id !== account.id) : [...selected, account.id])} key={account.id}><span className="check-box">{isSelected && <Check />}</span><ProviderIcon id={account.provider} selected={isSelected} /><span><b>{providerRegistry.get(account.provider).name}</b><small id={reason ? `destination-${account.id}-reason` : undefined}>{reason || account.handle}</small></span><em>{reason ? "Unavailable" : isSelected ? <><Check /> Selected</> : "Not selected"}</em></button>; })}{available.length === 0 && <p className="inline-empty">No connected accounts are available.</p>}</div>
      {selectedProviders.length > 0 && <section className="platform-settings"><div className="platform-settings-heading"><span className="field-label">Network captions</span><p>Leave a field empty to use the shared caption.</p></div><div className="network-variants">{selectedProviders.map((provider) => <label key={provider}><span><ProviderIcon id={provider} />{providerRegistry.get(provider).name}</span><textarea value={variants[provider] ?? ""} onChange={(event) => setVariants((current) => ({ ...current, [provider]: event.target.value }))} placeholder={`Use shared caption (${text.length} characters)`} /></label>)}</div><div className="platform-settings-heading"><span className="field-label">Platform settings</span><p>These values are stored separately for each destination.</p></div>
        {selectedProviders.includes("instagram") && <div className="platform-card"><div className="platform-card-title"><ProviderIcon id="instagram" /><span><b>Instagram</b><small>{mediaCount > 1 ? "Carousel posts publish to the feed in slide order." : "Choose where the media appears."}</small></span></div><label>Publish as<select disabled={mediaCount > 1} value={instagramType} onChange={(event) => { instagramTypeTouched.current = true; setInstagramType(event.target.value as typeof instagramType); }}><option value="feed">Feed post</option>{mediaCount <= 1 && <><option value="reel">Reel</option><option value="story">Story</option></>}</select></label>{media?.type === "video" && instagramType === "reel" && <div className="reel-cover-control"><div className="reel-cover-preview">{instagramCoverPreview ? <img src={instagramCoverPreview} alt="Selected Instagram Reel cover" /> : <video src={media.previewUrl} muted playsInline preload="metadata" onLoadedMetadata={(event) => { recordVideoMetadata(event.currentTarget); event.currentTarget.currentTime = (instagramThumbOffsetMs ?? 0) / 1_000; }} onSeeked={(event) => event.currentTarget.pause()} />}</div><div><b>Reel cover</b><small>{coverBusy ? "Uploading cover…" : instagramCoverUrl ? "Custom JPEG" : instagramThumbOffsetMs !== undefined ? `Video frame at ${(instagramThumbOffsetMs / 1_000).toFixed(1)}s` : "Loading midpoint…"}</small><div><button className="secondary-button" disabled={!videoDurationMs || coverBusy} onClick={useMiddleCover}>Middle</button><button className="secondary-button" disabled={!videoDurationMs || coverBusy} onClick={() => setCoverSource("instagram-frame")}>Choose frame</button><button className="secondary-button" disabled={coverBusy} onClick={() => coverInputRef.current?.click()}>Upload JPEG</button><button className="secondary-button" disabled={coverBusy} onClick={() => setCoverSource("instagram-library")}>Media folder</button></div></div><input ref={coverInputRef} className="visually-hidden" type="file" accept="image/jpeg,.jpg,.jpeg" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadCover(file, "instagram"); }} /></div>}{coverError && <p className="composer-error" role="alert"><CircleAlert />{coverError}</p>}</div>}
        {selectedProviders.includes("facebook") && <div className="platform-card"><div className="platform-card-title"><ProviderIcon id="facebook" /><span><b>Facebook</b><small>{media?.type === "video" ? "Choose Feed or Reel for this video." : mediaCount > 1 ? "Multi-photo posts publish to the Page feed in slide order." : "Images publish to the Page feed."}</small></span></div><div className="platform-grid"><label>Publish as<select value={facebookType} onChange={(event) => { facebookTypeTouched.current = true; setFacebookType(event.target.value as typeof facebookType); }}><option value="feed">Feed post</option>{media?.type === "video" && <option value="reel">Reel</option>}</select></label><label>Link URL <span>optional</span><input type="url" value={facebookLink} onChange={(event) => setFacebookLink(event.target.value)} placeholder="https://…" /></label></div>{media?.type === "video" && facebookType === "reel" && <p className="settings-note"><CircleAlert /> Facebook's Reel publishing API chooses the cover automatically; Meta does not currently accept a custom cover from Relay.</p>}</div>}
        {selectedProviders.includes("tiktok") && <div className="platform-card"><div className="platform-card-title"><ProviderIcon id="tiktok" /><span><b>TikTok</b><small>Only account-allowed options will be used at publish time.</small></span></div><label>Who can watch<select value={tiktokPrivacy} onChange={(event) => setTiktokPrivacy(event.target.value as typeof tiktokPrivacy)}><option value="SELF_ONLY">Only me · finish in TikTok</option><option value="MUTUAL_FOLLOW_FRIENDS">Friends</option><option value="FOLLOWER_OF_CREATOR">Followers</option><option value="PUBLIC_TO_EVERYONE">Everyone</option></select></label><div className="toggle-row"><label><input type="checkbox" disabled={tiktokPrivacy === "SELF_ONLY"} checked={tiktokPrivacy === "SELF_ONLY" ? false : tiktokComments} onChange={(event) => setTiktokComments(event.target.checked)} /> Comments</label><label><input type="checkbox" disabled={tiktokPrivacy === "SELF_ONLY"} checked={tiktokPrivacy === "SELF_ONLY" ? false : tiktokDuet} onChange={(event) => setTiktokDuet(event.target.checked)} /> Duet</label><label><input type="checkbox" disabled={tiktokPrivacy === "SELF_ONLY"} checked={tiktokPrivacy === "SELF_ONLY" ? false : tiktokStitch} onChange={(event) => setTiktokStitch(event.target.checked)} /> Stitch</label></div>{media?.type === "video" && tiktokPrivacy !== "SELF_ONLY" && <div className="reel-cover-control compact-cover-control"><div className="reel-cover-preview"><video src={media.previewUrl} muted playsInline preload="metadata" onLoadedMetadata={(event) => { recordVideoMetadata(event.currentTarget); event.currentTarget.currentTime = (tiktokThumbOffsetMs ?? 0) / 1_000; }} onSeeked={(event) => event.currentTarget.pause()} /></div><div><b>Video cover</b><small>{tiktokThumbOffsetMs !== undefined ? `Video frame at ${(tiktokThumbOffsetMs / 1_000).toFixed(1)}s` : "Loading midpoint…"}</small><div><button className="secondary-button" disabled={!videoDurationMs} onClick={() => setTiktokThumbOffsetMs(Math.round(videoDurationMs / 2))}>Middle</button><button className="secondary-button" disabled={!videoDurationMs} onClick={() => setCoverSource("tiktok-frame")}>Choose frame</button></div></div></div>}<p className="settings-note"><CircleAlert /> {tiktokPrivacy === "SELF_ONLY" ? "Relay will send this to your TikTok inbox. Choose the cover in TikTok when you finish publishing." : "Relay will query TikTok creator info and publish directly using the selected visibility and cover frame."}</p></div>}
        {selectedProviders.includes("youtube") && <div className="platform-card"><div className="platform-card-title"><ProviderIcon id="youtube" /><span><b>YouTube</b><small>Video metadata and an optional custom thumbnail sent with the upload.</small></span></div><label>Video title <span>required</span><input value={youtubeTitle} maxLength={100} onChange={(event) => setYoutubeTitle(event.target.value)} placeholder="Add a YouTube title" /></label><label>Tags <span>comma-separated</span><input value={youtubeTags} onChange={(event) => setYoutubeTags(event.target.value)} placeholder="product, tutorial, behind the scenes" /></label><div className="platform-grid"><label>Visibility<select value={youtubePrivacy} onChange={(event) => setYoutubePrivacy(event.target.value as typeof youtubePrivacy)}><option value="private">Private</option><option value="unlisted">Unlisted</option><option value="public">Public</option></select></label><label className="checkbox-field"><input type="checkbox" checked={youtubeMadeForKids} onChange={(event) => setYoutubeMadeForKids(event.target.checked)} /> Made for kids</label></div>{media?.type === "video" && <div className="reel-cover-control"><div className="reel-cover-preview">{youtubeThumbnailPreview ? <img src={youtubeThumbnailPreview} alt="Selected YouTube thumbnail" /> : <video src={media.previewUrl} muted playsInline preload="metadata" onLoadedMetadata={(event) => recordVideoMetadata(event.currentTarget)} />}</div><div><b>Custom thumbnail</b><small>{coverBusy ? "Uploading thumbnail…" : youtubeThumbnailUrl ? "Custom JPEG or PNG" : "Optional · YouTube will generate one"}</small><div><button className="secondary-button" disabled={!videoDurationMs || coverBusy} onClick={() => setCoverSource("youtube-frame")}>Choose frame</button><button className="secondary-button" disabled={coverBusy} onClick={() => youtubeThumbnailInputRef.current?.click()}>Upload image</button><button className="secondary-button" disabled={coverBusy} onClick={() => setCoverSource("youtube-library")}>Media folder</button>{youtubeThumbnailUrl && <button className="secondary-button" disabled={coverBusy} onClick={() => { clearYoutubeThumbnail(); setCoverError(""); }}>Use automatic</button>}</div></div><input ref={youtubeThumbnailInputRef} className="visually-hidden" type="file" accept="image/jpeg,image/png,.jpg,.jpeg,.png" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadCover(file, "youtube"); }} /></div>}{coverError && <p className="composer-error" role="alert"><CircleAlert />{coverError}</p>}</div>}
      </section>}
    </main><aside className="preview-panel">
      <div className="preview-head"><span>{activePreviewProvider ? `${providerRegistry.get(activePreviewProvider).name} preview` : "Preview"}</span><div className="segmented compact" aria-label="Preview format">{(["feed", "mobile"] as const).map((preview) => <button key={preview} className={previewMode === preview ? "active" : ""} aria-pressed={previewMode === preview} onClick={() => setPreviewMode(preview)}>{preview[0].toUpperCase() + preview.slice(1)}</button>)}</div></div>
      {selectedProviders.length > 0 && <div className="preview-provider-tabs" aria-label="Preview destination">{selectedProviders.map((provider) => <button key={provider} className={activePreviewProvider === provider ? "active" : ""} aria-pressed={activePreviewProvider === provider} onClick={() => setPreviewProvider(provider)}><ProviderIcon id={provider} /><span>{providerRegistry.get(provider).name}</span></button>)}</div>}
      <div className={`social-preview ${previewMode} ${activePreviewProvider ? `provider-${activePreviewProvider}` : ""} ${isImmersivePreview ? "format-reel" : ""} ${isYoutubeWatchPreview ? "format-watch" : ""}`}>
        {previewMode === "mobile" && <div className="phone-status"><b>9:41</b><span>● ◒ ▰</span></div>}
        {isImmersivePreview ? <><div className="reel-stage">{previewMediaNode(true)}<div className="reel-topbar"><b>{previewSurfaceLabel}</b>{activePreviewProvider === "youtube" ? <Search /> : activePreviewProvider === "tiktok" ? <Search /> : <Camera />}</div><div className="reel-actions" aria-hidden="true"><span><Heart /></span><span><MessageCircle /></span><span><Share2 /></span><span><MoreHorizontal /></span></div><div className="reel-copy"><div><BrandMark brandId={brandId} size="small" /><b>{previewBrandName}</b></div>{activePreviewProvider === "youtube" && youtubeTitle.trim() && <strong>{youtubeTitle}</strong>}<p className="preview-caption-text">{previewText}</p><small><Music2 /> {activePreviewProvider === "youtube" ? "Original sound" : "Original audio"}</small></div></div>{previewMode === "mobile" && <div className="phone-home-indicator" />}</> : isYoutubeWatchPreview ? <><div className="youtube-watch-media">{previewMediaNode()}</div><div className="youtube-watch-copy"><h4>{youtubeTitle.trim() || "Add a YouTube title"}</h4><p className="preview-caption-text">{previewText}</p><div><span><BrandMark brandId={brandId} size="small" /><b>{previewBrandName}</b></span><small>{youtubePrivacy} · just now</small></div></div>{previewMode === "mobile" && <div className="phone-home-indicator" />}</> : <><div className="preview-account"><BrandMark brandId={brandId} size="small" /><span><b>{previewBrandName}</b><small>{activePreviewProvider ? providerRegistry.get(activePreviewProvider).name : "Preview"} · just now</small></span><MoreHorizontal /></div>{activePreviewProvider === "facebook" && <p className="preview-caption-text facebook-preview-caption">{previewText}</p>}{previewMediaNode()}<div className="preview-actions"><span><Heart /></span><span><MessageCircle /></span><span><Share2 /></span></div>{activePreviewProvider !== "facebook" && <p className="preview-caption-text">{previewText}</p>}{previewMode === "mobile" && <div className="phone-home-indicator" />}</>}
      </div>
      <div className="validation"><h4>Destination check</h4>{selectedAccounts.map((account) => { const issue = validationIssues.find((item) => item.provider === account.provider || !item.provider); return <div key={account.id}><ProviderIcon id={account.provider} /><span>{providerRegistry.get(account.provider).name}</span>{issue ? <em title={issue.message}><CircleAlert /> {issue.message}</em> : <em className="ready"><Check /> Ready</em>}</div>; })}</div>
    </aside></div>
    {submitError && <p className="composer-submit-error" role="alert"><CircleAlert />{submitError}</p>}<footer><div className="schedule-choice"><button className={!schedule ? "active" : ""} onClick={() => setSchedule(false)}><Zap /> Publish now</button><button className={schedule ? "active" : ""} onClick={() => setSchedule(true)}><Clock3 /> Schedule</button>{schedule && <div className="schedule-date" role="button" tabIndex={0} onClick={(event) => { if (event.target !== scheduleInputRef.current) openSchedulePicker(); }} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); openSchedulePicker(); } }}><CalendarDays /><input ref={scheduleInputRef} aria-label={`Publish date and time in ${timezone}`} title={`Publish date and time in ${timezone}`} type="datetime-local" value={scheduledAt} min={new Date().toISOString().slice(0, 16)} onChange={(event) => setScheduledAt(event.target.value)} /><small>{timezone}</small></div>}</div><button className="secondary-button composer-draft-button" disabled={!canSaveDraft || mediaBusy || submitBusy} onClick={() => void submit("draft")}>Save draft</button><button className="publish-button" disabled={!canSubmit || mediaBusy || submitBusy} onClick={() => void submit()}>{submitBusy ? <><LoaderCircle className="spin" />Saving…</> : <>{mode === "edit" ? "Save changes" : schedule ? "Schedule post" : "Start publishing"}<Send /></>}</button></footer>
  </section>{campaignCreateOpen && <PromptModal eyebrow="Campaigns" title="Create a campaign" body={brandId ? `This campaign will be available to posts for ${brands.find((brand) => brand.id === brandId)?.name ?? "this brand"}.` : "Use campaigns to group related posts across your calendar and analytics."} value={campaignName} placeholder="e.g. September launch" confirmLabel="Create campaign" busy={campaignCreateBusy} error={campaignCreateError} onChange={setCampaignName} onClose={() => { if (!campaignCreateBusy) { setCampaignCreateOpen(false); setCampaignName(""); setCampaignCreateError(""); } }} onConfirm={() => void createCampaign()} />}{mediaSource === "choose" && <div className="modal-layer media-picker-layer"><button className="modal-scrim" onClick={() => setMediaSource(null)} aria-label="Close media options" /><section className="media-source-modal" role="dialog" aria-modal="true" aria-labelledby="media-source-title"><header><div><p className="eyebrow">Add media</p><h2 id="media-source-title">Where is your media?</h2></div><button className="icon-button" onClick={() => setMediaSource(null)} aria-label="Close"><X /></button></header><div><button onClick={() => { setMediaSource(null); mediaInputRef.current?.click(); }}><span><Upload /></span><b>Upload from device</b><small>Choose a new image or video. Relay will save it to R2.</small><ChevronRight /></button><button onClick={() => setMediaSource("library")}><span><Cloud /></span><b>Choose from library</b><small>Reuse media already stored in Cloudflare R2.</small><ChevronRight /></button></div></section></div>}{mediaSource === "library" && <ComposerMediaLibrary onClose={() => setMediaSource(null)} onSelect={chooseLibraryMedia} />}{coverSource === "instagram-library" && <ComposerMediaLibrary imagesOnly jpegOnly title="Choose a Reel cover" onClose={() => setCoverSource(null)} onSelect={(item) => chooseCoverImage(item, "instagram")} />}{coverSource === "youtube-library" && <ComposerMediaLibrary imagesOnly title="Choose a YouTube thumbnail" onClose={() => setCoverSource(null)} onSelect={(item) => chooseCoverImage(item, "youtube")} />}{coverSource === "instagram-frame" && media?.type === "video" && <VideoFramePicker videoUrl={media.previewUrl} initialOffsetMs={instagramThumbOffsetMs ?? (videoDurationMs ? Math.round(videoDurationMs / 2) : undefined)} onClose={() => setCoverSource(null)} onSelect={(offsetMs) => { if (localCoverPreviewRef.current) URL.revokeObjectURL(localCoverPreviewRef.current); localCoverPreviewRef.current = null; setInstagramCoverUrl(""); setInstagramCoverPreview(""); setInstagramThumbOffsetMs(offsetMs); setCoverSource(null); setCoverError(""); }} />}{coverSource === "tiktok-frame" && media?.type === "video" && <VideoFramePicker videoUrl={media.previewUrl} initialOffsetMs={tiktokThumbOffsetMs ?? (videoDurationMs ? Math.round(videoDurationMs / 2) : undefined)} onClose={() => setCoverSource(null)} onSelect={(offsetMs) => { setTiktokThumbOffsetMs(offsetMs); setCoverSource(null); }} />}{coverSource === "youtube-frame" && media?.type === "video" && <VideoFramePicker platform="YouTube" captureImage videoUrl={media.previewUrl} initialOffsetMs={videoDurationMs ? Math.round(videoDurationMs / 2) : undefined} onClose={() => setCoverSource(null)} onSelect={async (offsetMs, image) => { setCoverSource(null); if (image) await uploadCover(new File([image], `youtube-frame-${offsetMs}.jpg`, { type: "image/jpeg" }), "youtube"); }} />}</div>;
}

function CommandMenu({ posts, brands, accounts, onClose, go, compose, openPost, composeMedia }: { posts: RelayPost[]; brands: Brand[]; accounts: SocialAccount[]; onClose: () => void; go: (v: View) => void; compose: () => void; openPost: (post: RelayPost) => void; composeMedia: (media: ComposerMedia) => void }) {
  const [query, setQuery] = useState(""); const [active, setActive] = useState(0); const [media, setMedia] = useState<MediaObject[]>([]);
  useEffect(() => { void fetch("/api/v1/media?limit=100", { cache: "no-store" }).then(async (response) => { const payload = await response.json() as { data?: MediaObject[] }; if (response.ok) setMedia(payload.data ?? []); }).catch(() => undefined); }, []);
  const closeAfter = (action: () => void) => () => { action(); onClose(); };
  const actions: Array<{ id: string; name: string; detail: string; icon: typeof Search; action: () => void }> = [
    { id: "create", name: "Create post", detail: "New draft or scheduled post", icon: Plus, action: compose },
    { id: "slides", name: "Create slideshow", detail: "Open Slide Studio", icon: Images, action: () => go("slideshows") },
    { id: "videos", name: "Create labeled video", detail: "Open Video Studio and bulk hooks", icon: Video, action: () => go("videos") },
    { id: "calendar", name: "Open campaign planner", detail: "Calendar and bulk planning", icon: CalendarDays, action: () => go("calendar") },
    { id: "accounts", name: "Connect account", detail: "Instagram, Facebook, TikTok, or YouTube", icon: Users, action: () => go("accounts") },
    { id: "media", name: "Upload media", detail: "Open the media library", icon: ImageIcon, action: () => go("media") },
  ];
  const needle = query.trim().toLowerCase();
  const results = needle ? [
    ...posts.filter((post) => `${post.text} ${post.campaignName ?? ""} ${post.status}`.toLowerCase().includes(needle)).map((post) => ({ id: `post-${post.id}`, name: post.text || "Media post", detail: `Post · ${post.status}${post.campaignName ? ` · ${post.campaignName}` : ""}`, icon: FileText, action: () => openPost(post) })),
    ...brands.filter((brand) => `${brand.name} ${brand.timezone}`.toLowerCase().includes(needle)).map((brand) => ({ id: `brand-${brand.id}`, name: brand.name, detail: `Brand · ${brand.timezone}`, icon: LayoutGrid, action: () => go("brands") })),
    ...accounts.filter((account) => `${account.displayName} ${account.handle} ${account.provider}`.toLowerCase().includes(needle)).map((account) => ({ id: `account-${account.id}`, name: account.displayName, detail: `${providerRegistry.get(account.provider).name} · ${account.handle}`, icon: Users, action: () => go("accounts") })),
    ...media.filter((item) => item.name.toLowerCase().includes(needle) && mediaKind(item.name) === "image" || mediaKind(item.name) === "video").map((item) => ({ id: `media-${item.key}`, name: item.name, detail: `Media · ${formatBytes(item.size)}`, icon: ImageIcon, action: () => { const type = mediaKind(item.name); if (type === "image" || type === "video") composeMedia({ name: item.name, url: item.url, previewUrl: item.url, type }); } })),
    ...actions.filter((item) => `${item.name} ${item.detail}`.toLowerCase().includes(needle)),
  ].slice(0, 10) : actions;
  useEffect(() => setActive(0), [query]);
  return <div className="modal-layer command-layer"><button className="modal-scrim" onClick={onClose} aria-label="Close command menu" /><div className="command-menu" role="dialog" aria-modal="true" aria-label="Search Relay"><div><Search /><input autoFocus value={query} placeholder="Search posts, media, brands, accounts…" onChange={(event) => setQuery(event.target.value)} onKeyDown={(event) => { if (event.key === "ArrowDown") { event.preventDefault(); setActive((value) => Math.min(results.length - 1, value + 1)); } else if (event.key === "ArrowUp") { event.preventDefault(); setActive((value) => Math.max(0, value - 1)); } else if (event.key === "Enter" && results[active]) { event.preventDefault(); closeAfter(results[active].action)(); } }} /><kbd>ESC</kbd></div><p>{needle ? `${results.length} result${results.length === 1 ? "" : "s"}` : "Quick actions"}</p>{results.map(({ id, name, detail, icon: Icon, action }, index) => <button className={active === index ? "active" : ""} key={id} onMouseEnter={() => setActive(index)} onClick={closeAfter(action)}><Icon /><span><b>{name}</b><small>{detail}</small></span><em>↵</em></button>)}{results.length === 0 && <div className="command-empty"><Search /><b>No matching Relay items</b><span>Try a post caption, media name, brand, or account.</span></div>}<footer><span><Command /> Relay command menu</span><span>↑↓ Navigate · ↵ Select</span></footer></div></div>;
}

export default function RelayApp({ user, initialBrands, initialAccounts, initialPosts, initialPublishingDefaults, initialNow, initialView = "home", demoMode = false }: { user: { name: string; email: string; role: string }; initialBrands: Brand[]; initialAccounts: SocialAccount[]; initialPosts: RelayPost[]; initialPublishingDefaults: PublishingDefaults; initialNow: string; initialView?: View; demoMode?: boolean }) {
  useModalAccessibility();
  const [view, setView] = useState<View>(initialView); const [posts, setPosts] = useState(initialPosts);
  const [settingsLanding, setSettingsLanding] = useState<SettingsSection>("General");
  const [brandList, setBrandList] = useState(initialBrands);
  const [accountList, setAccountList] = useState(initialAccounts);
  const [publishingDefaults, setPublishingDefaults] = useState(initialPublishingDefaults);
  const [composer, setComposer] = useState(false); const [composerMedia, setComposerMedia] = useState<ComposerMedia | null>(null); const [composerPost, setComposerPost] = useState<RelayPost | null>(null); const [composerSeed, setComposerSeed] = useState<{ text: string; brandId: string } | null>(null); const [composerScheduledAt, setComposerScheduledAt] = useState<Date | null>(null); const [composerMode, setComposerMode] = useState<ComposerMode>("create"); const [command, setCommand] = useState(false); const [menu, setMenu] = useState(false); const [theme, setTheme] = useState("light"); const [toast, setToast] = useState(""); const [toastTone, setToastTone] = useState<"success" | "error">("success");
  const [notifications, setNotifications] = useState<RelayNotification[]>(demoMode ? demoNotifications : []); const [notificationsOpen, setNotificationsOpen] = useState(false); const [notificationsLoading, setNotificationsLoading] = useState(!demoMode);
  const [themeReady, setThemeReady] = useState(false);
  const [logoutConfirm, setLogoutConfirm] = useState(false); const [logoutBusy, setLogoutBusy] = useState(false); const [logoutError, setLogoutError] = useState("");
  const [pendingPostDelete, setPendingPostDelete] = useState<RelayPost | null>(null); const [postDeleteBusy, setPostDeleteBusy] = useState(false); const [postDeleteError, setPostDeleteError] = useState("");
  const navigate = useCallback((next: View) => { if (next === "settings") setSettingsLanding("General"); setView(next); window.history.pushState({ relayView: next }, "", relayViewUrl(next, new URL(window.location.href))); }, []);
  const openApiKeySettings = useCallback(() => { setSettingsLanding("API keys"); setView("settings"); window.history.pushState({ relayView: "settings" }, "", relayViewUrl("settings", new URL(window.location.href))); }, []);
  useEffect(() => { const handle = () => setView(parseRelayView(new URL(window.location.href).searchParams.get("view"))); window.addEventListener("popstate", handle); return () => window.removeEventListener("popstate", handle); }, []);
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
    if (demoMode) { setNotificationsLoading(false); return; }
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
  }, [demoMode]);
  useEffect(() => {
    if (demoMode) return;
    let active = true;
    const load = async () => {
      const response = await fetch("/api/v1/posts", { cache: "no-store" }).catch(() => null);
      if (!response?.ok) return;
      const payload = await response.json() as { data?: RelayPost[] };
      if (active && payload.data) setPosts(payload.data);
    };
    const interval = window.setInterval(() => void load(), 10_000);
    return () => { active = false; window.clearInterval(interval); };
  }, [demoMode]);
  useEffect(() => { const handle = (event: KeyboardEvent) => { if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") { event.preventDefault(); setCommand(true); } if (event.key === "Escape") { setComposer(false); setCommand(false); } }; window.addEventListener("keydown", handle); return () => window.removeEventListener("keydown", handle); }, []);
  const openComposer = (media: ComposerMedia | null = null, post: RelayPost | null = null, mode: ComposerMode = post ? "duplicate" : "create", scheduledAt: Date | null = null) => { setComposerMedia(media); setComposerPost(post); setComposerSeed(null); setComposerScheduledAt(scheduledAt); setComposerMode(mode); setComposer(true); };
  const openCreativeComposer = (seed: { media: ComposerMedia; text: string; brandId: string }) => { setComposerMedia(seed.media); setComposerPost(null); setComposerSeed({ text: seed.text, brandId: seed.brandId }); setComposerScheduledAt(null); setComposerMode("create"); setComposer(true); };
  const closeComposer = () => { setComposer(false); setComposerMedia(null); setComposerPost(null); setComposerSeed(null); setComposerScheduledAt(null); setComposerMode("create"); };
  const refreshNotifications = async () => {
    const response = await fetch("/api/v1/notifications", { cache: "no-store" });
    const payload = await response.json() as { data?: RelayNotification[] };
    if (response.ok) setNotifications(payload.data ?? []);
  };
  const recordPostNotifications = async (post: RelayPost) => {
    if (demoMode) return;
    const items = post.targets.map((target) => {
      const platform = providerRegistry.get(target.provider).name;
      const isTikTokInbox = target.provider === "tiktok" && target.settings.kind === "tiktok" && target.settings.privacyLevel === "SELF_ONLY";
      const account = accountList.find((item) => item.id === target.accountId);
      const destination = account ? `${account.displayName} (${account.handle})` : "the selected account";
      const kind: NotificationKind = target.status === "failed" ? "error" : target.status === "published" ? "success" : target.status === "scheduled" ? "scheduled" : "info";
      const title = kind === "error" ? `${platform} could not ${isTikTokInbox ? "send the post to your inbox" : "publish the post"}` : kind === "success" ? isTikTokInbox ? "Sent to your TikTok inbox" : `Post published on ${platform}` : kind === "scheduled" ? `${platform} post scheduled` : isTikTokInbox ? "Sending to your TikTok inbox" : `Publishing to ${platform}`;
      const message = kind === "error"
        ? target.error || `${platform} did not provide a detailed reason. Check the connected account, media requirements, and permissions before retrying.`
        : kind === "success" ? isTikTokInbox ? `Open TikTok on ${destination} to review and publish the post manually.` : `${destination} returned a successful publishing result.`
          : kind === "scheduled" && post.scheduledAt ? `Scheduled for ${new Date(post.scheduledAt).toLocaleString()} on ${destination}.`
            : isTikTokInbox ? `Relay queued this post for the TikTok inbox on ${destination}.` : `Relay queued this post for ${destination}. Waiting for provider confirmation.`;
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
  const saveDemoPost = (post: RelayPost, mode: ComposerMode): boolean => {
    const savedPost: RelayPost = {
      ...post,
      id: mode === "edit" && post.id ? post.id : `demo-post-${Date.now()}`,
      createdAt: post.createdAt ?? new Date().toISOString(),
      targets: post.targets.map((target) => ({ ...target, externalUrl: undefined, error: undefined, analytics: undefined })),
    };
    setPosts((current) => mode === "edit" && current.some((item) => item.id === savedPost.id)
      ? current.map((item) => item.id === savedPost.id ? savedPost : item)
      : [savedPost, ...current]);
    setToastTone("success");
    setToast(savedPost.status === "scheduled" ? "Demo post scheduled" : savedPost.status === "draft" ? "Demo draft saved" : "Demo post published (demo only)");
    setTimeout(() => setToast(""), 4000);
    return true;
  };
  const addPost = async (post: RelayPost): Promise<boolean> => {
    if (demoMode) return saveDemoPost(post, "create");
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
  const savePost = async (post: RelayPost, mode: ComposerMode): Promise<boolean> => {
    if (mode !== "edit") return addPost(post);
    if (demoMode) return saveDemoPost(post, "edit");
    try {
      const response = await fetch("/api/v1/posts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(post) });
      const payload = await response.json() as { data?: RelayPost; error?: string };
      if (!response.ok || !payload.data) throw new Error(payload.error || "Relay could not update this post.");
      setPosts((current) => current.map((item) => item.id === payload.data!.id ? payload.data! : item));
      setToastTone("success"); setToast(payload.data.status === "scheduled" ? "Post updated and rescheduled." : payload.data.status === "draft" ? "Draft updated." : "Changes saved and publishing started."); setTimeout(() => setToast(""), 4000); return true;
    } catch (reason) { setToastTone("error"); setToast(reason instanceof Error ? reason.message : "Relay could not update this post."); setTimeout(() => setToast(""), 4500); return false; }
  };
  const retryPost = async (post: RelayPost) => {
    const retryTargetIds = post.targets.filter((target) => target.status === "failed").map((target) => target.id); if (retryTargetIds.length === 0) return;
    try { const response = await fetch("/api/v1/posts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: post.id, retryTargetIds }) }); const payload = await response.json() as { data?: RelayPost; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error || "Could not retry this post."); setPosts((current) => current.map((item) => item.id === post.id ? payload.data! : item)); setToastTone("success"); setToast(`Retrying ${retryTargetIds.length} failed destination${retryTargetIds.length === 1 ? "" : "s"}.`); }
    catch (reason) { setToastTone("error"); setToast(reason instanceof Error ? reason.message : "Could not retry this post."); } finally { setTimeout(() => setToast(""), 4500); }
  };
  const reschedulePost = async (post: RelayPost, scheduledAt: string): Promise<boolean> => {
    try { const response = await fetch("/api/v1/posts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ id: post.id, scheduledAt }) }); const payload = await response.json() as { data?: RelayPost; error?: string }; if (!response.ok || !payload.data) throw new Error(payload.error || "Could not reschedule the post."); setPosts((current) => current.map((item) => item.id === post.id ? payload.data! : item)); return true; } catch (reason) { setToastTone("error"); setToast(reason instanceof Error ? reason.message : "Could not reschedule the post."); setTimeout(() => setToast(""), 4500); return false; }
  };
  const bulkReschedule = async (updates: Array<{ post: RelayPost; scheduledAt: string }>): Promise<boolean> => {
    try { const response = await fetch("/api/v1/posts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ updates: updates.map((item) => ({ id: item.post.id, scheduledAt: item.scheduledAt })) }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error || "Could not reschedule the selected posts."); const byId = new Map(updates.map((item) => [item.post.id, item.scheduledAt])); setPosts((current) => current.map((post) => byId.has(post.id) ? { ...post, status: "scheduled", scheduledAt: byId.get(post.id), targets: post.targets.map((target) => ({ ...target, status: "scheduled" })) } : post)); return true; } catch (reason) { setToastTone("error"); setToast(reason instanceof Error ? reason.message : "Could not reschedule the selected posts."); setTimeout(() => setToast(""), 4500); return false; }
  };
  const bulkDelete = async (items: RelayPost[]) => {
    if (!items.length || !window.confirm(`Remove ${items.length} selected post${items.length === 1 ? "" : "s"}? Publishing posts will be protected.`)) return;
    try { const response = await fetch("/api/v1/posts", { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: items.map((post) => post.id) }) }); const payload = await response.json() as { error?: string }; if (!response.ok) throw new Error(payload.error || "Could not remove the selected posts."); const ids = new Set(items.map((post) => post.id)); setPosts((current) => current.filter((post) => !ids.has(post.id))); } catch (reason) { setToastTone("error"); setToast(reason instanceof Error ? reason.message : "Could not remove the selected posts."); setTimeout(() => setToast(""), 4500); }
  };
  const bulkDuplicate = async (items: RelayPost[]) => {
    for (const post of items) await addPost({ ...post, id: "", status: "draft", scheduledAt: undefined, publishedAt: undefined, createdAt: undefined, targets: post.targets.map((target, index) => ({ ...target, id: `copy-${index}`, status: "draft", externalUrl: undefined, error: undefined, analytics: undefined })) });
  };
  const bulkRetry = async (items: RelayPost[]) => { for (const post of items) await retryPost(post); };
  const assignCampaign = async (items: RelayPost[], campaign: Campaign | null): Promise<boolean> => {
    if (!items.length) return false;
    try {
      const response = await fetch("/api/v1/posts", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ids: items.map((post) => post.id), campaignId: campaign?.id ?? "" }) });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || "Could not assign the selected posts.");
      const ids = new Set(items.map((post) => post.id));
      setPosts((current) => current.map((post) => ids.has(post.id) ? { ...post, campaignId: campaign?.id, campaignName: campaign?.name } : post));
      setToastTone("success"); setToast(campaign ? `Assigned ${items.length} post${items.length === 1 ? "" : "s"} to ${campaign.name}.` : `Removed ${items.length} post${items.length === 1 ? "" : "s"} from its campaign.`); setTimeout(() => setToast(""), 4000);
      return true;
    } catch (reason) { setToastTone("error"); setToast(reason instanceof Error ? reason.message : "Could not assign the selected posts."); setTimeout(() => setToast(""), 4500); return false; }
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
    if (!demoMode) await fetch("/api/v1/notifications", { method: "PATCH", headers: { "Content-Type": "application/json" }, body: "{}" });
  };
  const requestPostDelete = (post: RelayPost) => { setPostDeleteError(""); setPendingPostDelete(post); };
  const content = useMemo(() => { if (view === "home") return <HomeView posts={posts} onCompose={() => openComposer()} go={navigate} userName={user.name} initialNow={initialNow} />; if (view === "calendar") return <PlanningCalendar posts={posts} brands={brandList} accounts={accountList} onCompose={(date) => openComposer(null, null, "create", date ?? null)} onOpen={(post) => openComposer(null, post, post.status === "draft" || post.status === "scheduled" ? "edit" : "duplicate")} onDelete={requestPostDelete} onDuplicate={bulkDuplicate} onRetry={bulkRetry} onDeleteMany={bulkDelete} onAssignCampaign={assignCampaign} onReschedule={reschedulePost} onBulkReschedule={bulkReschedule} demoMode={demoMode} initialCampaigns={demoMode ? demoCampaigns : []} />; if (view === "posts") return <PostsView posts={posts} onPostAgain={(post) => openComposer(null, post)} onEdit={(post) => openComposer(null, post, "edit")} onRetry={(post) => void retryPost(post)} onDelete={requestPostDelete} />; if (view === "analytics") return <AnalyticsDashboard posts={posts} brands={brandList} accounts={accountList} onCompose={() => openComposer()} demoMode={demoMode} initialCampaigns={demoMode ? demoCampaigns : []} initialReports={demoMode ? demoReports : []} />; if (view === "slideshows") return <SlideshowStudio onCompose={openCreativeComposer} demoMode={demoMode} initialProjects={demoMode ? demoSlideshowProjects : []} />; if (view === "videos") return <VideoStudio accounts={accountList} onCompose={openCreativeComposer} demoMode={demoMode} initialProjects={demoMode ? demoVideoProjects : []} />; if (view === "accounts") return <AccountsView onAccountDeleted={(id) => setAccountList((current) => current.filter((item) => item.id !== id))} />; if (view === "media") return <MediaView onCompose={(media) => openComposer(media)} demoMode={demoMode} initialItems={demoMode ? demoMedia : []} initialMusicItems={demoMode ? demoMusic : []} initialProjects={demoMode ? demoMediaProjects : []} />; if (view === "brands") return <BrandsView onBrandCreated={(brand) => setBrandList((current) => [...current, brand])} onBrandUpdated={(brand) => setBrandList((current) => current.map((item) => item.id === brand.id ? brand : item))} onBrandDeleted={(id) => setBrandList((current) => current.filter((item) => item.id !== id))} onAccountsAssigned={(assignments) => setAccountList((current) => current.map((account) => { const assignment = assignments.find((item) => item.id === account.id); return assignment ? { ...account, brandId: assignment.brandId } : account; }))} />; if (view === "docs") return <CliDocs onOpenApiKeys={openApiKeySettings} />; return <SettingsView theme={theme} setTheme={setTheme} go={navigate} user={user} publishingDefaults={publishingDefaults} onPublishingDefaultsChanged={setPublishingDefaults} initialSection={settingsLanding} />; }, [view, posts, theme, user, initialNow, accountList, brandList, publishingDefaults, settingsLanding, navigate, openApiKeySettings, demoMode]);
  const logout = async () => {
    setLogoutBusy(true); setLogoutError("");
    try {
      const response = await fetch("/api/auth/sign-out", { method: "POST", credentials: "same-origin", cache: "no-store" });
      if (!response.ok) throw new Error("Relay could not end your session. Please try again.");
      window.location.replace("/login");
    } catch (reason) { setLogoutError(reason instanceof Error ? reason.message : "Relay could not end your session."); setLogoutBusy(false); }
  };
  const unreadNotifications = notifications.filter((item) => !item.readAt).length;
  return <BrandsContext.Provider value={brandList}><AccountsContext.Provider value={accountList}><div className="app-shell"><Sidebar active={view} onChange={navigate} mobileOpen={menu} onClose={() => setMenu(false)} user={user} onLogout={() => { setLogoutError(""); setLogoutConfirm(true); }} /><main className="main"><Topbar view={view} unread={unreadNotifications} onNotifications={() => setNotificationsOpen(true)} onCompose={() => openComposer()} onCommand={() => setCommand(true)} onMenu={() => setMenu(true)} />{content}</main><nav className="mobile-nav">{navItems.slice(0, 3).map(({ id, icon: Icon }) => <button className={view === id ? "active" : ""} onClick={() => navigate(id)} key={id}><Icon /><span>{viewLabel[id]}</span></button>)}<button className="mobile-create" onClick={() => openComposer()}><Plus /></button><button className={view === "accounts" ? "active" : ""} onClick={() => navigate("accounts")}><Users /><span>Accounts</span></button><button onClick={() => setMenu(true)}><Menu /><span>More</span></button></nav>{composer && <Composer demoMode={demoMode} initialCampaigns={demoMode ? demoCampaigns : []} initialTemplates={demoMode ? demoTemplates : []} publishingDefaults={publishingDefaults} initialMedia={composerMedia} initialPost={composerPost} initialText={composerSeed?.text} initialBrandId={composerSeed?.brandId} initialScheduledAt={composerScheduledAt} mode={composerMode} onClose={closeComposer} onSave={savePost} />}{command && <CommandMenu posts={posts} brands={brandList} accounts={accountList} onClose={() => setCommand(false)} go={navigate} compose={() => openComposer()} openPost={(post) => openComposer(null, post, post.status === "draft" || post.status === "scheduled" ? "edit" : "duplicate")} composeMedia={(media) => openComposer(media)} />}{notificationsOpen && <NotificationCenter notifications={notifications} loading={notificationsLoading} onClose={() => setNotificationsOpen(false)} onMarkAllRead={() => void markAllNotificationsRead()} />}{logoutConfirm && <LogoutModal busy={logoutBusy} error={logoutError} onClose={() => setLogoutConfirm(false)} onConfirm={() => void logout()} />}{pendingPostDelete && <ConfirmModal eyebrow={pendingPostDelete.status === "scheduled" ? "Cancel schedule" : "Delete post"} title={pendingPostDelete.status === "scheduled" ? "Cancel this scheduled post?" : "Delete this post from Relay?"} body={pendingPostDelete.status === "scheduled" ? "It will be removed from the calendar and will not be published." : "Its media stays in your library, but the saved post and destination details will be removed."} confirmLabel={pendingPostDelete.status === "scheduled" ? "Cancel schedule" : "Delete post"} busy={postDeleteBusy} error={postDeleteError} onClose={() => setPendingPostDelete(null)} onConfirm={() => void deletePost()} />}{toast && <div className={`toast ${toastTone}`}><span>{toastTone === "error" ? <CircleAlert /> : <Check />}</span>{toast}</div>}</div></AccountsContext.Provider></BrandsContext.Provider>;
}
