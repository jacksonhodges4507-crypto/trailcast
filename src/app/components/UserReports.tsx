"use client";

import { useCallback, useEffect, useState } from "react";
import {
  CONFIRMATIONS_NEEDED,
  NOTE_MAX,
  REPORT_WINDOW_HOURS,
  kindsFor,
  reportAge,
  type ReportSummary,
} from "@/lib/reports/kinds";
import type { ActivityId } from "@/lib/types";

export interface UserReportsProps {
  trailId: string;
  activity: ActivityId;
}

interface Payload {
  storage: "redis" | "memory";
  summary: ReportSummary;
  confirmedNow?: boolean;
}

/**
 * Visitor reports: the "User reported" section, and the form to add one.
 *
 * Reports sit beside the model's verdict and never change it. They appear
 * only once two different people have reported the same thing in the last
 * two days, so a single mistaken -- or malicious -- report stays invisible
 * until someone else independently sees the same thing.
 */
export default function UserReports({ trailId, activity }: UserReportsProps) {
  const [data, setData] = useState<Payload | null>(null);
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/reports?trailId=${encodeURIComponent(trailId)}`);
      if (response.ok) setData((await response.json()) as Payload);
    } catch {
      // Reports are supplementary; the panel works without them.
    }
  }, [trailId]);

  useEffect(() => {
    setData(null);
    setOpen(false);
    setKind(null);
    setNote("");
    setMessage(null);
    void load();
  }, [load]);

  async function submit() {
    if (!kind || busy) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch("/api/reports", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ trailId, kind, note: note.trim() || undefined }),
      });
      const body = (await response.json().catch(() => ({}))) as Partial<Payload> & { error?: string };
      if (!response.ok || !body.summary) {
        setMessage(body.error ?? "Could not send that report.");
        return;
      }
      setData({ storage: body.storage ?? "memory", summary: body.summary });
      setMessage(
        body.confirmedNow
          ? "Thanks — that confirmed someone else's report, so it now shows for everyone."
          : body.summary.confirmed.some((c) => c.kind === kind)
            ? "Thanks — added to what others are already reporting."
            : `Thanks — it will show once ${CONFIRMATIONS_NEEDED - 1} more person reports the same thing.`,
      );
      setOpen(false);
      setKind(null);
      setNote("");
    } catch {
      setMessage("Could not send that report.");
    } finally {
      setBusy(false);
    }
  }

  const confirmed = data?.summary.confirmed ?? [];

  return (
    <div className="reports">
      <h3>User reported</h3>

      {confirmed.length > 0 ? (
        <ul className="report-list">
          {confirmed.map((c) => (
            <li key={c.kind} className={`report-${c.tone}`}>
              <span aria-hidden>{c.glyph}</span>
              <div>
                <strong>{c.label}</strong>
                <span className="report-meta">
                  {c.reporters} people · latest {reportAge(c.latest)}
                </span>
                {c.notes.map((n) => (
                  <q key={n}>{n}</q>
                ))}
              </div>
            </li>
          ))}
        </ul>
      ) : (
        <p className="report-empty">
          Nothing confirmed in the last {REPORT_WINDOW_HOURS} h.
          {data && data.summary.awaiting > 0
            ? ` ${data.summary.awaiting} report${data.summary.awaiting === 1 ? " is" : "s are"} waiting for a second person.`
            : ""}
        </p>
      )}

      {message ? <p className="report-message">{message}</p> : null}

      {open ? (
        <div className="report-form">
          <div className="report-kinds">
            {kindsFor(activity).map((k) => (
              <button
                key={k.id}
                type="button"
                aria-pressed={kind === k.id}
                onClick={() => setKind(k.id)}
              >
                <span aria-hidden>{k.glyph}</span> {k.label}
              </button>
            ))}
          </div>
          <textarea
            value={note}
            onChange={(event) => setNote(event.target.value.slice(0, NOTE_MAX))}
            placeholder="Optional detail, e.g. 'mud only on the first mile'"
            rows={2}
            maxLength={NOTE_MAX}
            aria-label="Optional note"
          />
          <div className="report-actions">
            <span>{note.length}/{NOTE_MAX}</span>
            <button type="button" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button type="button" className="primary" disabled={!kind || busy} onClick={() => void submit()}>
              {busy ? "Sending…" : "Send report"}
            </button>
          </div>
        </div>
      ) : (
        <button type="button" className="report-open" onClick={() => setOpen(true)}>
          <span aria-hidden>{"✋"}</span> Report conditions
        </button>
      )}

      {data?.storage === "memory" ? (
        <p className="report-note">
          Reports on this deployment are temporary until a database is connected.
        </p>
      ) : null}
    </div>
  );
}
