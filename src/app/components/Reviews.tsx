"use client";

import { useCallback, useEffect, useState } from "react";
import { NOTE_MAX } from "@/lib/reports/kinds";
import { VERDICTS, type ReviewSummary, type VerdictId } from "@/lib/reviews/kinds";

export interface ReviewsProps {
  trailId: string;
  trailName: string;
  activityLabel: string;
}

interface Payload {
  storage: "redis" | "memory";
  summary: ReviewSummary;
}

/**
 * Was it worth going?
 *
 * The forecast answers whether today is a good day to be outside. It cannot
 * answer whether this is a place you want to spend the day, and a reader
 * deciding between two 90-scoring trails is asking exactly that. So this
 * sits at the bottom, after the reasoning, and asks the one question the
 * data can't: would you go back?
 *
 * Deliberately unlike the condition reports above it: reviews don't expire,
 * one person counts once however often they press it, and nothing is shown
 * until a second person has been, so a single voice is never the record.
 */
export default function Reviews({ trailId, trailName, activityLabel }: ReviewsProps) {
  const [data, setData] = useState<Payload | null>(null);
  const [chosen, setChosen] = useState<VerdictId | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/reviews?trailId=${encodeURIComponent(trailId)}`);
      if (response.ok) setData((await response.json()) as Payload);
    } catch {
      // Reviews are supplementary; the report works without them.
    }
  }, [trailId]);

  useEffect(() => {
    setData(null);
    setChosen(null);
    setNote("");
    setMessage(null);
    void load();
  }, [load]);

  async function submit(verdict: VerdictId) {
    if (busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/reviews", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trailId, verdict, note: note.trim() || undefined }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<Payload> & { error?: string };
      if (!response.ok || !body.summary) {
        setMessage(body.error ?? "Could not save that.");
        return;
      }
      setData({ storage: body.storage ?? "memory", summary: body.summary });
      setChosen(verdict);
      setNote("");
      setMessage("Thanks — that's counted.");
    } catch {
      setMessage("Could not reach the server.");
    } finally {
      setBusy(false);
    }
  }

  const summary = data?.summary;
  const total = summary?.total ?? 0;

  return (
    <section className="reviews">
      <div className="reviews-head">
        <h3>Was it worth it?</h3>
        {summary?.headline ? <span className="reviews-headline">{summary.headline}</span> : null}
      </div>

      {total > 0 && summary ? (
        <div className="reviews-bars">
          {VERDICTS.map((verdict) => {
            const count = summary.counts[verdict.id];
            const pct = total > 0 ? Math.round((count / total) * 100) : 0;
            return (
              <div className={`reviews-bar tone-${verdict.id}`} key={verdict.id}>
                <span className="reviews-bar-label">
                  <span aria-hidden>{verdict.glyph}</span> {verdict.label}
                </span>
                <span className="reviews-track">
                  <span className="reviews-fill" style={{ width: `${pct}%` }} />
                </span>
                <span className="reviews-count">{count}</span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="reviews-empty">
          Nobody has reviewed {trailName} yet. If you&rsquo;ve been {activityLabel} here, you&rsquo;d
          be the first.
        </p>
      )}

      <div className="reviews-ask">
        {VERDICTS.map((verdict) => (
          <button
            key={verdict.id}
            type="button"
            className={chosen === verdict.id ? "reviews-btn chosen" : "reviews-btn"}
            disabled={busy}
            onClick={() => void submit(verdict.id)}
          >
            <span aria-hidden>{verdict.glyph}</span>
            {verdict.ask}
          </button>
        ))}
      </div>

      <label className="reviews-note">
        <span>Add a line for the next person (optional)</span>
        <input
          type="text"
          value={note}
          maxLength={NOTE_MAX}
          placeholder="Busy after 9, parking fills up…"
          onChange={(event) => setNote(event.target.value)}
        />
      </label>

      {message ? <p className="reviews-message">{message}</p> : null}

      {summary?.notes.length ? (
        <ul className="reviews-notes">
          {summary.notes.map((entry) => (
            <li key={`${entry.at}-${entry.note}`} className={`tone-${entry.verdict}`}>
              {entry.note}
            </li>
          ))}
        </ul>
      ) : null}

      <p className="reviews-foot">
        One vote per person, and nothing shows until two people have been. Reviews are about the
        place, not today&rsquo;s conditions — those are above.
        {data?.storage === "memory" ? " This deployment has no shared store, so these reset on redeploy." : ""}
      </p>
    </section>
  );
}
