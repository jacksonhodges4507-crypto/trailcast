import type { ActivityId } from "../types";

/**
 * What a visitor can report, and the rule for when it shows.
 *
 * Reports are a fixed menu rather than free text, for two reasons: a menu
 * can be counted ("three people said muddy"), and it cannot carry abuse.
 * An optional short note rides along, but it is only ever displayed next to
 * a report that has been confirmed.
 *
 * Plain data, safe to import in the browser.
 */

export type Tone = "good" | "warn" | "bad";

export interface ReportKind {
  id: string;
  label: string;
  glyph: string;
  tone: Tone;
  activities: ActivityId[] | "all";
}

export const REPORT_KINDS: ReportKind[] = [
  // Ground and rock
  { id: "dry", label: "Dry trail", glyph: "☀️", tone: "good", activities: ["hike", "trail_run", "mtb"] },
  { id: "muddy", label: "Muddy", glyph: "\u{1F7E4}", tone: "warn", activities: ["hike", "trail_run", "mtb"] },
  { id: "snow", label: "Snow on trail", glyph: "❄️", tone: "warn", activities: ["hike", "trail_run", "mtb", "climb"] },
  { id: "icy", label: "Icy", glyph: "\u{1F9CA}", tone: "bad", activities: ["hike", "trail_run", "mtb", "climb"] },
  { id: "downed-trees", label: "Downed trees", glyph: "\u{1FAB5}", tone: "warn", activities: ["hike", "trail_run", "mtb"] },
  { id: "dry-rock", label: "Rock is dry", glyph: "\u{1FAA8}", tone: "good", activities: ["climb"] },
  { id: "wet-rock", label: "Rock still wet", glyph: "\u{1F4A7}", tone: "bad", activities: ["climb"] },
  { id: "seeping", label: "Seeping", glyph: "\u{1F4A6}", tone: "warn", activities: ["climb"] },
  // Water
  { id: "good-bite", label: "Fish biting", glyph: "\u{1F3A3}", tone: "good", activities: ["fish"] },
  { id: "slow-bite", label: "Slow bite", glyph: "\u{1F634}", tone: "warn", activities: ["fish"] },
  { id: "hatch", label: "Bugs hatching", glyph: "\u{1FAB0}", tone: "good", activities: ["fish"] },
  { id: "clear-water", label: "Clear water", glyph: "\u{1F48E}", tone: "good", activities: ["fish"] },
  { id: "off-color", label: "Off-color water", glyph: "\u{1F7EB}", tone: "warn", activities: ["fish"] },
  { id: "high-water", label: "High water", glyph: "\u{1F30A}", tone: "bad", activities: ["fish", "hike"] },
  // Anywhere
  { id: "crowded", label: "Crowded", glyph: "\u{1F465}", tone: "warn", activities: "all" },
  { id: "smoky", label: "Smoky", glyph: "\u{1F32B}️", tone: "bad", activities: "all" },
  { id: "bugs", label: "Bad mosquitoes", glyph: "\u{1F99F}", tone: "warn", activities: "all" },
  { id: "wildlife", label: "Moose or bear seen", glyph: "\u{1FACE}", tone: "warn", activities: "all" },
  { id: "closed", label: "Closed / gate locked", glyph: "⛔", tone: "bad", activities: "all" },
];

export const KIND_BY_ID: Record<string, ReportKind> = Object.fromEntries(
  REPORT_KINDS.map((kind) => [kind.id, kind]),
);

export function kindsFor(activity: ActivityId): ReportKind[] {
  return REPORT_KINDS.filter((k) => k.activities === "all" || k.activities.includes(activity));
}

/** Reports older than this describe a different day. */
export const REPORT_WINDOW_HOURS = 48;

/** How many different people must agree before a report is shown. */
export const CONFIRMATIONS_NEEDED = 2;

export const NOTE_MAX = 140;

export interface StoredReport {
  kind: string;
  /** Optional, already sanitised. */
  note?: string;
  /** ISO timestamp. */
  at: string;
  /** Salted hash identifying the reporter. Never the raw address. */
  who: string;
}

export interface ConfirmedReport {
  kind: string;
  label: string;
  glyph: string;
  tone: Tone;
  /** Distinct people, not submissions. */
  reporters: number;
  latest: string;
  notes: string[];
}

export interface ReportSummary {
  confirmed: ConfirmedReport[];
  /** Reports inside the window that nobody has seconded yet. */
  awaiting: number;
}

/**
 * Collapse raw reports into what may be shown.
 *
 * A kind is confirmed when CONFIRMATIONS_NEEDED *different* people reported
 * it inside the window. Counting distinct reporters rather than submissions
 * is the point: one person pressing "closed" five times is one voice, and
 * must not be able to confirm their own report.
 */
export function summarize(reports: StoredReport[], now: Date = new Date()): ReportSummary {
  const cutoff = now.getTime() - REPORT_WINDOW_HOURS * 3_600_000;
  const byKind = new Map<string, { who: Set<string>; latest: string; notes: string[] }>();

  for (const report of reports) {
    const at = Date.parse(report.at);
    if (!Number.isFinite(at) || at < cutoff || at > now.getTime() + 60_000) continue;
    if (!KIND_BY_ID[report.kind]) continue;

    const entry = byKind.get(report.kind) ?? { who: new Set<string>(), latest: report.at, notes: [] };
    entry.who.add(report.who);
    if (report.at > entry.latest) entry.latest = report.at;
    if (report.note && entry.notes.length < 3 && !entry.notes.includes(report.note)) {
      entry.notes.push(report.note);
    }
    byKind.set(report.kind, entry);
  }

  const confirmed: ConfirmedReport[] = [];
  let awaiting = 0;

  for (const [kindId, entry] of byKind) {
    const kind = KIND_BY_ID[kindId];
    if (!kind) continue;
    if (entry.who.size >= CONFIRMATIONS_NEEDED) {
      confirmed.push({
        kind: kind.id,
        label: kind.label,
        glyph: kind.glyph,
        tone: kind.tone,
        reporters: entry.who.size,
        latest: entry.latest,
        notes: entry.notes,
      });
    } else {
      awaiting += entry.who.size;
    }
  }

  // Bad news first, then by how many people agree.
  const toneRank: Record<Tone, number> = { bad: 0, warn: 1, good: 2 };
  confirmed.sort((a, b) => toneRank[a.tone] - toneRank[b.tone] || b.reporters - a.reporters);

  return { confirmed, awaiting };
}

/**
 * Clean a note before it is stored: trim, cap the length, drop control
 * characters, and strip links so the field cannot be used to advertise.
 */
export function sanitizeNote(raw: unknown): string | undefined {
  if (typeof raw !== "string") return undefined;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ")
    .replace(/\bhttps?:\/\/\S+/gi, "")
    .replace(/\bwww\.\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, NOTE_MAX);
  return cleaned.length > 0 ? cleaned : undefined;
}

/** "3 h ago" / "yesterday" for a report timestamp. */
export function reportAge(iso: string, now: Date = new Date()): string {
  const hours = (now.getTime() - Date.parse(iso)) / 3_600_000;
  if (!Number.isFinite(hours)) return "";
  if (hours < 1) return "within the hour";
  if (hours < 24) return `${Math.round(hours)} h ago`;
  return "yesterday";
}
