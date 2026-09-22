import { createHash } from "node:crypto";
import { getTrail } from "../trails";
import { KIND_BY_ID, sanitizeNote, summarize, type ReportSummary } from "./kinds";
import { reportStore } from "./store";

/** Submissions allowed per person per hour, across all places. */
export const RATE_LIMIT_PER_HOUR = 8;

/**
 * Identify a reporter without keeping who they are.
 *
 * The address is salted and hashed, and only a prefix of the hash is kept.
 * That is enough to tell two people apart -- which the confirmation rule
 * needs -- and not enough to recover or look up the address.
 */
export function reporterId(address: string): string {
  const salt = process.env["REPORT_SALT"] ?? "trailcast-reports-v1";
  return createHash("sha256").update(`${salt}:${address}`).digest("hex").slice(0, 16);
}

/** The client address as Vercel reports it, first hop only. */
export function clientAddress(headers: Headers): string {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || headers.get("x-real-ip") || "unknown";
}

export async function readSummary(trailId: string): Promise<ReportSummary> {
  const reports = await reportStore().list(trailId);
  return summarize(reports);
}

/** Summaries for several places, tolerating a store outage per place. */
export async function readSummaries(trailIds: string[]): Promise<Map<string, ReportSummary>> {
  const out = new Map<string, ReportSummary>();
  await Promise.all(
    trailIds.map(async (id) => {
      try {
        out.set(id, await readSummary(id));
      } catch {
        // Reports are supplementary; a store failure never breaks an answer.
      }
    }),
  );
  return out;
}

export type SubmitResult =
  | { ok: true; summary: ReportSummary; confirmedNow: boolean }
  | { ok: false; status: number; error: string };

export async function submitReport(input: {
  trailId: unknown;
  kind: unknown;
  note: unknown;
  address: string;
}): Promise<SubmitResult> {
  if (typeof input.trailId !== "string" || !getTrail(input.trailId)) {
    return { ok: false, status: 400, error: "Unknown place." };
  }
  const trail = getTrail(input.trailId)!;

  const kind = typeof input.kind === "string" ? KIND_BY_ID[input.kind] : undefined;
  if (!kind) return { ok: false, status: 400, error: "Unknown report type." };
  if (kind.activities !== "all" && !kind.activities.some((a) => trail.activities.includes(a))) {
    return { ok: false, status: 400, error: "That report does not apply to this place." };
  }

  const who = reporterId(input.address);
  const store = reportStore();

  const count = await store.hit(`report:${who}`, 3600);
  if (count > RATE_LIMIT_PER_HOUR) {
    return { ok: false, status: 429, error: "That is a lot of reports in an hour — try again later." };
  }

  const before = summarize(await store.list(trail.id));
  const wasConfirmed = before.confirmed.some((c) => c.kind === kind.id);

  await store.append(trail.id, {
    kind: kind.id,
    note: sanitizeNote(input.note),
    at: new Date().toISOString(),
    who,
  });

  const summary = summarize(await store.list(trail.id));
  const confirmedNow = !wasConfirmed && summary.confirmed.some((c) => c.kind === kind.id);
  return { ok: true, summary, confirmedNow };
}
