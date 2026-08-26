"use client";

import { FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { getIntent, INTENTS, IntentKey } from "@/lib/intents";
import styles from "./DestinationDiscovery.module.css";
import OriginPicker, { type Origin } from "./OriginPicker";
import TripTimingPicker, { type TripTiming } from "./TripTimingPicker";

type PreferenceState = Partial<
  Record<
    IntentKey,
    {
      target: number;
      importance: number;
    }
  >
>;

type BreakdownItem = {
  target: number;
  importance: number;
  match_type: "minimum" | "target" | "maximum";
  tolerance: number;
  hard_min: number | null;
  hard_max: number | null;
  destination_score: number;
  intent_match: number;
  evidence_confidence: number;
  evidence_status: string;
};

type DestinationResult = {
  traveller_destination_id: string;
  display_name: string;
  destination_type: string;
  country_code: string | null;
  latitude: number | null;
  longitude: number | null;
  match_score: number;
  evidence_confidence_score: number;
  travel_role_confidence: string;
  destination_family_id: string | null;
  matched_intents: number;
  preference_breakdown: Record<string, BreakdownItem>;
};

type FlightSummary =
  | { status: "loading" }
  | {
      status: "ready";
      testMode: boolean;
      originIata: string;
      destinationIata: string;
      amount: string;
      currency: string;
      duration: string | null;
      stops: number;
      direct: boolean;
      carrier: string | null;
    }
  | {
      status: "unavailable";
      reason: string;
    };

type HotelSummary =
  | { status: "loading" }
  | {
      status: "ready";
      testMode: boolean;
      totalAmount: number;
      nightlyAmount: number;
      currency: string;
      nights: number;
      hotelsFound: number;
    }
  | {
      status: "unavailable";
      reason: string;
    };

type DestinationImage =
  | { status: "loading" }
  | {
      status: "ready";
      imageUrl: string;
      photoUrl: string;
      photographer: string;
      photographerUrl: string;
      alt: string;
    }
  | { status: "unavailable" };

const FLIGHT_ENRICH_LIMIT = 8;
const FLIGHT_CONCURRENCY = 3;
const HOTEL_ENRICH_LIMIT = 8;
const HOTEL_CONCURRENCY = 2;

function formatFlightPrice(amount: string, currency: string) {
  const numeric = Number(amount);
  if (!Number.isFinite(numeric)) return `${amount} ${currency}`;

  try {
    return new Intl.NumberFormat("en", {
      style: "currency",
      currency,
      maximumFractionDigits: 0,
    }).format(numeric);
  } catch {
    return `${Math.round(numeric)} ${currency}`;
  }
}

const STARTER_PREFERENCES: PreferenceState = {
  food_dining: { target: 78, importance: 0.8 },
  culture_history: { target: 72, importance: 0.7 },
};

function strengthLabel(target: number) {
  if (target >= 88) return "A must-have";
  if (target >= 72) return "Important";
  if (target >= 55) return "Nice to have";
  return "A little";
}

function importanceLabel(importance: number) {
  if (importance >= 0.9) return "Essential";
  if (importance >= 0.7) return "Important";
  if (importance >= 0.45) return "Helpful";
  return "Light";
}

function formatType(value: string) {
  return value
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

export default function DestinationDiscovery() {
  const [preferences, setPreferences] =
    useState<PreferenceState>(STARTER_PREFERENCES);
  const [results, setResults] = useState<DestinationResult[]>([]);
  const [loading, setLoading] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [origin, setOrigin] = useState<Origin | null>(null);
  const [tripTiming, setTripTiming] = useState<TripTiming | null>(null);
  const [flightSummaries, setFlightSummaries] = useState<
    Record<string, FlightSummary>
  >({});
  const flightRequestGeneration = useRef(0);

  const [hotelSummaries, setHotelSummaries] = useState<
    Record<string, HotelSummary>
  >({});
  const hotelRequestGeneration = useRef(0);

  const [destinationImages, setDestinationImages] = useState<
    Record<string, DestinationImage>
  >({});
  const imageRequestGeneration = useRef(0);

  useEffect(() => {
    const generation = ++imageRequestGeneration.current;

    if (results.length === 0) {
      setDestinationImages({});
      return;
    }

    setDestinationImages(
      Object.fromEntries(
        results.map((destination) => [
          destination.traveller_destination_id,
          { status: "loading" } as DestinationImage,
        ])
      )
    );

    (async () => {
      try {
        const response = await fetch("/api/destination-images", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            destinations: results.map((destination) => ({
              id: destination.traveller_destination_id,
              name: destination.display_name,
              destinationType: destination.destination_type,
              countryCode: destination.country_code,
            })),
          }),
        });

        const payload = await response.json();
        if (generation !== imageRequestGeneration.current) return;

        if (!response.ok || !payload.ok) {
          throw new Error(payload.error ?? "Destination images unavailable");
        }

        const next: Record<string, DestinationImage> = {};
        for (const item of payload.results ?? []) {
          next[item.id] = item.image
            ? {
                status: "ready",
                imageUrl: item.image.image_url,
                photoUrl: item.image.photo_url,
                photographer: item.image.photographer,
                photographerUrl: item.image.photographer_url,
                alt: item.image.alt || `${item.name} travel photo`,
              }
            : { status: "unavailable" };
        }

        for (const destination of results) {
          next[destination.traveller_destination_id] ??= { status: "unavailable" };
        }

        setDestinationImages(next);
      } catch {
        if (generation !== imageRequestGeneration.current) return;
        setDestinationImages(
          Object.fromEntries(
            results.map((destination) => [
              destination.traveller_destination_id,
              { status: "unavailable" } as DestinationImage,
            ])
          )
        );
      }
    })();

    return () => {
      imageRequestGeneration.current++;
    };
  }, [results]);

  useEffect(() => {
    const generation = ++flightRequestGeneration.current;

    if (
      !origin ||
      !tripTiming ||
      tripTiming.mode !== "exact" ||
      results.length === 0
    ) {
      setFlightSummaries({});
      return;
    }

    // Capture the narrowed exact-timing object before entering async workers.
    // TypeScript does not preserve state-union narrowing across the nested async closure.
    const exactTiming = tripTiming;
    const selectedOrigin = origin;

    const destinations = results.slice(0, FLIGHT_ENRICH_LIMIT);

    setFlightSummaries(
      Object.fromEntries(
        destinations.map((destination) => [
          destination.traveller_destination_id,
          { status: "loading" } as FlightSummary,
        ])
      )
    );

    let cursor = 0;

    async function worker() {
      while (cursor < destinations.length) {
        const destination = destinations[cursor++];

        try {
          const params = new URLSearchParams({
            origin_lat: String(selectedOrigin.latitude),
            origin_lon: String(selectedOrigin.longitude),
            destination_id: destination.traveller_destination_id,
            departure_date: exactTiming.startDate,
            return_date: exactTiming.endDate,
          });

          const response = await fetch(`/api/flight-summary?${params.toString()}`);
          const payload = await response.json();

          if (generation !== flightRequestGeneration.current) return;

          if (!response.ok || !payload.ok) {
            setFlightSummaries((current) => ({
              ...current,
              [destination.traveller_destination_id]: {
                status: "unavailable",
                reason: payload.reason ?? "unavailable",
              },
            }));
            continue;
          }

          setFlightSummaries((current) => ({
            ...current,
            [destination.traveller_destination_id]: {
              status: "ready",
              testMode: Boolean(payload.test_mode),
              originIata: payload.airport_pair.origin_iata,
              destinationIata: payload.airport_pair.destination_iata,
              amount: payload.cheapest.amount,
              currency: payload.cheapest.currency,
              duration: payload.cheapest.outbound_duration,
              stops: payload.cheapest.outbound_stops,
              direct: payload.cheapest.outbound_direct,
              carrier: payload.cheapest.carrier,
            },
          }));
        } catch {
          if (generation !== flightRequestGeneration.current) return;

          setFlightSummaries((current) => ({
            ...current,
            [destination.traveller_destination_id]: {
              status: "unavailable",
              reason: "request_failed",
            },
          }));
        }
      }
    }

    Promise.all(
      Array.from(
        { length: Math.min(FLIGHT_CONCURRENCY, destinations.length) },
        () => worker()
      )
    );

    return () => {
      flightRequestGeneration.current++;
    };
  }, [results, origin, tripTiming]);

  useEffect(() => {
    const generation = ++hotelRequestGeneration.current;

    if (
      !tripTiming ||
      tripTiming.mode !== "exact" ||
      results.length === 0
    ) {
      setHotelSummaries({});
      return;
    }

    const exactTiming = tripTiming;
    const destinations = results
      .filter(
        (destination) =>
          Number.isFinite(destination.latitude) &&
          Number.isFinite(destination.longitude)
      )
      .slice(0, HOTEL_ENRICH_LIMIT);

    setHotelSummaries(
      Object.fromEntries(
        destinations.map((destination) => [
          destination.traveller_destination_id,
          { status: "loading" } as HotelSummary,
        ])
      )
    );

    let cursor = 0;

    async function worker() {
      while (cursor < destinations.length) {
        const destination = destinations[cursor++];

        try {
          const params = new URLSearchParams({
            destination_lat: String(destination.latitude),
            destination_lon: String(destination.longitude),
            destination_type: destination.destination_type,
            checkin: exactTiming.startDate,
            checkout: exactTiming.endDate,
          });

          const response = await fetch(`/api/hotel-summary?${params.toString()}`);
          const payload = await response.json();

          if (generation !== hotelRequestGeneration.current) return;

          if (!response.ok || !payload.ok) {
            setHotelSummaries((current) => ({
              ...current,
              [destination.traveller_destination_id]: {
                status: "unavailable",
                reason: payload.reason ?? "unavailable",
              },
            }));
            continue;
          }

          setHotelSummaries((current) => ({
            ...current,
            [destination.traveller_destination_id]: {
              status: "ready",
              testMode: Boolean(payload.test_mode),
              totalAmount: Number(payload.cheapest.total_amount),
              nightlyAmount: Number(payload.cheapest.nightly_amount),
              currency: payload.cheapest.currency,
              nights: Number(payload.nights),
              hotelsFound: Number(payload.hotels_found ?? 0),
            },
          }));
        } catch {
          if (generation !== hotelRequestGeneration.current) return;

          setHotelSummaries((current) => ({
            ...current,
            [destination.traveller_destination_id]: {
              status: "unavailable",
              reason: "request_failed",
            },
          }));
        }
      }
    }

    Promise.all(
      Array.from(
        { length: Math.min(HOTEL_CONCURRENCY, destinations.length) },
        () => worker()
      )
    );

    return () => {
      hotelRequestGeneration.current++;
    };
  }, [results, tripTiming]);

  const visibleResults = useMemo(() => {
    const tripTotalFor = (result: DestinationResult) => {
      const flight = flightSummaries[result.traveller_destination_id];
      const hotel = hotelSummaries[result.traveller_destination_id];

      if (flight?.status !== "ready" || hotel?.status !== "ready") return null;
      if (flight.currency !== hotel.currency) return null;

      const flightAmount = Number(flight.amount);
      const stayAmount = Number(hotel.totalAmount);

      if (!Number.isFinite(flightAmount) || !Number.isFinite(stayAmount)) {
        return null;
      }

      return flightAmount + stayAmount;
    };

    const filtered = results.filter((result) => {
      const flight = flightSummaries[result.traveller_destination_id];

      if (directOnly) {
        if (flight?.status !== "ready" || !flight.direct) return false;
      }

      if (maxTripCost !== null) {
        const total = tripTotalFor(result);
        if (total === null || total > maxTripCost) return false;
      }

      return true;
    });

    return [...filtered].sort((a, b) => {
      const aFlight = flightSummaries[a.traveller_destination_id];
      const bFlight = flightSummaries[b.traveller_destination_id];
      const aHotel = hotelSummaries[a.traveller_destination_id];
      const bHotel = hotelSummaries[b.traveller_destination_id];

      const missingLast = (aValue: number | null, bValue: number | null) => {
        if (aValue === null && bValue === null) return 0;
        if (aValue === null) return 1;
        if (bValue === null) return -1;
        return aValue - bValue;
      };

      if (sortOption === "trip_cost_asc" || sortOption === "trip_cost_desc") {
        const aValue = tripTotalFor(a);
        const bValue = tripTotalFor(b);
        const order = missingLast(aValue, bValue);
        return sortOption === "trip_cost_desc" && aValue !== null && bValue !== null
          ? -order
          : order;
      }

      if (sortOption === "flight_price_asc") {
        const aValue =
          aFlight?.status === "ready" && Number.isFinite(Number(aFlight.amount))
            ? Number(aFlight.amount)
            : null;
        const bValue =
          bFlight?.status === "ready" && Number.isFinite(Number(bFlight.amount))
            ? Number(bFlight.amount)
            : null;
        return missingLast(aValue, bValue);
      }

      if (sortOption === "hotel_nightly_asc") {
        const aValue =
          aHotel?.status === "ready" && Number.isFinite(aHotel.nightlyAmount)
            ? aHotel.nightlyAmount
            : null;
        const bValue =
          bHotel?.status === "ready" && Number.isFinite(bHotel.nightlyAmount)
            ? bHotel.nightlyAmount
            : null;
        return missingLast(aValue, bValue);
      }

      if (sortOption === "flight_duration_asc") {
        const aValue =
          aFlight?.status === "ready"
            ? parseDurationMinutes(aFlight.duration)
            : null;
        const bValue =
          bFlight?.status === "ready"
            ? parseDurationMinutes(bFlight.duration)
            : null;
        return missingLast(aValue, bValue);
      }

      return b.match_score - a.match_score;
    });
  }, [
    results,
    flightSummaries,
    hotelSummaries,
    sortOption,
    directOnly,
    maxTripCost,
  ]);

  const selectedCount = Object.keys(preferences).length;

  const selectedIntents = useMemo(
    () => INTENTS.filter((intent) => Boolean(preferences[intent.key])),
    [preferences]
  );

  function toggleIntent(key: IntentKey) {
    setPreferences((current) => {
      const next = { ...current };

      if (next[key]) {
        delete next[key];
        return next;
      }

      if (Object.keys(next).length >= 5) {
        return next;
      }

      next[key] = {
        target: 78,
        importance: 0.75,
      };

      return next;
    });
  }

  function updatePreference(
    key: IntentKey,
    field: "target" | "importance",
    value: number
  ) {
    setPreferences((current) => ({
      ...current,
      [key]: {
        target: current[key]?.target ?? 78,
        importance: current[key]?.importance ?? 0.75,
        [field]: value,
      },
    }));
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setError(null);

    if (selectedCount === 0) {
      setError("Choose at least one thing you want from this trip.");
      return;
    }

    setLoading(true);
    setFlightSummaries({});
    setHotelSummaries({});

    try {
      const matcherPreferences = Object.fromEntries(
        Object.entries(preferences).map(([key, value]) => [
          key,
          {
            target: value!.target,
            importance: value!.importance,
            match_type: "minimum",
            tolerance: 18,
          },
        ])
      );

      const response = await fetch("/api/discover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          preferences: matcherPreferences,
          limit: 20,
        }),
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error ?? "TravelGinni could not run this search.");
      }

      setResults(payload.results ?? []);
      setSearched(true);

      requestAnimationFrame(() => {
        document
          .getElementById("travelginni-results")
          ?.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "TravelGinni could not run this search."
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className={styles.page}>
      <section className={styles.hero}>
        <div className={styles.eyebrow}>TravelGinni · Destination discovery</div>
        <h1>Don&apos;t search for a place. Tell us what you want from the trip.</h1>
        <p className={styles.heroCopy}>
          Pick the experiences that matter to you. TravelGinni will compare
          destinations and give you a small set worth considering.
        </p>
      </section>

      <OriginPicker value={origin} onChange={setOrigin} />
      <TripTimingPicker value={tripTiming} onChange={setTripTiming} />

      <form className={styles.discoveryPanel} onSubmit={submit}>
        <div className={styles.sectionHeader}>
          <div>
            <span className={styles.step}>01</span>
            <h2>What do you want?</h2>
          </div>
          <span className={styles.selectionCount}>
            {selectedCount}/5 selected
          </span>
        </div>

        <div className={styles.intentGrid}>
          {INTENTS.map((intent) => {
            const selected = Boolean(preferences[intent.key]);

            return (
              <button
                type="button"
                key={intent.key}
                className={`${styles.intentCard} ${
                  selected ? styles.intentSelected : ""
                }`}
                aria-pressed={selected}
                onClick={() => toggleIntent(intent.key)}
              >
                <span className={styles.intentEmoji}>{intent.emoji}</span>
                <span>
                  <strong>{intent.label}</strong>
                  <small>{intent.prompt}</small>
                </span>
                <span className={styles.check}>{selected ? "✓" : "+"}</span>
              </button>
            );
          })}
        </div>

        {selectedIntents.length > 0 && (
          <div className={styles.tuningSection}>
            <div className={styles.sectionHeader}>
              <div>
                <span className={styles.step}>02</span>
                <h2>How much does each matter?</h2>
              </div>
            </div>

            <div className={styles.preferenceList}>
              {selectedIntents.map((intent) => {
                const preference = preferences[intent.key]!;
                return (
                  <div className={styles.preferenceRow} key={intent.key}>
                    <div className={styles.preferenceTitle}>
                      <span>{intent.emoji}</span>
                      <div>
                        <strong>{intent.label}</strong>
                        <small>
                          {strengthLabel(preference.target)} ·{" "}
                          {importanceLabel(preference.importance)}
                        </small>
                      </div>
                    </div>

                    <label className={styles.sliderGroup}>
                      <span>How much of it?</span>
                      <input
                        type="range"
                        min="45"
                        max="95"
                        step="1"
                        value={preference.target}
                        onChange={(event) =>
                          updatePreference(
                            intent.key,
                            "target",
                            Number(event.target.value)
                          )
                        }
                      />
                    </label>

                    <label className={styles.sliderGroup}>
                      <span>How important?</span>
                      <input
                        type="range"
                        min="0.25"
                        max="1"
                        step="0.05"
                        value={preference.importance}
                        onChange={(event) =>
                          updatePreference(
                            intent.key,
                            "importance",
                            Number(event.target.value)
                          )
                        }
                      />
                    </label>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {error && <div className={styles.error}>{error}</div>}

        <button
          className={styles.primaryButton}
          type="submit"
          disabled={loading || selectedCount === 0}
        >
          {loading ? "Finding your destinations…" : "Find my destinations"}
        </button>
      </form>

      {searched && (
        <section className={styles.results} id="travelginni-results">
          <div className={styles.resultsHeader}>
            <div>
              <span className={styles.step}>03</span>
              <h2>Your strongest matches</h2>
              <p>
                A decision set, not a single answer. Compare the trade-offs and
                choose what feels right.
              </p>
            </div>
            <button
              className={styles.secondaryButton}
              type="button"
              onClick={() =>
                window.scrollTo({ top: 0, behavior: "smooth" })
              }
            >
              Refine preferences
            </button>
          </div>

          <div className={styles.resultControls}>
            <div className={styles.controlGroup}>
              <label htmlFor="travelginni-sort">Sort by</label>
              <select
                id="travelginni-sort"
                value={sortOption}
                onChange={(event) => setSortOption(event.target.value as SortOption)}
              >
                <option value="best_match">Best match</option>
                <option value="trip_cost_asc">Trip cost: low to high</option>
                <option value="trip_cost_desc">Trip cost: high to low</option>
                <option value="flight_price_asc">Flight fare: low to high</option>
                <option value="hotel_nightly_asc">Stay price/night: low to high</option>
                <option value="flight_duration_asc">Shortest flight</option>
              </select>
            </div>

            <div className={styles.controlGroup}>
              <label htmlFor="travelginni-max-cost">Max trip cost</label>
              <select
                id="travelginni-max-cost"
                value={maxTripCost ?? ""}
                onChange={(event) =>
                  setMaxTripCost(event.target.value ? Number(event.target.value) : null)
                }
              >
                <option value="">Any price</option>
                <option value="500">Up to €500</option>
                <option value="750">Up to €750</option>
                <option value="1000">Up to €1,000</option>
                <option value="1500">Up to €1,500</option>
                <option value="2000">Up to €2,000</option>
              </select>
            </div>

            <label className={styles.checkboxControl}>
              <input
                type="checkbox"
                checked={directOnly}
                onChange={(event) => setDirectOnly(event.target.checked)}
              />
              <span>Direct flights only</span>
            </label>

            <div className={styles.controlSummary}>
              Showing <strong>{visibleResults.length}</strong> of {results.length}
            </div>

            {(sortOption !== "best_match" || directOnly || maxTripCost !== null) && (
              <button
                type="button"
                className={styles.clearControls}
                onClick={() => {
                  setSortOption("best_match");
                  setDirectOnly(false);
                  setMaxTripCost(null);
                }}
              >
                Reset
              </button>
            )}
          </div>

          <div className={styles.resultGrid}>
            {visibleResults.map((result, index) => {
              const sortedReasons = Object.entries(result.preference_breakdown)
                .sort(([, a], [, b]) => b.intent_match - a.intent_match)
                .slice(0, 3);

              return (
                <article className={styles.resultCard} key={result.traveller_destination_id}>
                  <div className={styles.destinationImage}>
                    {destinationImages[result.traveller_destination_id]?.status === "ready" ? (() => {
                      const image = destinationImages[
                        result.traveller_destination_id
                      ] as Extract<DestinationImage, { status: "ready" }>;

                      return (
                        <>
                          <a
                            href={image.photoUrl}
                            target="_blank"
                            rel="noreferrer"
                            className={styles.destinationImageLink}
                            aria-label={`Open ${result.display_name} photo on Pexels`}
                          >
                            <img
                              src={image.imageUrl}
                              alt={image.alt}
                              className={styles.destinationImagePhoto}
                            />
                          </a>
                          <div className={styles.imageCredit}>
                            Photo by{" "}
                            <a href={image.photographerUrl} target="_blank" rel="noreferrer">
                              {image.photographer}
                            </a>{" "}
                            · Pexels
                          </div>
                        </>
                      );
                    })() : (
                      <div className={styles.destinationImagePlaceholder}>
                        {destinationImages[result.traveller_destination_id]?.status === "loading"
                          ? "Loading destination image…"
                          : "Destination image unavailable"}
                      </div>
                    )}
                  </div>

                  <div className={styles.cardTop}>
                    <span className={styles.rank}>#{index + 1}</span>
                    <span className={styles.match}>
                      {Math.round(result.match_score)}% match
                    </span>
                  </div>

                  <h3>{result.display_name}</h3>

                  <div className={styles.meta}>
                    <span>{formatType(result.destination_type)}</span>
                    {result.country_code && <span>{result.country_code}</span>}
                    <span>
                      {Math.round(result.evidence_confidence_score)}% evidence
                    </span>
                  </div>

                  <div className={styles.reasonBlock}>
                    <span className={styles.reasonHeading}>Why it fits</span>

                    {sortedReasons.map(([key, breakdown]) => {
                      const intent = getIntent(key);
                      return (
                        <div className={styles.reason} key={key}>
                          <div>
                            <span>{intent?.emoji}</span>
                            <strong>{intent?.shortLabel ?? key}</strong>
                          </div>
                          <span>{Math.round(breakdown.destination_score)}/100</span>
                        </div>
                      );
                    })}
                  </div>

                  {origin && tripTiming?.mode === "exact" && flightSummaries[result.traveller_destination_id] && (
                    <div className={styles.flightBlock}>
                      {flightSummaries[result.traveller_destination_id]?.status === "loading" && (
                        <div className={styles.flightLoading}>
                          <span>✈️</span>
                          <span>Checking flights from {origin.name}…</span>
                        </div>
                      )}

                      {flightSummaries[result.traveller_destination_id]?.status === "ready" && (() => {
                        const flight = flightSummaries[
                          result.traveller_destination_id
                        ] as Extract<FlightSummary, { status: "ready" }>;

                        return (
                          <>
                            <div className={styles.flightRoute}>
                              <span className={styles.flightIcon}>✈️</span>
                              <div>
                                <strong>
                                  {flight.duration ?? "Flight available"} ·{" "}
                                  {flight.direct
                                    ? "Direct"
                                    : `${flight.stops} ${flight.stops === 1 ? "stop" : "stops"}`}
                                </strong>
                                <small>
                                  {flight.originIata} → {flight.destinationIata}
                                  {flight.carrier ? ` · ${flight.carrier}` : ""}
                                </small>
                              </div>
                            </div>

                            <div className={styles.flightPriceRow}>
                              <div>
                                <span className={styles.testBadge}>
                                  {flight.testMode ? "TEST FARE" : "LIVE FARE"}
                                </span>
                                <strong>
                                  from {formatFlightPrice(flight.amount, flight.currency)}
                                </strong>
                                <small>return · 1 adult</small>
                              </div>
                            </div>
                          </>
                        );
                      })()}

                      {flightSummaries[result.traveller_destination_id]?.status === "unavailable" && (
                        <div className={styles.flightUnavailable}>
                          <span>✈️</span>
                          <span>No flight test result for this destination yet.</span>
                        </div>
                      )}
                    </div>
                  )}

                  {tripTiming?.mode === "exact" && hotelSummaries[result.traveller_destination_id] && (
                    <div className={styles.hotelBlock}>
                      {hotelSummaries[result.traveller_destination_id]?.status === "loading" && (
                        <div className={styles.hotelLoading}>
                          <span>🏨</span>
                          <span>Checking stay prices…</span>
                        </div>
                      )}

                      {hotelSummaries[result.traveller_destination_id]?.status === "ready" && (() => {
                        const hotel = hotelSummaries[
                          result.traveller_destination_id
                        ] as Extract<HotelSummary, { status: "ready" }>;

                        return (
                          <div className={styles.hotelPriceRow}>
                            <span className={styles.hotelIcon}>🏨</span>
                            <div>
                              <span className={styles.testBadge}>
                                {hotel.testMode ? "TEST STAY" : "LIVE STAY"}
                              </span>
                              <strong>
                                stays from {formatFlightPrice(
                                  String(hotel.nightlyAmount),
                                  hotel.currency
                                )}/night
                              </strong>
                              <small>
                                {hotel.nights} {hotel.nights === 1 ? "night" : "nights"} · {formatFlightPrice(
                                  String(hotel.totalAmount),
                                  hotel.currency
                                )} total
                              </small>
                            </div>
                          </div>
                        );
                      })()}

                      {hotelSummaries[result.traveller_destination_id]?.status === "unavailable" && (
                        <div className={styles.hotelUnavailable}>
                          <span>🏨</span>
                          <span>No hotel test rate for this destination yet.</span>
                        </div>
                      )}
                    </div>
                  )}

                  {tripTiming?.mode === "exact" &&
                    flightSummaries[result.traveller_destination_id]?.status === "ready" &&
                    hotelSummaries[result.traveller_destination_id]?.status === "ready" &&
                    (() => {
                      const flight = flightSummaries[
                        result.traveller_destination_id
                      ] as Extract<FlightSummary, { status: "ready" }>;
                      const hotel = hotelSummaries[
                        result.traveller_destination_id
                      ] as Extract<HotelSummary, { status: "ready" }>;

                      if (flight.currency !== hotel.currency) return null;

                      const flightAmount = Number(flight.amount);
                      const stayAmount = Number(hotel.totalAmount);

                      if (!Number.isFinite(flightAmount) || !Number.isFinite(stayAmount)) {
                        return null;
                      }

                      const tripTotal = flightAmount + stayAmount;

                      return (
                        <div className={styles.tripCostBlock}>
                          <div className={styles.tripCostLabel}>ESTIMATED TRIP COST</div>
                          <strong className={styles.tripCostAmount}>
                            from {formatFlightPrice(String(tripTotal), flight.currency)}
                          </strong>
                          <small className={styles.tripCostBreakdown}>
                            return flight {formatFlightPrice(flight.amount, flight.currency)}
                            {" + "}
                            {hotel.nights} {hotel.nights === 1 ? "night" : "nights"} stay{" "}
                            {formatFlightPrice(String(hotel.totalAmount), hotel.currency)}
                          </small>
                        </div>
                      );
                    })()}

                  <div className={styles.confidenceLine}>
                    TravelGinni confidence:{" "}
                    <strong>{result.travel_role_confidence.toLowerCase()}</strong>
                  </div>
                </article>
              );
            })}
          </div>

          {results.length === 0 && (
            <div className={styles.empty}>
              No destination passed these preferences. Try making one preference
              less strict.
            </div>
          )}
        </section>
      )}
    </main>
  );
}
