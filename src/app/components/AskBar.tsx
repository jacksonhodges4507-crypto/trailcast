"use client";

import { useState } from "react";
import type { AskAnswer } from "@/lib/types";

const SUGGESTIONS = [
  "where should I hike saturday near salt lake?",
  "somewhere to ride tomorrow under 10 miles",
  "shady trail run in provo this weekend",
  "climbing conditions friday",
];

export interface AskBarProps {
  onAnswer: (answer: AskAnswer) => void;
}

export default function AskBar({ onAnswer }: AskBarProps) {
  const [question, setQuestion] = useState("");
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
        body: JSON.stringify({ question: trimmed }),
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
        <input
          value={question}
          onChange={(event) => setQuestion(event.target.value)}
          placeholder="Ask: where should I hike saturday?"
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
