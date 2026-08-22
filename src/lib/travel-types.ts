export type DestinationType =
  | 'city'
  | 'island'
  | 'coast'
  | 'region'
  | 'mountains'
  | 'lake';

export type TravelInterest =
  | 'beach'
  | 'nature'
  | 'culture'
  | 'food'
  | 'nightlife'
  | 'romantic'
  | 'family'
  | 'hiking'
  | 'wellness'
  | 'winter';

export type CostLevel = 1 | 2 | 3 | 4;

export interface Destination {
  id: string;
  name: string;
  country: string;
  countryCode: string;
  type: DestinationType;
  latitude: number;
  longitude: number;
  interests: TravelInterest[];
  bestMonths: number[];
  costLevel: CostLevel;
  typicalDays: [number, number];
  source: 'TravelGieni seed catalogue';
}

export interface DestinationSearchInput {
  query?: string;
  countries?: string[];
  types?: DestinationType[];
  interests?: TravelInterest[];
  month?: number;
  maxCostLevel?: CostLevel;
  tripDays?: number;
}

export interface RankedDestination extends Destination {
  score: number;
  reasons: string[];
  tradeoffs: string[];
}
