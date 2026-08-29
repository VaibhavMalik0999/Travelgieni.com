import type { IntentKey } from "./intents";
import type {
  ExplorePoiCandidate,
  ExplorePreferences,
  ExploreResponse,
  RankedExplorePoi,
} from "./explore-types";

export const EXPLORE_RANKING_VERSION = "explore-ranking-v1" as const;
export const DEFAULT_COVERAGE_WEIGHT = 0.2;
export const DEFAULT_REDUNDANCY_WEIGHT = 0.12;

function clamp01(value: number | undefined) {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value!));
}

function round(value: number) {
  return Number(value.toFixed(6));
}

export function noisyOr(values: number[]) {
  return clamp01(1 - values.reduce((remaining, value) => remaining * (1 - clamp01(value)), 1));
}

/** The locked Explore semantic-rescue fusion formula. */
export function fuseRelevance(structured: number, semantic: number) {
  const structuredScore = clamp01(structured);
  const semanticScore = clamp01(semantic);
  return clamp01(1 - (1 - structuredScore) * (1 - 0.85 * semanticScore));
}

export function geometricUtility(
  validity: boolean,
  fusedRelevance: number,
  destinationSignificance: number
) {
  if (!validity) return 0;
  return (
    Math.pow(clamp01(fusedRelevance), 0.65) *
    Math.pow(clamp01(destinationSignificance), 0.35)
  );
}

type IntentFit = {
  intent: IntentKey;
  weight: number;
  structured: number;
  semantic: number;
  fused: number;
};

function selectedPreferences(preferences: ExplorePreferences) {
  return Object.entries(preferences)
    .filter(([, preference]) => preference)
    .map(([key, preference]) => ({
      intent: key as IntentKey,
      target: clamp01(preference!.target / 100),
      importance: clamp01(preference!.importance),
    }))
    .filter(({ importance }) => importance > 0);
}

function intentFits(candidate: ExplorePoiCandidate, preferences: ExplorePreferences): IntentFit[] {
  return selectedPreferences(preferences).map(({ intent, target, importance }) => {
    const weight = importance * target;
    const structured = clamp01(candidate.intent_relevance[intent]) * weight;
    const semantic = clamp01(candidate.semantic_intent_relevance?.[intent]) * weight;
    return { intent, weight, structured, semantic, fused: fuseRelevance(structured, semantic) };
  });
}

function cosineSimilarity(a: IntentFit[], b: IntentFit[]) {
  const aByIntent = new Map(a.map((fit) => [fit.intent, fit.fused]));
  const bByIntent = new Map(b.map((fit) => [fit.intent, fit.fused]));
  const keys = new Set([...aByIntent.keys(), ...bByIntent.keys()]);
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (const key of keys) {
    const av = aByIntent.get(key) ?? 0;
    const bv = bByIntent.get(key) ?? 0;
    dot += av * bv;
    normA += av * av;
    normB += bv * bv;
  }
  return normA && normB ? dot / Math.sqrt(normA * normB) : 0;
}

function similarity(
  candidate: ExplorePoiCandidate,
  candidateFits: IntentFit[],
  selected: { candidate: ExplorePoiCandidate; fits: IntentFit[] }[]
) {
  return selected.reduce((maximum, item) => {
    const categorySimilarity =
      candidate.category.trim().toLowerCase() === item.candidate.category.trim().toLowerCase()
        ? 1
        : 0;
    return Math.max(maximum, categorySimilarity, cosineSimilarity(candidateFits, item.fits));
  }, 0);
}

export type ExploreRankingOptions = {
  limit?: number;
  coverageWeight?: number;
  redundancyWeight?: number;
  interestGroupLimit?: number;
  dontMissLimit?: number;
};

/** Pure, provider- and destination-type-independent Explore Ranking V1. */
export function rankExplorePois(
  travellerDestinationId: string,
  candidates: ExplorePoiCandidate[],
  preferences: ExplorePreferences,
  options: ExploreRankingOptions = {}
): ExploreResponse {
  const limit = Math.max(1, Math.floor(options.limit ?? 20));
  const lambda = Math.max(0, options.coverageWeight ?? DEFAULT_COVERAGE_WEIGHT);
  const mu = Math.max(0, options.redundancyWeight ?? DEFAULT_REDUNDANCY_WEIGHT);

  const eligible = candidates
    .filter(
      (candidate) =>
        candidate.is_valid_for_destination &&
        candidate.traveller_destination_id === travellerDestinationId
    )
    .map((candidate) => {
      const fits = intentFits(candidate, preferences);
      const structured = noisyOr(fits.map(({ structured: value }) => value));
      const semantic = noisyOr(fits.map(({ semantic: value }) => value));
      const fused = fuseRelevance(structured, semantic);
      const utility = geometricUtility(true, fused, candidate.destination_significance);
      return { candidate, fits, structured, semantic, fused, utility };
    });

  const selected: Array<(typeof eligible)[number] & RankedExplorePoi["ranking"]> = [];
  const covered = new Map<IntentKey, number>();
  const remaining = [...eligible];

  while (remaining.length && selected.length < limit) {
    let bestIndex = 0;
    let bestMetrics = { coverage: 0, redundancy: 0, marginal: -Infinity };

    remaining.forEach((item, index) => {
      const coverage = item.fits.reduce((reward, fit) => {
        const previous = covered.get(fit.intent) ?? 0;
        return reward + Math.max(0, fit.fused - previous) * fit.weight;
      }, 0);
      const redundancy = similarity(item.candidate, item.fits, selected);
      const marginal = item.utility + lambda * coverage - mu * redundancy;

      if (
        marginal > bestMetrics.marginal ||
        (marginal === bestMetrics.marginal &&
          item.candidate.poi_id.localeCompare(remaining[bestIndex].candidate.poi_id) < 0)
      ) {
        bestIndex = index;
        bestMetrics = { coverage, redundancy, marginal };
      }
    });

    const chosen = remaining.splice(bestIndex, 1)[0];
    for (const fit of chosen.fits) {
      covered.set(fit.intent, Math.max(covered.get(fit.intent) ?? 0, fit.fused));
    }
    selected.push({
      ...chosen,
      validity: 1,
      structured_relevance: round(chosen.structured),
      semantic_relevance: round(chosen.semantic),
      fused_relevance: round(chosen.fused),
      destination_significance: round(clamp01(chosen.candidate.destination_significance)),
      individual_utility: round(chosen.utility),
      coverage_reward: round(lambda * bestMetrics.coverage),
      redundancy_penalty: round(mu * bestMetrics.redundancy),
      marginal_score: round(bestMetrics.marginal),
      matched_intents: chosen.fits
        .filter(({ fused }) => fused > 0)
        .sort((a, b) => b.fused - a.fused)
        .map(({ intent }) => intent),
      selection_rank: selected.length + 1,
    });
  }

  const topPicks: RankedExplorePoi[] = selected.map((item) => ({
    ...item.candidate,
    ranking: {
      validity: item.validity,
      structured_relevance: item.structured_relevance,
      semantic_relevance: item.semantic_relevance,
      fused_relevance: item.fused_relevance,
      destination_significance: item.destination_significance,
      individual_utility: item.individual_utility,
      coverage_reward: item.coverage_reward,
      redundancy_penalty: item.redundancy_penalty,
      marginal_score: item.marginal_score,
      matched_intents: item.matched_intents,
      selection_rank: item.selection_rank,
    },
  }));

  const byInterest: ExploreResponse["by_interest"] = {};
  const groupLimit = Math.max(1, options.interestGroupLimit ?? 6);
  for (const { intent } of selectedPreferences(preferences)) {
    byInterest[intent] = [...topPicks]
      .filter((poi) => clamp01(poi.intent_relevance[intent]) > 0 || clamp01(poi.semantic_intent_relevance?.[intent]) > 0)
      .sort((a, b) => {
        const aScore = fuseRelevance(a.intent_relevance[intent] ?? 0, a.semantic_intent_relevance?.[intent] ?? 0);
        const bScore = fuseRelevance(b.intent_relevance[intent] ?? 0, b.semantic_intent_relevance?.[intent] ?? 0);
        return bScore - aScore || a.ranking.selection_rank - b.ranking.selection_rank;
      })
      .slice(0, groupLimit);
  }

  const dontMiss = [...topPicks]
    .sort(
      (a, b) =>
        b.ranking.destination_significance - a.ranking.destination_significance ||
        a.ranking.selection_rank - b.ranking.selection_rank
    )
    .slice(0, Math.max(1, options.dontMissLimit ?? 5));

  return {
    traveller_destination_id: travellerDestinationId,
    ranking_version: EXPLORE_RANKING_VERSION,
    top_picks: topPicks,
    by_interest: byInterest,
    dont_miss: dontMiss,
  };
}
