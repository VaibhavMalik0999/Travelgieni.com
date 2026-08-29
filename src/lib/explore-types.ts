import type { IntentKey } from "./intents";

export type ExploreMatchType = "minimum" | "target" | "maximum";

export type ExplorePreference = {
  target: number;
  importance: number;
  match_type: ExploreMatchType;
  tolerance?: number;
  hard_min?: number;
  hard_max?: number;
};

export type ExplorePreferences = Partial<Record<IntentKey, ExplorePreference>>;

/** A precomputed named POI candidate returned by the Explore data layer. */
export type ExplorePoiCandidate = {
  poi_id: string;
  traveller_destination_id: string;
  poi_name: string;
  category: string;
  latitude: number;
  longitude: number;
  /** Offline destination-membership gate. Invalid or mislocated POIs must be false. */
  is_valid_for_destination: boolean;
  /** Precomputed destination significance in the selected destination, from 0 to 1. */
  destination_significance: number;
  /** Structured POI-to-intent relevance, with values from 0 to 1. */
  intent_relevance: Partial<Record<IntentKey, number>>;
  /** Offline semantic POI-to-intent rescue scores, with values from 0 to 1. */
  semantic_intent_relevance?: Partial<Record<IntentKey, number>>;
  description?: string | null;
  locality?: string | null;
  country_code?: string | null;
  source_name?: string | null;
  source_poi_id?: string | null;
  source_url?: string | null;
};

export type ExploreRankingComponents = {
  validity: 1;
  structured_relevance: number;
  semantic_relevance: number;
  fused_relevance: number;
  destination_significance: number;
  individual_utility: number;
  coverage_reward: number;
  redundancy_penalty: number;
  marginal_score: number;
  matched_intents: IntentKey[];
  selection_rank: number;
};

export type RankedExplorePoi = ExplorePoiCandidate & {
  ranking: ExploreRankingComponents;
};

export type ExploreRequest = {
  traveller_destination_id: string;
  preferences: ExplorePreferences;
  limit?: number;
};

export type ExploreResponse = {
  traveller_destination_id: string;
  ranking_version: "explore-ranking-v1";
  top_picks: RankedExplorePoi[];
  by_interest: Partial<Record<IntentKey, RankedExplorePoi[]>>;
  dont_miss: RankedExplorePoi[];
};
