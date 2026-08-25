import { NextRequest, NextResponse } from 'next/server';

export async function POST(request: NextRequest) {
  try {
    const { latitude, longitude } = await request.json();
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude) || latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
      return NextResponse.json({ error: 'Invalid coordinates.' }, { status: 400 });
    }
    const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!url || !key) throw new Error('Missing Supabase configuration');
    const response = await fetch(`${url}/rest/v1/rpc/nearest_travelginni_origin`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_latitude: latitude, p_longitude: longitude, p_limit: 5, p_max_distance_km: 100 }),
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok) return NextResponse.json({ error: 'Location lookup failed.' }, { status: 502 });
    return NextResponse.json({ results: payload });
  } catch {
    return NextResponse.json({ error: 'We could not detect your origin.' }, { status: 500 });
  }
}
