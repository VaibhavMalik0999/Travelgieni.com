import type { Destination, DestinationSearchInput, RankedDestination } from './travel-types';

function textMatches(destination: Destination, query?: string) {
  if (!query?.trim()) return true;
  const q = query.toLowerCase().trim();
  return [destination.name, destination.country, destination.type, ...destination.interests]
    .join(' ')
    .toLowerCase()
    .includes(q);
}

export function findDestinations(
  destinations: Destination[],
  input: DestinationSearchInput,
): RankedDestination[] {
  return destinations
    .filter((d) => textMatches(d, input.query))
    .filter((d) => !input.countries?.length || input.countries.includes(d.countryCode))
    .filter((d) => !input.types?.length || input.types.includes(d.type))
    .filter((d) => !input.maxCostLevel || d.costLevel <= input.maxCostLevel)
    .map((d) => scoreDestination(d, input))
    .sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

function scoreDestination(d: Destination, input: DestinationSearchInput): RankedDestination {
  let score = 50;
  const reasons: string[] = [];
  const tradeoffs: string[] = [];

  const requestedInterests = input.interests ?? [];
  if (requestedInterests.length) {
    const matched = requestedInterests.filter((i) => d.interests.includes(i));
    const interestFit = matched.length / requestedInterests.length;
    score += Math.round(interestFit * 30);
    if (matched.length) reasons.push(`Matches ${matched.join(', ')}`);
    const missed = requestedInterests.filter((i) => !d.interests.includes(i));
    if (missed.length) tradeoffs.push(`Weaker for ${missed.join(', ')}`);
  }

  if (input.month) {
    if (d.bestMonths.includes(input.month)) {
      score += 12;
      reasons.push('Strong seasonal fit');
    } else {
      score -= 8;
      tradeoffs.push('Not one of its strongest months');
    }
  }

  if (input.tripDays) {
    const [min, max] = d.typicalDays;
    if (input.tripDays >= min && input.tripDays <= max) {
      score += 8;
      reasons.push(`Fits a ${input.tripDays}-day trip`);
    } else if (input.tripDays < min) {
      score -= 6;
      tradeoffs.push(`Usually works better with at least ${min} days`);
    } else {
      tradeoffs.push(`Typical stay is ${min}–${max} days`);
    }
  }

  if (input.maxCostLevel && d.costLevel <= input.maxCostLevel) {
    score += Math.max(0, (input.maxCostLevel - d.costLevel) * 2);
    reasons.push(`Within cost level ${input.maxCostLevel}`);
  }

  return { ...d, score: Math.max(0, Math.min(100, score)), reasons, tradeoffs };
}
