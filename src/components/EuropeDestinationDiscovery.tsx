'use client';

import { useMemo, useState } from 'react';
import { findDestinations } from '@/lib/destination-finder';
import type { CostLevel, TravelInterest } from '@/lib/travel-types';
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

export function EuropeDestinationDiscovery() {
  const [query, setQuery] = useState('');
  const [month, setMonth] = useState<number | undefined>();
  const [tripDays, setTripDays] = useState(5);
  const [maxCostLevel, setMaxCostLevel] = useState<CostLevel>(3);
  const [interests, setInterests] = useState<TravelInterest[]>(['nature', 'food']);

  const allMatches = useMemo(
    () => findDestinations({ query, month, tripDays, maxCostLevel, interests }),
    [query, month, tripDays, maxCostLevel, interests],
  );

  const results = allMatches.slice(0, 9);

  function toggleInterest(interest: TravelInterest) {
    setInterests((current) =>
      current.includes(interest)
        ? current.filter((item) => item !== interest)
        : [...current, interest],
    );
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
            <h2>{results.length ? 'Best matches for this trip' : 'No matches yet'}</h2>
          </div>
          <p>{allMatches.length} destinations match your current filters</p>
        </div>

        {results.length ? (
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
        <span>Destination discovery engine · No LLM · No booking</span>
      </footer>
    </main>
  );
}
