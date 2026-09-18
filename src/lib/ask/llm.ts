import type { AskQuery, TrailReport } from "../types";
import { coerceQuery } from "./parse";
import { ACTIVITY_IDS } from "../activities";
import { PLACES } from "./places";

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-5";

export function isLlmEnabled(): boolean {
  return Boolean(process.env["ANTHROPIC_API_KEY"]);
}

interface CallOptions {
  system: string;
  user: string;
  maxTokens: number;
  timeoutMs: number;
}

/**
 * Minimal Messages API client over `fetch`. The official SDK would be one
 * more dependency for two calls that are a POST and a field read, and keeping
 * it out means the ask layer has no install-time coupling to a vendor.
 */
async function call(options: CallOptions): Promise<string | null> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) return null;

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs);

  try {
    const response = await fetch(API_URL, {
      method: "POST",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: process.env["ANTHROPIC_MODEL"] ?? DEFAULT_MODEL,
        max_tokens: options.maxTokens,
        system: options.system,
        messages: [{ role: "user", content: options.user }],
      }),
    });

    if (!response.ok) return null;

    const payload = (await response.json()) as {
      content?: { type?: string; text?: string }[];
    };

    const text = payload.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();

    return text && text.length > 0 ? text : null;
  } catch {
    // Any failure here is non-fatal by design: the caller falls back to the
    // deterministic path and the user never sees an error.
    return null;
  } finally {
    clearTimeout(timer);
  }
}

function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = (fenced?.[1] ?? text).trim();
  const start = candidate.indexOf("{");
  const end = candidate.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;

  try {
    return JSON.parse(candidate.slice(start, end + 1)) as unknown;
  } catch {
    return null;
  }
}

/**
 * Upgrade a rules-parsed query using a model, when one is configured.
 * Returns the original query unchanged on any failure.
 */
export async function refineQuery(
  question: string,
  today: string,
  fallback: AskQuery,
): Promise<AskQuery> {
  const system = [
    "You convert a question about outdoor conditions into a JSON query object.",
    "Reply with JSON only, no prose.",
    "",
    "Fields:",
    `  activity: one of ${ACTIVITY_IDS.join(", ")}`,
    "  date: YYYY-MM-DD",
    `  near: one of ${PLACES.map((p) => p.label).join(", ")} — omit if not implied`,
    "  withinMi: number, omit unless the user gave a radius or drive time (45 mph)",
    "  maxDistanceMi: number, omit unless the user capped route length",
    "  maxGainFt: number, omit unless the user capped elevation gain",
    "  interpretation: one short sentence restating the query in plain English",
    "",
    `Today is ${today}. Resolve relative days against it.`,
  ].join("\n");

  const text = await call({
    system,
    user: question,
    maxTokens: 400,
    timeoutMs: 8000,
  });

  if (!text) return fallback;

  const parsed = extractJson(text);
  if (parsed === null) return fallback;

  return coerceQuery(parsed, today, fallback);
}

/**
 * Narrate a ranked result set.
 *
 * The model is given only the scored facts and told not to add any. That
 * keeps the prose grounded in the same numbers the cards show, which is the
 * whole reason the scoring engine is deterministic in the first place: the
 * model explains a decision, it does not make one.
 */
export async function narrate(
  query: AskQuery,
  reports: TrailReport[],
): Promise<string | null> {
  if (reports.length === 0) return null;

  const facts = reports.slice(0, 5).map((report) => ({
    name: report.trail.name,
    region: report.trail.region,
    distanceMi: report.trail.distanceMi,
    gainFt: report.trail.gainFt,
    grade: report.verdict.grade,
    score: report.verdict.score,
    headline: report.verdict.headline,
    factors: report.verdict.factors
      .filter((f) => f.score !== undefined)
      .map((f) => `${f.label}: ${f.score} — ${f.reason}`),
  }));

  const system = [
    "You are a concise outdoor conditions assistant.",
    "Write 2-4 sentences recommending from the supplied options.",
    "Use ONLY the supplied facts. Never invent a trail, number, or condition.",
    "Name the top pick, say why in terms of the factors given, and note the",
    "single biggest caveat. No bullet points, no headings, no preamble.",
    "If the top option is graded 'unsafe', lead with that and say not to go.",
  ].join("\n");

  const user = JSON.stringify({ query: query.interpretation, options: facts }, null, 2);

  return call({ system, user, maxTokens: 500, timeoutMs: 12000 });
}
