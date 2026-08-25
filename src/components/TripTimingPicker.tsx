"use client";

import { useMemo, useState } from "react";
import styles from "./TripTimingPicker.module.css";

export type TripTiming =
  | {
      mode: "exact";
      startDate: string;
      endDate: string;
      nights: number;
    }
  | {
      mode: "flexible";
      month: string;
      minNights: number;
      maxNights: number;
      durationLabel: string;
    };

type Props = {
  value: TripTiming | null;
  onChange: (timing: TripTiming | null) => void;
};

const DURATION_OPTIONS = [
  { label: "Weekend", minNights: 2, maxNights: 3 },
  { label: "Short trip", minNights: 3, maxNights: 5 },
  { label: "About a week", minNights: 6, maxNights: 8 },
  { label: "Longer trip", minNights: 10, maxNights: 14 },
];

function parseLocalDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

function calculateNights(start: string, end: string) {
  if (!start || !end) return 0;
  const startDate = parseLocalDate(start);
  const endDate = parseLocalDate(end);
  return Math.round(
    (endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24)
  );
}

function formatDate(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("en", {
    day: "numeric",
    month: "short",
  }).format(parseLocalDate(value));
}

function formatMonth(value: string) {
  if (!value) return "";
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("en", {
    month: "long",
    year: "numeric",
  }).format(new Date(year, month - 1, 1));
}

function currentMonthValue() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
}

export default function TripTimingPicker({ value, onChange }: Props) {
  const [open, setOpen] = useState(!value);
  const [mode, setMode] = useState<"exact" | "flexible">(
    value?.mode ?? "exact"
  );
  const [startDate, setStartDate] = useState(
    value?.mode === "exact" ? value.startDate : ""
  );
  const [endDate, setEndDate] = useState(
    value?.mode === "exact" ? value.endDate : ""
  );
  const [month, setMonth] = useState(
    value?.mode === "flexible" ? value.month : ""
  );
  const [duration, setDuration] = useState<
    (typeof DURATION_OPTIONS)[number] | null
  >(
    value?.mode === "flexible"
      ? DURATION_OPTIONS.find(
          (option) =>
            option.minNights === value.minNights &&
            option.maxNights === value.maxNights
        ) ?? null
      : null
  );
  const [message, setMessage] = useState<string | null>(null);

  const nights = useMemo(
    () => calculateNights(startDate, endDate),
    [startDate, endDate]
  );

  const today = useMemo(() => {
    const now = new Date();
    return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
      2,
      "0"
    )}-${String(now.getDate()).padStart(2, "0")}`;
  }, []);

  function saveExact() {
    setMessage(null);

    if (!startDate || !endDate) {
      setMessage("Choose both your departure and return dates.");
      return;
    }

    if (nights < 1) {
      setMessage("Your return date needs to be after your departure date.");
      return;
    }

    onChange({
      mode: "exact",
      startDate,
      endDate,
      nights,
    });
    setOpen(false);
  }

  function saveFlexible() {
    setMessage(null);

    if (!month) {
      setMessage("Choose the month you are thinking about.");
      return;
    }

    if (!duration) {
      setMessage("Choose roughly how long you want to travel.");
      return;
    }

    onChange({
      mode: "flexible",
      month,
      minNights: duration.minNights,
      maxNights: duration.maxNights,
      durationLabel: duration.label,
    });
    setOpen(false);
  }

  function clearAndOpen() {
    onChange(null);
    setStartDate("");
    setEndDate("");
    setMonth("");
    setDuration(null);
    setMessage(null);
    setOpen(true);
  }

  if (!open && value) {
    const summary =
      value.mode === "exact"
        ? `${formatDate(value.startDate)} – ${formatDate(value.endDate)} · ${
            value.nights
          } ${value.nights === 1 ? "night" : "nights"}`
        : `${formatMonth(value.month)} · ${value.durationLabel}`;

    return (
      <section className={styles.compact} aria-label="Trip timing">
        <div>
          <span className={styles.icon}>◷</span>
          <span>
            <small>When</small>
            <strong>{summary}</strong>
          </span>
        </div>
        <button type="button" onClick={() => setOpen(true)}>
          Change
        </button>
      </section>
    );
  }

  if (!open && !value) {
    return (
      <section className={styles.compact} aria-label="Trip timing">
        <div>
          <span className={styles.icon}>◷</span>
          <span>
            <small>When</small>
            <strong>Flexible for now</strong>
          </span>
        </div>
        <button type="button" onClick={() => setOpen(true)}>
          Add timing
        </button>
      </section>
    );
  }

  return (
    <section className={styles.panel} aria-label="Choose when you want to travel">
      <div className={styles.copy}>
        <span className={styles.kicker}>YOUR TRIP</span>
        <h2>When are you thinking?</h2>
        <p>
          Exact dates are great if you know them. If not, a month and rough trip
          length is enough for TravelGinni to work with later.
        </p>
      </div>

      <div className={styles.actions}>
        <div className={styles.segmented} aria-label="Timing flexibility">
          <button
            type="button"
            className={mode === "exact" ? styles.segmentActive : ""}
            onClick={() => {
              setMode("exact");
              setMessage(null);
            }}
          >
            Exact dates
          </button>
          <button
            type="button"
            className={mode === "flexible" ? styles.segmentActive : ""}
            onClick={() => {
              setMode("flexible");
              setMessage(null);
            }}
          >
            I&apos;m flexible
          </button>
        </div>

        {mode === "exact" ? (
          <>
            <div className={styles.dateGrid}>
              <label>
                <span>Leave</span>
                <input
                  type="date"
                  min={today}
                  value={startDate}
                  onChange={(event) => {
                    setStartDate(event.target.value);
                    if (
                      endDate &&
                      calculateNights(event.target.value, endDate) < 1
                    ) {
                      setEndDate("");
                    }
                  }}
                />
              </label>

              <label>
                <span>Return</span>
                <input
                  type="date"
                  min={startDate || today}
                  value={endDate}
                  onChange={(event) => setEndDate(event.target.value)}
                />
              </label>
            </div>

            <div className={styles.footerRow}>
              <div className={styles.durationSummary}>
                {nights > 0 ? (
                  <>
                    <strong>
                      {nights} {nights === 1 ? "night" : "nights"}
                    </strong>
                    <span>calculated automatically</span>
                  </>
                ) : (
                  <span>Choose your dates and we&apos;ll calculate the trip length.</span>
                )}
              </div>

              <button
                type="button"
                className={styles.saveButton}
                onClick={saveExact}
              >
                Use these dates
              </button>
            </div>
          </>
        ) : (
          <>
            <label className={styles.monthField}>
              <span>Which month?</span>
              <input
                type="month"
                min={currentMonthValue()}
                value={month}
                onChange={(event) => setMonth(event.target.value)}
              />
            </label>

            <div className={styles.durationBlock}>
              <span className={styles.fieldLabel}>How long?</span>
              <div className={styles.durationGrid}>
                {DURATION_OPTIONS.map((option) => {
                  const selected =
                    duration?.minNights === option.minNights &&
                    duration?.maxNights === option.maxNights;

                  return (
                    <button
                      type="button"
                      key={option.label}
                      className={selected ? styles.durationSelected : ""}
                      onClick={() => setDuration(option)}
                    >
                      <strong>{option.label}</strong>
                      <small>
                        {option.minNights}–{option.maxNights} nights
                      </small>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className={styles.footerRow}>
              <div className={styles.durationSummary}>
                {month && duration ? (
                  <>
                    <strong>{formatMonth(month)}</strong>
                    <span>
                      {duration.label} · {duration.minNights}–
                      {duration.maxNights} nights
                    </span>
                  </>
                ) : (
                  <span>
                    A rough month and duration is enough. You can refine it later.
                  </span>
                )}
              </div>

              <button
                type="button"
                className={styles.saveButton}
                onClick={saveFlexible}
              >
                Use this timing
              </button>
            </div>
          </>
        )}

        <div className={styles.lowerActions}>
          <button
            type="button"
            className={styles.skipButton}
            onClick={() => {
              onChange(null);
              setMessage(null);
              setOpen(false);
            }}
          >
            Not sure yet
          </button>

          {value && (
            <button
              type="button"
              className={styles.clearButton}
              onClick={clearAndOpen}
            >
              Clear timing
            </button>
          )}
        </div>

        {message && <p className={styles.message}>{message}</p>}
      </div>
    </section>
  );
}
