"use client";

import { GrowthCat } from "@growthcat/web";
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

type SponsorTier = "gold" | "supporter";

function SponsorSlot({ slotKey, tier }: { slotKey: string; tier: SponsorTier }) {
  const sessionId = useMemo(() => GrowthCat.makeSessionId(), []);
  const { sponsor, state, trackImpression, trackClick } = useSponsor({ slotKey, sessionId });
  const cardRef = useRef<HTMLAnchorElement>(null);

  useEffect(() => {
    if (sponsor?.status !== "live" || !cardRef.current) return;

    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new IntersectionObserver(([entry]) => {
      clearTimeout(timer);
      if (entry.intersectionRatio < 0.5 || document.visibilityState !== "visible") return;
      timer = setTimeout(() => {
        if (document.visibilityState === "visible") void trackImpression(entry.intersectionRatio, 1_000);
      }, 1_000);
    }, { threshold: 0.5 });

    observer.observe(cardRef.current);
    return () => {
      clearTimeout(timer);
      observer.disconnect();
    };
  }, [sponsor, trackImpression]);

  if (state === "loading") return <div className={`sponsor-card sponsor-${tier} sponsor-loading`} aria-hidden="true" />;
  if (!sponsor || sponsor.status === "empty") return null;

  if (sponsor.status === "available") {
    if (!sponsor.bookingUrl) return null;
    return <a className={`sponsor-card sponsor-${tier} sponsor-available`} href={sponsor.bookingUrl} target="_blank" rel="noopener noreferrer">
      <span className="sponsor-art">{tier === "gold" ? <Crown /> : <Sparkles />}</span>
      <span className="sponsor-copy">
        <small>{tier === "gold" ? "Gold partner · Available" : "Partner slot · Available"}</small>
        <b>{tier === "gold" ? "Put your brand beside Relay" : "Support open-source publishing"}</b>
        <em>{sponsor.priceUsd != null ? `From $${sponsor.priceUsd} · View calendar` : "View dates and reserve"}</em>
      </span>
      <CalendarDays className="sponsor-action" />
    </a>;
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
    {creative.logoUrl ? <img src={creative.logoUrl} alt="" /> : <span className="sponsor-art">{tier === "gold" ? <Crown /> : <Sparkles />}</span>}
    <span className="sponsor-copy">
      <small>{tier === "gold" ? "Gold partner · Sponsored" : "Community partner · Sponsored"}</small>
      <b>{creative.headline ?? creative.sponsorName ?? "Relay partner"}</b>
      {(creative.body || creative.ctaText) && <em>{creative.body ?? creative.ctaText}</em>}
    </span>
    <ArrowUpRight className="sponsor-action" />
  </a>;
}

export function GoldSponsor() {
  if (!publicSDKKey) return null;
  return <SponsorSlot slotKey="relay_gold" tier="gold" />;
}

export function CommunitySponsors() {
  if (!publicSDKKey) return null;
  return <section className="community-sponsors" aria-labelledby="community-sponsors-title">
    <div className="section-heading">
      <div><p className="eyebrow">Built with support</p><h3 id="community-sponsors-title">Silver partner</h3></div>
      <span>One thoughtful tool supporting independent publishing.</span>
    </div>
    <div className="community-sponsor-row">
      <SponsorSlot slotKey="relay_silver" tier="supporter" />
    </div>
  </section>;
}

function SponsorMarketOption({ slotKey, tier }: { slotKey: string; tier: "gold" | "silver" }) {
  const sessionId = useMemo(() => GrowthCat.makeSessionId(), []);
  const { sponsor, state } = useSponsor({ slotKey, sessionId });

  if (state === "loading") return <div className={`sponsor-market-option ${tier} loading`} aria-hidden="true" />;
  if (!sponsor?.bookingUrl) return null;

  const period = sponsor.period === "weekly" ? "week" : sponsor.period === "monthly" ? "month" : sponsor.period;
  const price = sponsor.priceUsd != null ? `$${sponsor.priceUsd} / ${period}` : `View ${period}ly pricing`;
  const status = sponsor.status === "live" ? "Future dates open" : sponsor.status === "available" ? "Booking now" : "View openings";
  const Icon = tier === "gold" ? Crown : Medal;

  return <a className={`sponsor-market-option ${tier}`} href={sponsor.bookingUrl} target="_blank" rel="noopener noreferrer">
    <span className="sponsor-market-icon"><Icon /></span>
    <span className="sponsor-market-copy">
      <small>{tier === "gold" ? "Flagship placement" : "Home-page placement"}</small>
      <b>{tier === "gold" ? "Gold Partner" : "Silver Partner"}</b>
      <em>{tier === "gold" ? "Visible throughout Relay on desktop and in the mobile menu." : "A calm, dedicated placement after the publishing queue."}</em>
    </span>
    <span className="sponsor-market-price"><small>{status}</small><b>{price}</b><em>Open calendar <ArrowUpRight /></em></span>
  </a>;
}

export function SponsorMarketplace() {
  const [open, setOpen] = useState(false);
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
          <SponsorMarketOption slotKey="relay_gold" tier="gold" />
          <SponsorMarketOption slotKey="relay_silver" tier="silver" />
        </div>
        <footer><span><Sparkles /> Prices and availability come live from GrowthCat.</span><small>Bookings open in a secure new tab.</small></footer>
      </section>
    </div>, document.body)}
  </>;
}
