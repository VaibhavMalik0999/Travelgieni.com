import { supabase } from './supabase';
import type {
  CostLevel,
  Destination,
  DestinationType,
  TravelInterest,
} from './travel-types';

type DestinationRow = {
  id: string;
  name: string;
  country: string;
  country_code: string | null;
  destination_type: string;
  latitude: number | null;
  longitude: number | null;
  cost_level: number | null;
  min_trip_days: number | null;
  max_trip_days: number | null;
  source: string | null;
  destination_attributes: Array<{ attribute: string; score: number }> | null;
  destination_seasonality: Array<{ month: number; suitability_score: number }> | null;
};

const VALID_TYPES = new Set<DestinationType>([
  'city',
  'island',
  'coast',
  'region',
  'mountains',
  'lake',
]);

const VALID_INTERESTS = new Set<TravelInterest>([
  'beach',
  'nature',
  'culture',
  'food',
  'nightlife',
  'romantic',
  'family',
  'hiking',
  'wellness',
  'winter',
]);

export async function loadDestinations(): Promise<Destination[]> {
  const { data, error } = await supabase
    .from('destinations')
    .select(`
      id,
      name,
      country,
      country_code,
      destination_type,
      latitude,
      longitude,
      cost_level,
      min_trip_days,
      max_trip_days,
      source,
      destination_attributes(attribute, score),
      destination_seasonality(month, suitability_score)
    `)
    .eq('is_active', true)
    .order('name');

  if (error) throw error;

  return ((data ?? []) as DestinationRow[]).map((row) => {
    const type = VALID_TYPES.has(row.destination_type as DestinationType)
      ? (row.destination_type as DestinationType)
      : 'region';

    const interests = (row.destination_attributes ?? [])
      .filter((item) => item.score > 0 && VALID_INTERESTS.has(item.attribute as TravelInterest))
      .map((item) => item.attribute as TravelInterest);

    const bestMonths = (row.destination_seasonality ?? [])
      .filter((item) => item.suitability_score >= 80)
      .map((item) => item.month)
      .sort((a, b) => a - b);

    const costLevel = Math.min(4, Math.max(1, row.cost_level ?? 2)) as CostLevel;
    const minDays = Math.max(1, row.min_trip_days ?? 2);
    const maxDays = Math.max(minDays, row.max_trip_days ?? 7);

    return {
      id: row.id,
      name: row.name,
      country: row.country,
      countryCode: row.country_code ?? '',
      type,
      latitude: row.latitude ?? 0,
      longitude: row.longitude ?? 0,
      interests,
      bestMonths,
      costLevel,
      typicalDays: [minDays, maxDays],
      source: 'TravelGieni database',
    };
  });
}
