import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function isoDurationToMinutes(value?: string | null) {
  if (!value) return null;

  const match = value.match(
    /^P(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/
  );

  if (!match) return null;

  const days = Number(match[1] ?? 0);
  const hours = Number(match[2] ?? 0);
  const minutes = Number(match[3] ?? 0);
  const seconds = Number(match[4] ?? 0);

  return days * 24 * 60 + hours * 60 + minutes + Math.round(seconds / 60);
}

function formatMinutes(totalMinutes: number | null) {
  if (totalMinutes == null) return null;

  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;

  if (hours === 0) return `${minutes}m`;
  if (minutes === 0) return `${hours}h`;

  return `${hours}h ${minutes}m`;
}

export async function GET() {
  const token = process.env.DUFFEL_ACCESS_TOKEN;

  if (!token) {
    return NextResponse.json(
      {
        ok: false,
        error: "DUFFEL_ACCESS_TOKEN is missing from Vercel environment variables.",
      },
      { status: 500 }
    );
  }

  // Fixed future date for this first integration test.
  // Test-mode prices/schedules are NOT intended to be treated as real market data.
  const departureDate = "2026-09-15";

  const response = await fetch(
    "https://api.duffel.com/air/offer_requests?return_offers=true&supplier_timeout=10000",
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Duffel-Version": "v2",
        Accept: "application/json",
        "Accept-Encoding": "gzip",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        data: {
          cabin_class: "economy",
          slices: [
            {
              origin: "BER",
              destination: "PMI",
              departure_date: departureDate,
            },
          ],
          passengers: [
            {
              type: "adult",
            },
          ],
        },
      }),
      cache: "no-store",
    }
  );

  const payload = await response.json();

  if (!response.ok) {
    return NextResponse.json(
      {
        ok: false,
        duffel_status: response.status,
        duffel_error: payload,
      },
      { status: response.status }
    );
  }

  const requestData = payload?.data;
  const offers = Array.isArray(requestData?.offers) ? requestData.offers : [];

  const normalized = offers
    .map((offer: any) => {
      const outbound = offer?.slices?.[0];
      const segments = Array.isArray(outbound?.segments)
        ? outbound.segments
        : [];

      const durationMinutes = isoDurationToMinutes(outbound?.duration);

      return {
        offer_id: offer?.id ?? null,
        live_mode: requestData?.live_mode ?? null,
        price: {
          amount: offer?.total_amount ?? null,
          currency: offer?.total_currency ?? null,
        },
        duration: outbound?.duration ?? null,
        duration_minutes: durationMinutes,
        duration_display: formatMinutes(durationMinutes),
        stops: Math.max(0, segments.length - 1),
        segments: segments.map((segment: any) => ({
          origin: segment?.origin?.iata_code ?? segment?.origin?.name ?? null,
          destination:
            segment?.destination?.iata_code ??
            segment?.destination?.name ??
            null,
          departing_at: segment?.departing_at ?? null,
          arriving_at: segment?.arriving_at ?? null,
          operating_carrier:
            segment?.operating_carrier?.name ?? null,
          marketing_carrier:
            segment?.marketing_carrier?.name ?? null,
          flight_number:
            segment?.marketing_carrier_flight_number ?? null,
        })),
      };
    })
    .sort((a: any, b: any) => {
      const aAmount = Number(a?.price?.amount ?? Number.POSITIVE_INFINITY);
      const bAmount = Number(b?.price?.amount ?? Number.POSITIVE_INFINITY);
      return aAmount - bAmount;
    });

  return NextResponse.json({
    ok: true,
    test: {
      origin: "BER",
      destination: "PMI",
      departure_date: departureDate,
      passengers: 1,
      cabin_class: "economy",
    },
    offer_request_id: requestData?.id ?? null,
    live_mode: requestData?.live_mode ?? null,
    offers_found: normalized.length,
    cheapest_offers: normalized.slice(0, 5),
    note:
      "Duffel test-mode schedules and prices may be synthetic. This endpoint validates integration and response structure only.",
  });
}
