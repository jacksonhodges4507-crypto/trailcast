"use client";

import { useEffect, useRef, useState } from "react";
import type { AskAnswer } from "@/lib/types";

const SUGGESTIONS = [
  "where should I hike saturday near salt lake?",
  "somewhere to ride tomorrow under 10 miles",
  "shady trail run in provo this weekend",
  "climbing conditions friday",
];

export interface AskBarProps {
  onAnswer: (answer: AskAnswer) => void;
  /** The viewer's coarsened location, when they have chosen to share it. */
  coords?: { lat: number; lon: number } | null;
}

export default function AskBar({ onAnswer, coords }: AskBarProps) {
  const [question, setQuestion] = useState("");
  const boxRef = useRef<HTMLTextAreaElement | null>(null);

  // Grow with the text, up to about six lines, then scroll. A one-line input
  // hid everything past the first forty characters, which made editing a
  // longer question a matter of arrowing blind.
  useEffect(() => {
    const box = boxRef.current;
    if (!box) return;
    box.style.height = "auto";
    box.style.height = `${Math.min(box.scrollHeight, 150)}px`;
  }, [question]);
  const [answer, setAnswer] = useState<AskAnswer | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(text: string) {
    const trimmed = text.trim();
    if (trimmed.length === 0 || busy) return;

    setBusy(true);
    setError(null);

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
      setAnswer(data);
      onAnswer(data);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="ask">
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
          rows={3}
          placeholder="Ask anything — e.g. somewhere shady and easy to hike saturday near Provo"
          aria-label="Ask about conditions"
          maxLength={400}
        />
        <button type="submit" disabled={busy || question.trim().length === 0}>
          {busy ? "…" : "Ask"}
        </button>
      </form>

      <div className="ask-suggestions">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => {
              setQuestion(suggestion);
              void submit(suggestion);
            }}
          >
            {suggestion}
          </button>
        ))}
      </div>

      {error ? (
        <div className="answer" style={{ borderLeftColor: "var(--grade-unsafe)" }}>
          <p>{error}</p>
        </div>
      ) : null}

      {answer && !error ? (
        <div className="answer">
          <p>{answer.narrative}</p>
          <p className="meta">
            read as: {answer.query.interpretation} · parsed by {answer.query.parsedBy} ·
            narrated by {answer.narratedBy}
          </p>
        </div>
      ) : null}
    </div>
  );
}
