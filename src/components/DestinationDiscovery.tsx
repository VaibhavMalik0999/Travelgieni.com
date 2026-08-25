"use client";

import { FormEvent, useMemo, useState } from "react";
import { getIntent, INTENTS, IntentKey } from "@/lib/intents";
import styles from "./DestinationDiscovery.module.css";
import OriginPicker, { type Origin } from "./OriginPicker";

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

          <div className={styles.resultGrid}>
            {results.map((result, index) => {
              const sortedReasons = Object.entries(result.preference_breakdown)
                .sort(([, a], [, b]) => b.intent_match - a.intent_match)
                .slice(0, 3);

              return (
                <article className={styles.resultCard} key={result.traveller_destination_id}>
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
