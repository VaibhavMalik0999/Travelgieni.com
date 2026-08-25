import { NextRequest, NextResponse } from 'next/server';

function config() {
  const url = process.env.SUPABASE_URL ?? process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('Supabase server configuration is incomplete.');
  return { url, key };
}

export async function GET(request: NextRequest) {
  try {
    const q = (request.nextUrl.searchParams.get('q') ?? '').trim();
    if (q.length < 2) return NextResponse.json({ results: [] });
    const { url, key } = config();
    const response = await fetch(`${url}/rest/v1/rpc/search_travelginni_origins`, {
      method: 'POST',
      headers: { apikey: key, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ p_query: q, p_limit: 8 }),
      cache: 'no-store',
    });
    const payload = await response.json();
    if (!response.ok) return NextResponse.json({ error: 'Origin search failed.' }, { status: 502 });
    return NextResponse.json({ results: payload });
  } catch {
    return NextResponse.json({ error: 'Origin search is unavailable.' }, { status: 500 });
  }
}
