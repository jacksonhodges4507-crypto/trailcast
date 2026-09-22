"use client";

import { useEffect, useRef, useState } from "react";
import type { AskAnswer } from "@/lib/types";
import { formatDrive } from "@/lib/format";
import { GRADE_COLOR } from "./grade";

/*
 * Search history replaces the canned suggestions. It lives only in this
 * browser (localStorage), never on the server, and every read and write is
 * guarded because storage can be unavailable in private windows.
 */
const HISTORY_KEY = "trailcast.askHistory.v1";
const HISTORY_MAX = 8;

/** Shown until someone has asked anything, so the space is never blank. */
const STARTERS = [
  "Best fishing this weekend?",
  "Easy hike near Salt Lake on Saturday",
  "Where should I climb tomorrow? Dry rock, under an hour away",
];

function readHistory(): string[] {
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed)
      ? parsed.filter((x): x is string => typeof x === "string").slice(0, HISTORY_MAX)
      : [];
  } catch {
    return [];
  }
}

function writeHistory(items: string[]): void {
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(items));
  } catch {
    // Storage blocked: history just won't persist.
  }
}

export interface AskBarProps {
  onAnswer: (answer: AskAnswer) => void;
  /** The viewer's coarsened location, when they have chosen to share it. */
  coords?: { lat: number; lon: number } | null;
  /** Phones: switch to the map tab to see the answer's places. */
  onShowMap?: () => void;
  /** Open one of the answer's places. */
  onPick?: (trailId: string) => void;
  /** A question asked from elsewhere ("Ask Scout about this trail"). */
  prefill?: { text: string; nonce: number } | null;
}

/**
 * Scout: TrailCast's assistant. Say what you want to do; Scout works out
 * where and when, and shows its top picks as cards you can open.
 */
export default function AskBar({ onAnswer, coords, onShowMap, onPick, prefill }: AskBarProps) {
  const [question, setQuestion] = useState("");
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  // Grow with the text, up to about six lines, then scroll.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 150)}px`;
  }, [question]);

  const [history, setHistory] = useState<string[]>([]);
  useEffect(() => {
    setHistory(readHistory());
  }, []);

  function remember(text: string) {
    setHistory((current) => {
      const next = [text, ...current.filter((q) => q.toLowerCase() !== text.toLowerCase())].slice(0, HISTORY_MAX);
      writeHistory(next);
      return next;
    });
  }

  function forget(text: string) {
    setHistory((current) => {
      const next = current.filter((q) => q !== text);
      writeHistory(next);
      return next;
    });
  }

  const [asked, setAsked] = useState<string | null>(null);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) return;

    setBusy(true);
    setError(null);
    setAsked(trimmed);

    try {
      const response = await fetch("/api/ask", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(
          coords ? { question: trimmed, lat: coords.lat, lon: coords.lon } : { question: trimmed },
        ),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Request failed (${response.status})`);
      }

      const data = (await response.json()) as AskAnswer;
      remember(trimmed);
      setAnswer(data);
      setQuestion("");
      onAnswer(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  // A question handed in from elsewhere is asked straight away.
  const lastPrefill = useRef<number | null>(null);
  useEffect(() => {
    if (!prefill || prefill.nonce === lastPrefill.current) return;
    lastPrefill.current = prefill.nonce;
    setQuestion(prefill.text);
    void submit(prefill.text);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [prefill]);

  const chips = history.length > 0 ? history : STARTERS;

  return (
    <div className="ask scout">
      <div className="scout-head">
        <span className="scout-badge" aria-hidden>
          ✦
        </span>
        <div>
          <h2>Scout</h2>
          <p>Tell me what you want to do. I&apos;ll find where and when.</p>
        </div>
      </div>

      {asked ? <div className="scout-bubble">{asked}</div> : null}

      {busy ? <div className="scout-thinking">Scout is checking conditions…</div> : null}

      {error ? (
        <div className="answer" style={{ borderLeftColor: "var(--grade-unsafe)" }}>
          <p>{error}</p>
        </div>
      ) : null}

      {answer && !error && !busy ? (
        <div className="answer">
          <p>{answer.narrative}</p>

          {answer.results.length > 0 ? (
            <ul className="scout-picks">
              {answer.results.slice(0, 3).map((r) => (
                <li key={r.trail.id}>
                  <button type="button" onClick={() => onPick?.(r.trail.id)}>
                    <span className="pick-score" style={{ background: GRADE_COLOR[r.verdict.grade] }}>
                      {r.verdict.score ?? "–"}
                    </span>
                    <span className="pick-body">
                      <strong>{r.trail.name}</strong>
                      <span>{r.verdict.headline}</span>
                    </span>
                    {r.travel ? <span className="pick-drive">{formatDrive(r.travel.minutes)}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}

          <p className="meta">
            Scout read this as: {answer.query.interpretation}
            {answer.narratedBy === "llm" ? " · written by the language model from these scores" : ""}
          </p>

          {onShowMap && answer.results.length > 0 ? (
            <button type="button" className="mobile-only map-link" onClick={onShowMap}>
              <span aria-hidden>🗺️</span> Open these on the map
            </button>
          ) : null}
        </div>
      ) : null}

      <form
        className="ask-row"
        onSubmit={(event) => {
          event.preventDefault();
          void submit(question);
        }}
      >
        <textarea
          ref={boxRef}
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          onKeyDown={(event) => {
            // Enter asks; Shift+Enter makes a new line.
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              void submit(question);
            }
          }}
          rows={2}
          placeholder="Ask Scout anything…"
          aria-label="Ask Scout"
          maxLength={400}
        />
        <button type="submit" disabled={busy || question.trim().length === 0} aria-label="Ask Scout">
          {busy ? "…" : "→"}
        </button>
      </form>

      <div className="ask-history">
        <div className="ask-history-label">{history.length > 0 ? "Recent" : "Try"}</div>
        <ul>
          {chips.map((item) => (
            <li key={item}>
              <button
                type="button"
                className="ask-history-item"
                title="Ask this again"
                onClick={() => {
                  setQuestion(item);
                  void submit(item);
                }}
              >
                <span aria-hidden>{history.length > 0 ? "↻" : "›"}</span>
                {item}
              </button>
              {history.length > 0 ? (
                <button
                  type="button"
                  className="ask-history-remove"
                  aria-label={`Remove "${item}" from history`}
                  onClick={() => forget(item)}
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
        {history.length > 1 ? (
          <button
            type="button"
            className="ask-history-clear"
            onClick={() => {
              setHistory([]);
              writeHistory([]);
            }}
          >
            Clear history
          </button>
        ) : null}
      </div>
    </div>
  );
}
