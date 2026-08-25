"use client";

import { useEffect, useRef, useState } from "react";
import styles from "./OriginPicker.module.css";

export type Origin = {
  origin_id: string;
  geonames_id: string;
  name: string;
  display_name: string;
  country_code: string;
  latitude: number;
  longitude: number;
  timezone: string;
  distance_km?: number;
};

type Props = { value: Origin | null; onChange: (origin: Origin | null) => void };

export default function OriginPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(!value);
  const [query, setQuery] = useState("");
  const [options, setOptions] = useState<Origin[]>([]);
  const [searching, setSearching] = useState(false);
  const [locating, setLocating] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const requestId = useRef(0);

  useEffect(() => {
    const term = query.trim();
    if (term.length < 2) { setOptions([]); setSearching(false); return; }
    const id = ++requestId.current;
    setSearching(true);
    const timer = window.setTimeout(async () => {
      try {
        const response = await fetch(`/api/origin/search?q=${encodeURIComponent(term)}`);
        const payload = await response.json();
        if (id === requestId.current) setOptions(response.ok ? payload.results ?? [] : []);
      } catch { if (id === requestId.current) setOptions([]); }
      finally { if (id === requestId.current) setSearching(false); }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  function choose(origin: Origin) {
    onChange(origin); setQuery(""); setOptions([]); setMessage(null); setOpen(false);
  }

  function useCurrentLocation() {
    setMessage(null);
    if (!navigator.geolocation) { setMessage("Location isn't available in this browser. Search for your city instead."); return; }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(async (position) => {
      try {
        const response = await fetch("/api/origin/locate", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ latitude: position.coords.latitude, longitude: position.coords.longitude }),
        });
        const payload = await response.json();
        const nearest = payload.results?.[0];
        if (!response.ok || !nearest) throw new Error();
        choose(nearest);
      } catch { setMessage("We couldn't match your location to a nearby city. Search for your city instead."); }
      finally { setLocating(false); }
    }, () => {
      setLocating(false);
      setMessage("Location wasn't shared. You can search for your city instead.");
    }, { enableHighAccuracy: false, timeout: 8000, maximumAge: 300000 });
  }

  if (value && !open) {
    return (
      <section className={styles.compact} aria-label="Trip origin">
        <div><span className={styles.pin}>⌖</span><span><small>Travelling from</small><strong>{value.display_name}</strong></span></div>
        <button type="button" onClick={() => setOpen(true)}>Change</button>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-label="Choose where you are travelling from">
      <div className={styles.copy}>
        <span className={styles.kicker}>YOUR TRIP</span>
        <h2>Where are you travelling from?</h2>
        <p>This will help us make your destination choices practical later. It won&apos;t change your preference ranking yet.</p>
      </div>
      <div className={styles.actions}>
        <div className={styles.searchWrap}>
          <span className={styles.searchIcon}>⌕</span>
          <input autoComplete="off" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search city or town…" aria-label="Search origin city" />
          {searching && <span className={styles.searching}>Searching…</span>}
          {options.length > 0 && (
            <div className={styles.dropdown} role="listbox">
              {options.map((option) => (
                <button type="button" key={option.origin_id} onClick={() => choose(option)}>
                  <span className={styles.optionPin}>⌖</span><span><strong>{option.name}</strong><small>{option.country_code}</small></span>
                </button>
              ))}
            </div>
          )}
        </div>
        <div className={styles.altActions}>
          <button type="button" className={styles.locationButton} onClick={useCurrentLocation} disabled={locating}>
            <span>◎</span>{locating ? "Finding your location…" : "Use my current location"}
          </button>
          <button type="button" className={styles.skipButton} onClick={() => { setOpen(false); setMessage(null); }}>Skip for now</button>
        </div>
        {message && <p className={styles.message}>{message}</p>}
      </div>
    </section>
  );
}
