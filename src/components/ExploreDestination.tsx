"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams, useRouter } from "next/navigation";
import { getIntent, type IntentKey } from "@/lib/intents";
import { loadExploreNavigation, type ExploreNavigationContext } from "@/lib/explore-navigation";
import type { ExploreResponse, RankedExplorePoi } from "@/lib/explore-types";
import styles from "./ExploreDestination.module.css";

function humanize(value: string) {
  return value.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function PoiCard({ poi, preferences, featured = false }: {
  poi: RankedExplorePoi;
  preferences: ExploreNavigationContext["preferences"];
  featured?: boolean;
}) {
  const strongestIntent = poi.ranking.matched_intents
    .filter((key) => preferences[key])
    .sort((a, b) => (preferences[b]?.importance ?? 0) - (preferences[a]?.importance ?? 0))[0];
  const intent = strongestIntent ? getIntent(strongestIntent) : undefined;

  return (
    <article className={`${styles.poiCard} ${featured ? styles.featuredCard : ""}`}>
      <div className={styles.poiVisual} aria-hidden="true">
        <span>{intent?.emoji ?? "✦"}</span>
        {featured && <small>Top pick</small>}
      </div>
      <div className={styles.poiBody}>
        <span className={styles.category}>{humanize(poi.category)}</span>
        <h3>{poi.poi_name}</h3>
        {intent && <p>Great for your interest in {intent.label.toLowerCase()}.</p>}
        {(poi.locality || poi.country_code) && (
          <div className={styles.location}>⌖ {[poi.locality, poi.country_code].filter(Boolean).join(", ")}</div>
        )}
      </div>
    </article>
  );
}

export default function ExploreDestination() {
  const params = useParams<{ destinationId: string }>();
  const router = useRouter();
  const destinationId = decodeURIComponent(params.destinationId);
  const [context, setContext] = useState<ExploreNavigationContext | null>(null);
  const [response, setResponse] = useState<ExploreResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (navigation: ExploreNavigationContext) => {
    setLoading(true);
    setError(null);
    try {
      const apiResponse = await fetch("/api/explore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          traveller_destination_id: destinationId,
          preferences: navigation.preferences,
          limit: 20,
        }),
      });
      const payload = await apiResponse.json();
      if (!apiResponse.ok) throw new Error(payload.error ?? "Explore is unavailable right now.");
      setResponse(payload as ExploreResponse);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Explore is unavailable right now.");
    } finally {
      setLoading(false);
    }
  }, [destinationId]);

  useEffect(() => {
    const navigation = loadExploreNavigation(destinationId);
    setContext(navigation);
    if (navigation) void load(navigation);
    else setLoading(false);
  }, [destinationId, load]);

  const strongestPreferences = useMemo(() => {
    if (!context) return [];
    return (Object.entries(context.preferences) as [IntentKey, NonNullable<ExploreNavigationContext["preferences"][IntentKey]>][])
      .sort(([, a], [, b]) => b.importance - a.importance || b.target - a.target)
      .slice(0, 3);
  }, [context]);

  const interestSections = useMemo(() => {
    if (!context || !response) return [];
    return (Object.entries(response.by_interest) as [IntentKey, RankedExplorePoi[]][])
      .filter(([key, pois]) => Boolean(context.preferences[key]) && pois.length > 0)
      .sort(([a], [b]) => (context.preferences[b]?.importance ?? 0) - (context.preferences[a]?.importance ?? 0));
  }, [context, response]);

  const goBack = () => {
    if (window.history.length > 1) router.back();
    else router.push("/discover");
  };

  if (!context) {
    return (
      <main className={styles.page}>
        <div className={styles.standaloneState}>
          <span className={styles.eyebrow}>TravelGinni · Explore</span>
          <h1>Start with your destination matches</h1>
          <p>Choose Explore from a discovery result so we can bring your travel preferences with you.</p>
          <button onClick={() => router.push("/discover")}>Find a destination</button>
        </div>
      </main>
    );
  }

  const { destination, preferences } = context;

  return (
    <main className={styles.page}>
      <button type="button" className={styles.backButton} onClick={goBack}>← Back to your matches</button>

      <header className={`${styles.destinationHeader} ${destination.image ? styles.withImage : ""}`}>
        {destination.image && (
          <img src={destination.image.image_url} alt={destination.image.alt} className={styles.heroImage} />
        )}
        <div className={styles.heroShade} />
        <div className={styles.heroContent}>
          <span className={styles.eyebrow}>Your TravelGinni guide</span>
          <h1>Explore {destination.display_name}</h1>
          <p>{[humanize(destination.destination_type), destination.country_code].filter(Boolean).join(" · ")}</p>
        </div>
        {destination.image && (
          <a className={styles.photoCredit} href={destination.image.photo_url} target="_blank" rel="noreferrer">
            Photo by {destination.image.photographer} · Pexels
          </a>
        )}
      </header>

      <section className={styles.fitPanel}>
        <div>
          <span className={styles.sectionKicker}>Personalised for you</span>
          <h2>Why this destination fits you</h2>
        </div>
        <div className={styles.preferenceChips}>
          {strongestPreferences.map(([key, preference]) => {
            const intent = getIntent(key);
            return <div className={styles.preferenceChip} key={key}>
              <span>{intent?.emoji}</span>
              <div><strong>{intent?.label ?? humanize(key)}</strong><small>{preference.importance >= 0.7 ? "A priority for your trip" : "Part of your ideal trip"}</small></div>
            </div>;
          })}
        </div>
      </section>

      {loading && (
        <section className={styles.loadingState} aria-live="polite">
          <div className={styles.spinner} />
          <h2>Finding places that fit your trip…</h2>
          <p>We’re matching real places with the interests you selected.</p>
        </section>
      )}

      {!loading && error && (
        <section className={styles.errorState} role="alert">
          <span>We couldn’t load your places</span>
          <h2>Explore needs another moment.</h2>
          <p>{error}</p>
          <button type="button" onClick={() => void load(context)}>Try again</button>
        </section>
      )}

      {!loading && !error && response && response.top_picks.length === 0 && (
        <section className={styles.emptyState}>
          <h2>No personalised places yet</h2>
          <p>We don’t have Explore places for this destination yet. Your destination match is still saved.</p>
        </section>
      )}

      {!loading && !error && response && response.top_picks.length > 0 && (
        <div className={styles.content}>
          <section className={styles.section}>
            <div className={styles.sectionHeading}>
              <div><span className={styles.sectionKicker}>Start here</span><h2>Top picks for you</h2></div>
              <p>Places selected around what matters most to your trip.</p>
            </div>
            <div className={styles.topGrid}>
              {response.top_picks.map((poi, index) => <PoiCard key={poi.poi_id} poi={poi} preferences={preferences} featured={index < 3} />)}
            </div>
          </section>

          {interestSections.length > 0 && (
            <section className={styles.section}>
              <div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>Follow your mood</span><h2>Explore by your interests</h2></div></div>
              <div className={styles.interestList}>
                {interestSections.map(([key, pois]) => {
                  const intent = getIntent(key);
                  return <div className={styles.interestSection} key={key}>
                    <div className={styles.interestHeading}><span>{intent?.emoji}</span><div><h3>{intent?.label ?? humanize(key)}</h3><p>{intent?.prompt}</p></div></div>
                    <div className={styles.horizontalCards}>{pois.map((poi) => <PoiCard key={poi.poi_id} poi={poi} preferences={preferences} />)}</div>
                  </div>;
                })}
              </div>
            </section>
          )}

          {response.dont_miss.length > 0 && (
            <section className={`${styles.section} ${styles.dontMissSection}`}>
              <div className={styles.sectionHeading}><div><span className={styles.sectionKicker}>Destination essentials</span><h2>Don&apos;t miss</h2></div><p>Standout places worth keeping on your shortlist.</p></div>
              <div className={styles.dontMissGrid}>{response.dont_miss.map((poi) => <PoiCard key={poi.poi_id} poi={poi} preferences={preferences} />)}</div>
            </section>
          )}
        </div>
      )}
    </main>
  );
}
