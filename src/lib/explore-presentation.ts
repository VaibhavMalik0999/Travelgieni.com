import type { IntentKey } from "./intents";
import type { ExplorePreferences, ExploreResponse, RankedExplorePoi } from "./explore-types";

export type ExploreInterestShelf = { intent: IntentKey; pois: RankedExplorePoi[] };
export type ExplorePresentation = { interests: ExploreInterestShelf[]; highlights: RankedExplorePoi[] };

/** Allocate each POI to at most one visible section, preserving the existing ranking API. */
export function buildExplorePresentation(response: ExploreResponse, preferences: ExplorePreferences): ExplorePresentation {
  const used = new Set<string>();
  const interests: ExploreInterestShelf[] = [];
  const orderedIntents = (Object.keys(preferences) as IntentKey[])
    .sort((a, b) => (preferences[b]?.importance ?? 0) - (preferences[a]?.importance ?? 0));

  for (const intent of orderedIntents) {
    const ranked = response.by_interest[intent] ?? [];
    const pois = ranked.filter((poi) => {
      if (used.has(poi.poi_id)) return false;
      used.add(poi.poi_id);
      return true;
    });
    if (pois.length) interests.push({ intent, pois });
  }

  // Use the destination-significance scores of the available ranked candidates.
  // The existing API's dont_miss is derived from top_picks, so it is not an independent
  // catalogue of iconic attractions. Missing landmarks require upstream inventory expansion.
  const candidates = new Map<string, RankedExplorePoi>();
  for (const poi of [...response.dont_miss, ...response.top_picks]) candidates.set(poi.poi_id, poi);
  const highlights = [...candidates.values()]
    .filter((poi) => !used.has(poi.poi_id))
    .sort((a, b) => b.ranking.destination_significance - a.ranking.destination_significance || a.poi_name.localeCompare(b.poi_name))
    .slice(0, 5);
  return { interests, highlights };
}
