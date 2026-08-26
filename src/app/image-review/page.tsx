"use client";

import { useEffect, useMemo, useState } from "react";

type Destination = {
  id: string;
  name: string;
  destination_type: string | null;
  country_code: string | null;
};

type ImageResult = {
  destination: string;
  status: string;
  candidates_found?: number;
  eligible_found?: number;
  selected_images: Array<{
    rank: number;
    title: string;
    score: number;
    thumbnail_url: string;
    commons_page: string | null;
    creator: string | null;
    license: string | null;
    license_url: string | null;
    description: string | null;
  }>;
  error?: string;
};

type Review = "GOOD" | "MIXED" | "BAD" | "";

export default function ImageReviewPage() {
  const [destinations, setDestinations] = useState<Destination[]>([]);
  const [results, setResults] = useState<Record<string, ImageResult>>({});
  const [reviews, setReviews] = useState<Record<string, Review>>({});
  const [loadingSample, setLoadingSample] = useState(true);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState("");
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    (async () => {
      try {
        const r = await fetch("/api/image-review-sample", { cache: "no-store" });
        const data = await r.json();
        if (!r.ok || !data.ok) throw new Error(data.error || "Could not load sample.");
        setDestinations(data.destinations || []);
      } catch (e) {
        setError(e instanceof Error ? e.message : "Could not load sample.");
      } finally {
        setLoadingSample(false);
      }
    })();
  }, []);

  async function runTest() {
    setRunning(true);
    setError("");
    setProgress(0);
    setResults({});

    try {
      // Existing diagnostic accepts max 20. Five sequential batches are intentional.
      const batches: Destination[][] = [];
      for (let i = 0; i < destinations.length; i += 20) {
        batches.push(destinations.slice(i, i + 20));
      }

      const merged: Record<string, ImageResult> = {};

      for (let i = 0; i < batches.length; i++) {
        const names = batches[i].map(d => d.name).join("|");
        const r = await fetch(
          `/api/image-batch-test?destinations=${encodeURIComponent(names)}`,
          { cache: "no-store" }
        );
        const data = await r.json();
        if (!r.ok || !data.ok) {
          throw new Error(data.error || `Batch ${i + 1} failed.`);
        }

        for (const item of data.results || []) {
          merged[item.destination] = item;
        }
        setResults({ ...merged });
        setProgress(Math.min(destinations.length, (i + 1) * 20));
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Image test failed.");
    } finally {
      setRunning(false);
    }
  }

  const stats = useMemo(() => {
    const values = Object.values(results);
    const statusCounts = values.reduce((a: Record<string, number>, r) => {
      a[r.status] = (a[r.status] || 0) + 1;
      return a;
    }, {});
    const reviewCounts = Object.values(reviews).reduce((a: Record<string, number>, r) => {
      if (r) a[r] = (a[r] || 0) + 1;
      return a;
    }, {});
    return { statusCounts, reviewCounts };
  }, [results, reviews]);

  function setReview(name: string, value: Review) {
    setReviews(prev => ({ ...prev, [name]: value }));
  }

  if (loadingSample) {
    return <main style={styles.main}><h1>TravelGinni Image Review</h1><p>Loading 100-destination sample…</p></main>;
  }

  return (
    <main style={styles.main}>
      <div style={styles.header}>
        <div>
          <div style={styles.eyebrow}>PEXELS VALIDATION · NO IMAGEKIT UPLOADS</div>
          <h1 style={styles.h1}>100-Destination Image Review</h1>
          <p style={styles.sub}>
            Three Pexels candidates per real TravelGinni destination.
            Review whether the set represents the destination well.
          </p>
        </div>
        <button
          onClick={runTest}
          disabled={running || destinations.length === 0}
          style={styles.runButton}
        >
          {running ? `Testing ${progress}/${destinations.length}…` : "Run 100-image test"}
        </button>
      </div>

      {error && <div style={styles.error}>{error}</div>}

      <div style={styles.stats}>
        <strong>Sample: {destinations.length}</strong>
        <span>Processed: {Object.keys(results).length}</span>
        <span>GOOD_3: {stats.statusCounts.GOOD_3 || 0}</span>
        <span>Partial: {stats.statusCounts.PARTIAL || 0}</span>
        <span>Your Good: {stats.reviewCounts.GOOD || 0}</span>
        <span>Your Mixed: {stats.reviewCounts.MIXED || 0}</span>
        <span>Your Bad: {stats.reviewCounts.BAD || 0}</span>
      </div>

      <div style={styles.grid}>
        {destinations.map((d, index) => {
          const result = results[d.name];
          const review = reviews[d.name] || "";
          return (
            <article key={d.id} style={styles.card}>
              <div style={styles.cardHead}>
                <div>
                  <div style={styles.number}>#{String(index + 1).padStart(3, "0")}</div>
                  <h2 style={styles.name}>{d.name}</h2>
                  <div style={styles.meta}>
                    {d.destination_type || "unknown"}
                    {d.country_code ? ` · ${d.country_code}` : ""}
                  </div>
                </div>
                <div style={{
                  ...styles.status,
                  opacity: result ? 1 : 0.45
                }}>
                  {result?.status || "WAITING"}
                </div>
              </div>

              <div style={styles.images}>
                {[0, 1, 2].map(i => {
                  const image = result?.selected_images?.[i];
                  return (
                    <div key={i} style={styles.imageCell}>
                      {image ? (
                        <a href={image.commons_page || image.thumbnail_url} target="_blank" rel="noreferrer">
                          <img
                            src={image.thumbnail_url}
                            alt={`${d.name} candidate ${i + 1}`}
                            style={styles.img}
                          />
                        </a>
                      ) : (
                        <div style={styles.placeholder}>{result ? "No image" : "—"}</div>
                      )}
                      {image && (
                        <div style={styles.imageInfo}>
                          #{i + 1} · {image.creator || "Pexels photographer"} · {image.license || "Pexels"}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>

              {result?.error && <div style={styles.smallError}>{result.error}</div>}

              <div style={styles.reviewRow}>
                <span style={styles.reviewLabel}>Does this 3-image set represent {d.name}?</span>
                {(["GOOD", "MIXED", "BAD"] as Review[]).map(value => (
                  <button
                    key={value}
                    onClick={() => setReview(d.name, review === value ? "" : value)}
                    style={{
                      ...styles.reviewButton,
                      fontWeight: review === value ? 800 : 500,
                      borderWidth: review === value ? 2 : 1,
                    }}
                  >
                    {value === "GOOD" ? "✓ Good" : value === "MIXED" ? "~ Mixed" : "✕ Bad"}
                  </button>
                ))}
              </div>
            </article>
          );
        })}
      </div>
    </main>
  );
}

const styles: Record<string, React.CSSProperties> = {
  main: {
    maxWidth: 1500, margin: "0 auto", padding: "40px 24px 80px",
    fontFamily: "Arial, sans-serif", color: "#171717", background: "#fafafa",
    minHeight: "100vh"
  },
  header: {
    display: "flex", justifyContent: "space-between", alignItems: "flex-end",
    gap: 24, marginBottom: 24
  },
  eyebrow: { fontSize: 12, fontWeight: 800, letterSpacing: 1.2, marginBottom: 8 },
  h1: { margin: 0, fontSize: 36, lineHeight: 1.05 },
  sub: { maxWidth: 720, margin: "10px 0 0", color: "#666", lineHeight: 1.5 },
  runButton: {
    padding: "13px 18px", borderRadius: 10, border: "1px solid #222",
    background: "#111", color: "white", fontWeight: 700, cursor: "pointer",
    whiteSpace: "nowrap"
  },
  error: {
    padding: 14, border: "1px solid #bbb", borderRadius: 10,
    background: "white", marginBottom: 18
  },
  stats: {
    display: "flex", flexWrap: "wrap", gap: 18, padding: "14px 16px",
    background: "white", border: "1px solid #e3e3e3", borderRadius: 12,
    marginBottom: 22, fontSize: 14
  },
  grid: { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(460px, 1fr))", gap: 18 },
  card: { background: "white", border: "1px solid #e3e3e3", borderRadius: 14, overflow: "hidden" },
  cardHead: {
    display: "flex", justifyContent: "space-between", alignItems: "flex-start",
    padding: "16px 16px 12px"
  },
  number: { fontSize: 11, color: "#888", fontWeight: 700 },
  name: { margin: "3px 0 3px", fontSize: 21 },
  meta: { fontSize: 12, color: "#777" },
  status: {
    fontSize: 11, fontWeight: 800, border: "1px solid #ddd",
    padding: "5px 7px", borderRadius: 999
  },
  images: { display: "grid", gridTemplateColumns: "2fr 1fr 1fr", gap: 3, height: 220, background: "#eee" },
  imageCell: { minWidth: 0, overflow: "hidden", position: "relative", background: "#eee" },
  img: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  placeholder: { height: "100%", display: "grid", placeItems: "center", color: "#999" },
  imageInfo: {
    position: "absolute", left: 6, bottom: 6, right: 6, padding: "4px 6px",
    background: "rgba(255,255,255,.88)", fontSize: 9, borderRadius: 5,
    overflow: "hidden", whiteSpace: "nowrap", textOverflow: "ellipsis"
  },
  reviewRow: {
    display: "flex", alignItems: "center", flexWrap: "wrap",
    gap: 8, padding: 12
  },
  reviewLabel: { fontSize: 12, color: "#555", marginRight: "auto" },
  reviewButton: {
    padding: "6px 9px", borderRadius: 8, borderStyle: "solid",
    borderColor: "#aaa", background: "white", cursor: "pointer", fontSize: 11
  },
  smallError: { padding: "8px 12px", fontSize: 11, color: "#555" }
};
