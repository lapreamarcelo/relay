"use client";

import { GrowthCat, type GrowthCatSponsorData, type SponsorCreative } from "@growthcat/web";
import { useSponsor } from "@growthcat/web/react";
import { ArrowUpRight, CalendarDays, Crown, Medal, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";

import { useModalAccessibility } from "../lib/use-modal-accessibility";

// GrowthCat SDK keys are public client identifiers. Set Relay's gc_live_ key here
// to make sponsorships work in every clone; the environment variable lets forks override it.
const bundledPublicSDKKey = "gc_live_4fb9febcab4461a78a2ad15aedec1e12347a0fc50c6e4353";
const publicSDKKey = process.env.NEXT_PUBLIC_GROWTHCAT_API_KEY?.trim() || bundledPublicSDKKey;

if (typeof window !== "undefined" && publicSDKKey && !GrowthCat.isConfigured) {
  GrowthCat.initialize({
    apiKey: publicSDKKey,
    workspace: "live",
    logsEnabled: process.env.NODE_ENV !== "production",
    measurementMode: "essential",
  });
}

type SponsorTier = "gold" | "featured-gold" | "supporter";

function SponsorSlot({ slotKey, tier }: { slotKey: string; tier: SponsorTier }) {
  const isGold = tier === "gold" || tier === "featured-gold";
  const sessionId = useMemo(() => GrowthCat.makeSessionId(), []);
  const { sponsor, state, trackImpression, trackClick } = useSponsor({ slotKey, sessionId });
  const cardRef = useRef<HTMLAnchorElement>(null);
  const multiCardRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const isSimultaneousSilver = tier === "supporter" && sponsor?.deliveryMode === "all" && Boolean(sponsor.creatives?.length);
    const impressionTarget = isSimultaneousSilver ? multiCardRef.current : cardRef.current;
    if (sponsor?.status !== "live" || !impressionTarget) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      clearTimeout(timer);
      if (entry.intersectionRatio < 0.5 || document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") void trackImpression(entry.intersectionRatio, 1_000);
      }, 1_000);
    }, { threshold: 0.5 });

    observer.observe(impressionTarget);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [sponsor, tier, trackImpression]);

  if (state === "loading") return null;
  if (!sponsor) return null;

  if (sponsor.status === "available" || sponsor.status === "empty") {
    if (!sponsor.bookingUrl) return null;
    return <a className={`sponsor-card sponsor-${tier} sponsor-available`} href={sponsor.bookingUrl} target="_blank" rel="noopener noreferrer">
      <span className="sponsor-art">{isGold ? <Crown /> : <Sparkles />}</span>
      <span className="sponsor-copy">
        <small>{isGold ? "Gold partner · Available" : "Silver partner · Available"}</small>
        <b>{isGold ? "Become Relay’s flagship partner" : "Support open-source publishing"}</b>
        <em>{sponsor.priceUsd != null ? `From $${sponsor.priceUsd} · View calendar` : "View dates and reserve"}</em>
      </span>
      <CalendarDays className="sponsor-action" />
    </a>;
  }

  const simultaneousCreatives = tier === "supporter" && sponsor.deliveryMode === "all" ? sponsor.creatives?.slice(0, 2) ?? [] : [];
  if (simultaneousCreatives.length > 0) {
    const vacancies = Math.max(0, Math.min(2, sponsor.capacityPerPeriod ?? 2) - simultaneousCreatives.length);
    return <div ref={multiCardRef} className="silver-sponsor-grid" aria-label="Silver partners">
      {simultaneousCreatives.map((creative) => <SponsorCreativeCard creative={creative} onClick={() => { void trackClick(creative); }} key={creative.bookingId ?? creative.sponsorName ?? creative.headline} />)}
      {vacancies > 0 && sponsor.bookingUrl && <a className="sponsor-card sponsor-supporter sponsor-available sponsor-vacancy" href={sponsor.bookingUrl} target="_blank" rel="noopener noreferrer">
        <span className="sponsor-art"><Sparkles /></span>
        <span className="sponsor-copy"><small>Silver partner · Available</small><b>Reserve the second Silver spot</b><em>View dates and reserve</em></span>
        <CalendarDays className="sponsor-action" />
      </a>}
    </div>;
  }

  const creative = sponsor.creative;
  if (!creative) return null;

  return <a
    ref={cardRef}
    className={`sponsor-card sponsor-${tier} sponsor-live`}
    href={creative.clickUrl}
    target={creative.clickUrl ? "_blank" : undefined}
    rel={creative.clickUrl ? "noopener noreferrer" : undefined}
    aria-label={creative.headline ?? creative.sponsorName ?? "Sponsored partner"}
    onClick={() => { void trackClick(); }}
  >
    {creative.logoUrl ? <img src={creative.logoUrl} alt="" /> : <span className="sponsor-art">{isGold ? <Crown /> : <Sparkles />}</span>}
    <span className="sponsor-copy">
      <small>{isGold ? "Gold partner · Sponsored" : "Silver partner · Sponsored"}</small>
      <b>{creative.headline ?? creative.sponsorName ?? "Relay partner"}</b>
      {(creative.body || creative.ctaText) && <em>{creative.body ?? creative.ctaText}</em>}
    </span>
    <ArrowUpRight className="sponsor-action" />
  </a>;
}

function SponsorCreativeCard({ creative, onClick }: { creative: SponsorCreative; onClick: () => void }) {
  return <a
    className="sponsor-card sponsor-supporter sponsor-live"
    href={creative.clickUrl}
    target={creative.clickUrl ? "_blank" : undefined}
    rel={creative.clickUrl ? "noopener noreferrer" : undefined}
    aria-label={creative.headline ?? creative.sponsorName ?? "Silver partner"}
    onClick={onClick}
  >
    {creative.logoUrl ? <img src={creative.logoUrl} alt="" /> : <span className="sponsor-art"><Sparkles /></span>}
    <span className="sponsor-copy">
      <small>Silver partner · Sponsored</small>
      <b>{creative.headline ?? creative.sponsorName ?? "Relay partner"}</b>
      {(creative.body || creative.ctaText) && <em>{creative.body ?? creative.ctaText}</em>}
    </span>
    <ArrowUpRight className="sponsor-action" />
  </a>;
}

export function GoldSponsor() {
  if (!publicSDKKey) return null;
  return <SponsorSlot slotKey="gold_sponsor" tier="gold" />;
}

export function FeaturedGoldSponsor() {
  if (!publicSDKKey) return null;
  return <section className="gold-sponsor-section" aria-labelledby="gold-sponsor-title">
    <div className="section-heading">
      <div><p className="eyebrow">Flagship supporter</p><h3 id="gold-sponsor-title">Gold partner</h3></div>
      <span>Relay’s most prominent partner, visible throughout the workspace.</span>
    </div>
    <SponsorSlot slotKey="gold_sponsor" tier="featured-gold" />
  </section>;
}

export function CommunitySponsors() {
  if (!publicSDKKey) return null;
  return <section className="community-sponsors" aria-labelledby="community-sponsors-title">
    <div className="section-heading">
      <div><p className="eyebrow">Built with support</p><h3 id="community-sponsors-title">Silver partners</h3></div>
      <span>Two focused placements for products supporting independent publishing.</span>
    </div>
    <div className="community-sponsor-row">
      <SponsorSlot slotKey="silver_sponsor" tier="supporter" />
    </div>
  </section>;
}

function SponsorMarketOption({ sponsor, tier }: { sponsor: GrowthCatSponsorData | null; tier: "gold" | "silver" }) {
  if (!sponsor?.bookingUrl) return null;

  const period = sponsor.period === "weekly" ? "week" : sponsor.period === "monthly" ? "month" : sponsor.period || "period";
  const price = sponsor.priceUsd != null ? `$${sponsor.priceUsd} / ${period}` : "See live pricing";
  const hasCurrentCapacity = tier === "silver" && sponsor.status === "live" && (sponsor.creatives?.length ?? 1) < (sponsor.capacityPerPeriod ?? 2);
  const status = sponsor.status === "available" || hasCurrentCapacity ? "Booking now" : sponsor.status === "live" ? "Future dates open" : "View openings";
  const Icon = tier === "gold" ? Crown : Medal;

  return <a className={`sponsor-market-option ${tier}`} href={sponsor.bookingUrl} target="_blank" rel="noopener noreferrer">
    <span className="sponsor-market-icon"><Icon /></span>
    <span className="sponsor-market-copy">
      <small>{tier === "gold" ? "Flagship placement" : "Home-page placement"}</small>
      <b>{tier === "gold" ? "Gold Partner" : "Silver Partner"}</b>
      <em>{tier === "gold" ? "Visible throughout Relay on desktop and in the mobile menu." : "Two calm, simultaneous placements after the publishing queue."}</em>
    </span>
    <span className="sponsor-market-price"><small>{status}</small><b>{price}</b><em>Open calendar <ArrowUpRight /></em></span>
  </a>;
}

export function SponsorMarketplace() {
  const [open, setOpen] = useState(false);
  const sessionId = useMemo(() => GrowthCat.makeSessionId(), []);
  const gold = useSponsor({ slotKey: "gold_sponsor", sessionId });
  const silver = useSponsor({ slotKey: "silver_sponsor", sessionId });
  const loading = gold.state === "idle" || gold.state === "loading" || silver.state === "idle" || silver.state === "loading";
  useModalAccessibility();
  if (!publicSDKKey) return null;

  return <>
    <button className="sponsor-trigger" onClick={() => setOpen(true)} aria-haspopup="dialog" aria-label="Sponsor Relay"><Crown /><span>Sponsor Relay</span></button>
    {open && typeof document !== "undefined" && createPortal(<div className="modal-layer sponsor-market-layer">
      <button className="modal-scrim" onClick={() => setOpen(false)} aria-label="Close sponsorship options" />
      <section className="sponsor-market" role="dialog" aria-modal="true" aria-labelledby="sponsor-market-title" tabIndex={-1}>
        <header>
          <div><p className="eyebrow">Fund open-source publishing</p><h2 id="sponsor-market-title">Put your product in good company.</h2><p>Choose a placement, then reserve an available week or month directly through GrowthCat.</p></div>
          <button className="icon-button" onClick={() => setOpen(false)} aria-label="Close"><X /></button>
        </header>
        <div className="sponsor-market-options">
          {loading ? <p className="sponsor-market-loading" role="status">Loading live availability…</p> : <>
            <SponsorMarketOption sponsor={gold.sponsor} tier="gold" />
            <SponsorMarketOption sponsor={silver.sponsor} tier="silver" />
          </>}
        </div>
        <footer><span><Sparkles /> Prices and availability come live from GrowthCat.</span><small>Bookings open in a secure new tab.</small></footer>
      </section>
    </div>, document.body)}
  </>;
}
