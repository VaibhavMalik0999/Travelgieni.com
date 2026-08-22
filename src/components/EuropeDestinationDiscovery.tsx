'use client';

import { useEffect, useMemo, useState } from 'react';
import { findDestinations } from '@/lib/destination-finder';
import { loadDestinations } from '@/lib/load-destinations';
import {
  formatMinutes,
  loadReachablePlaces,
  type ReachablePlace,
} from '@/lib/load-reachable-places';
import type { CostLevel, Destination, TravelInterest } from '@/lib/travel-types';
import styles from './EuropeDestinationDiscovery.module.css';

const INTERESTS: Array<{ value: TravelInterest; label: string }> = [
  { value: 'beach', label: 'Beach' },
  { value: 'nature', label: 'Nature' },
  { value: 'culture', label: 'Culture' },
  { value: 'food', label: 'Food' },
  { value: 'nightlife', label: 'Nightlife' },
  { value: 'romantic', label: 'Romantic' },
  { value: 'family', label: 'Family' },
  { value: 'hiking', label: 'Hiking' },
  { value: 'wellness', label: 'Wellness' },
  { value: 'winter', label: 'Winter' },
];

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

const FLIGHT_LIMITS = [
  { value: 60, label: 'Up to 1 hour' },
  { value: 120, label: 'Up to 2 hours' },
  { value: 180, label: 'Up to 3 hours' },
  { value: 240, label: 'Up to 4 hours' },
  { value: 300, label: 'Up to 5 hours' },
];

const ONWARD_LIMITS = [
  { value: 50, label: 'Within 50 km of airport' },
  { value: 100, label: 'Within 100 km of airport' },
  { value: 200, label: 'Within 200 km of airport' },
  { value: 300, label: 'Within 300 km of airport' },
];

export function EuropeDestinationDiscovery() {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [query, setQuery] = useState('');
  const [month, setMonth] = useState<number | undefined>();
  const [tripDays, setTripDays] = useState(5);
  const [maxCostLevel, setMaxCostLevel] = useState<CostLevel>(3);
  const [interests, setInterests] = useState<TravelInterest[]>(['nature', 'food']);

  const [originAirport] = useState('BER');
  const [maxFlightMinutes, setMaxFlightMinutes] = useState(180);
  const [maxOnwardDistanceKm, setMaxOnwardDistanceKm] = useState(200);
  const [reachablePlaces, setReachablePlaces] = useState<ReachablePlace[]>([]);
  const [reachabilityLoading, setReachabilityLoading] = useState(false);
  const [reachabilityError, setReachabilityError] = useState<string | null>(null);
  const [reachabilitySearched, setReachabilitySearched] = useState(false);

  useEffect(() => {
    let active = true;

    loadDestinations()
      .then((data) => {
        if (active) setDestinations(data);
      })
      .catch((error: unknown) => {
        console.error('TravelGieni destination load failed', error);
        if (active) setLoadError('Could not load destinations from the TravelGieni database.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, []);

  const allMatches = useMemo(
    () => findDestinations(destinations, { query, month, tripDays, maxCostLevel, interests }),
    [destinations, query, month, tripDays, maxCostLevel, interests],
  );

  const results = allMatches.slice(0, 9);
  const reachablePreview = reachablePlaces.slice(0, 12);

  function toggleInterest(interest: TravelInterest) {
    setInterests((current) =>
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : [...current, interest],
    );
  }

  async function discoverReachablePlaces() {
    setReachabilityLoading(true);
    setReachabilityError(null);
    setReachabilitySearched(true);

    try {
      const data = await loadReachablePlaces(
        originAirport,
        maxFlightMinutes,
        maxOnwardDistanceKm,
      );
      setReachablePlaces(data);
    } catch (error) {
      console.error('TravelGieni reachability search failed', error);
      setReachabilityError('Could not load reachable locations from the transport network.');
      setReachablePlaces([]);
    } finally {
      setReachabilityLoading(false);
    }
  }

  return (
    <main className={styles.shell}>
      <nav className={styles.nav}>
        <a className={styles.brand} href="#top" aria-label="TravelGieni home">
          <span className={styles.brandMark}>G</span>
          <span>TravelGieni</span>
        </a>
        <span className={styles.prototype}>Europe discovery · V1</span>
      </nav>

      <section id="top" className={styles.hero}>
        <p className={styles.eyebrow}>DON&apos;T SEARCH FOR A DESTINATION. DISCOVER ONE.</p>
        <h1>Where should you go next?</h1>
        <p className={styles.heroCopy}>
          Tell us what kind of trip you want. TravelGieni ranks European destinations that fit your preferences.
        </p>
      </section>

      <section className={styles.reachabilityCard} aria-label="Travel reachability">
        <div className={styles.reachabilityIntro}>
          <div>
            <p className={styles.sectionLabel}>REACHABILITY BETA</p>
            <h2>How far are you willing to travel?</h2>
          </div>
          <p>
            We first identify location possibilities. Onward airport distance stays visible instead of silently eliminating them.
          </p>
        </div>

        <div className={styles.reachabilityControls}>
          <label>
            <span>Starting from</span>
            <select value={originAirport} disabled>
              <option value="BER">Berlin · BER</option>
            </select>
            <small>Berlin is the first loaded test origin. The transport model itself supports any origin.</small>
          </label>

          <label>
            <span>Maximum flight time</span>
            <select
              value={maxFlightMinutes}
              onChange={(event) => setMaxFlightMinutes(Number(event.target.value))}
            >
              {FLIGHT_LIMITS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Show locations</span>
            <select
              value={maxOnwardDistanceKm}
              onChange={(event) => setMaxOnwardDistanceKm(Number(event.target.value))}
            >
              {ONWARD_LIMITS.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>

          <button
            type="button"
            className={styles.discoverButton}
            onClick={discoverReachablePlaces}
            disabled={reachabilityLoading}
          >
            {reachabilityLoading ? 'Finding locations…' : 'Find reachable locations'}
          </button>
        </div>

        {reachabilityError && (
          <div className={styles.reachabilityMessage}>{reachabilityError}</div>
        )}

        {!reachabilityError && reachabilitySearched && !reachabilityLoading && (
          <div className={styles.reachabilityResults}>
            <div className={styles.reachabilitySummary}>
              <strong>{reachablePlaces.length.toLocaleString()}</strong>
              <span>
                location candidates found with flights up to {formatMinutes(maxFlightMinutes)} and within {maxOnwardDistanceKm} km of an arrival airport
              </span>
            </div>

            {reachablePreview.length > 0 && (
              <div className={styles.reachableGrid}>
                {reachablePreview.map((place) => (
                  <article
                    className={styles.reachableCard}
                    key={`${place.sourcePlaceId}-${place.arrivalAirport}`}
                  >
                    <div>
                      <p className={styles.country}>{place.countryCode}</p>
                      <h3>{place.placeName}</h3>
                    </div>
                    <div className={styles.routeLine}>
                      <strong>{formatMinutes(place.flightMinutes)}</strong>
                      <span>flight to {place.arrivalAirport}</span>
                    </div>
                    <p>
                      {place.airportToPlaceDistanceKm.toFixed(0)} km from {place.airportName}
                    </p>
                  </article>
                ))}
              </div>
            )}

            {reachablePlaces.length > reachablePreview.length && (
              <p className={styles.previewNote}>
                Showing the first {reachablePreview.length} candidates. Ranking by travel preferences comes after we connect this reachability layer to enriched TravelGieni destinations.
              </p>
            )}
          </div>
        )}
      </section>

      <section className={styles.searchCard} aria-label="Destination preferences">
        <div className={styles.controls}>
          <label className={styles.fieldWide}>
            <span>Search</span>
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Try Portugal, island, beach…"
            />
          </label>

          <label>
            <span>When</span>
            <select
              value={month ?? ''}
              onChange={(event) => setMonth(event.target.value ? Number(event.target.value) : undefined)}
            >
              <option value="">Any month</option>
              {MONTHS.map((name, index) => (
                <option key={name} value={index + 1}>{name}</option>
              ))}
            </select>
          </label>

          <label>
            <span>Trip length</span>
            <select value={tripDays} onChange={(event) => setTripDays(Number(event.target.value))}>
              {[2, 3, 4, 5, 7, 10, 14].map((days) => (
                <option key={days} value={days}>{days} days</option>
              ))}
            </select>
          </label>

          <label>
            <span>Budget style</span>
            <select
              value={maxCostLevel}
              onChange={(event) => setMaxCostLevel(Number(event.target.value) as CostLevel)}
            >
              <option value={1}>€ Budget</option>
              <option value={2}>€€ Moderate</option>
              <option value={3}>€€€ Comfortable</option>
              <option value={4}>€€€€ Any</option>
            </select>
          </label>
        </div>

        <div className={styles.preferenceBlock}>
          <p>What matters to you?</p>
          <div className={styles.interests}>
            {INTERESTS.map(({ value, label }) => {
              const selected = interests.includes(value);
              return (
                <button
                  type="button"
                  key={value}
                  className={selected ? styles.interestActive : styles.interest}
                  onClick={() => toggleInterest(value)}
                  aria-pressed={selected}
                >
                  {label}
                </button>
              );
            })}
          </div>
        </div>
      </section>

      <section className={styles.resultSection}>
        <div className={styles.resultHeader}>
          <div>
            <p className={styles.sectionLabel}>YOUR SHORTLIST</p>
            <h2>
              {loading
                ? 'Loading TravelGieni destinations…'
                : results.length
                  ? 'Best matches for this trip'
                  : 'No matches yet'}
            </h2>
          </div>
          <p>{loading ? 'Connecting to destination database…' : `${allMatches.length} destinations match your current filters`}</p>
        </div>

        {loadError ? (
          <div className={styles.emptyState}>{loadError}</div>
        ) : loading ? (
          <div className={styles.emptyState}>Loading destinations from Supabase…</div>
        ) : results.length ? (
          <div className={styles.results}>
            {results.map((destination, index) => (
              <article className={styles.card} key={destination.id}>
                <div className={styles.cardTop}>
                  <div>
                    <p className={styles.country}>{destination.country}</p>
                    <h3>{destination.name}</h3>
                  </div>
                  <div className={styles.scoreWrap}>
                    <span className={styles.rank}>#{index + 1}</span>
                    <strong>{destination.score}%</strong>
                    <span>fit</span>
                  </div>
                </div>

                <div className={styles.meta}>
                  <span>{destination.type}</span>
                  <span>{'€'.repeat(destination.costLevel)}</span>
                  <span>{destination.typicalDays[0]}–{destination.typicalDays[1]} days</span>
                </div>

                <div className={styles.tags}>
                  {destination.interests.slice(0, 5).map((tag) => <span key={tag}>{tag}</span>)}
                </div>

                <div className={styles.reasonBox}>
                  <span>Why it fits</span>
                  <p>{destination.reasons.slice(0, 2).join(' · ') || 'Broad match for your current search.'}</p>
                </div>

                {destination.tradeoffs[0] && (
                  <p className={styles.tradeoff}><span>Trade-off:</span> {destination.tradeoffs[0]}</p>
                )}
              </article>
            ))}
          </div>
        ) : (
          <div className={styles.emptyState}>
            Try increasing the budget level, removing a search term, or selecting fewer preferences.
          </div>
        )}
      </section>

      <footer className={styles.footer}>
        <span>TravelGieni.com</span>
        <span>Destination discovery engine · Supabase connected · No LLM</span>
      </footer>
    </main>
  );
}
