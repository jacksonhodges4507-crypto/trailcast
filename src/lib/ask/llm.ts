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
 * The model is given the scored facts and nothing else, and is asked for the
 * one thing a ranked list cannot express on its own: *why this one and not
 * that one*. A list already says Lake Blanche is 97 and Mount Olympus is 93;
 * what it cannot say is that the gap is entirely trail surface and that the
 * two are interchangeable if you do not mind mud.
 *
 * Grounding is enforced by construction rather than by asking nicely. Only
 * scored facts are passed, vetoes are labelled as absolute, and the prose is
 * required to cite readings that appear in the payload. The scoring engine
 * has already made the decision; the model's job is to explain the decision,
 * and it cannot reach the inputs needed to make a different one.
 */
export async function narrate(
  query: AskQuery,
  reports: TrailReport[],
): Promise<string | null> {
  if (reports.length === 0) return null;

  const options = reports.slice(0, 5).map((report) => ({
    name: report.trail.name,
    region: report.trail.region,
    distanceMi: report.trail.distanceMi,
    gainFt: report.trail.gainFt,
    grade: report.verdict.grade,
    score: report.verdict.score,
    driveMinutesOneWay: report.travel?.minutes ?? null,
    driveIsEstimate: report.travel ? report.travel.source === "estimate" : null,
    blurb: report.trail.blurb,
    vetoes: report.verdict.factors
      .filter((f) => f.veto)
      .map((f) => `${f.label}: ${f.reason}`),
    factors: report.verdict.factors
      .filter((f) => f.score !== undefined)
      .map((f) => ({
        factor: f.label,
        reading: f.display ?? null,
        rating: f.score,
        weightPct: Math.round(f.weight * 100),
        note: f.reason,
      })),
    visitorReports: (report.crowd ?? []).map((c) => ({
      report: c.label,
      distinctPeople: c.reporters,
      latest: c.latest,
    })),
    missingInputs: report.verdict.factors
      .filter((f) => f.score === undefined)
      .map((f) => f.label),
  }));

  const system = [
    "You are Scout, TrailCast's assistant. You talk like a friend who knows",
    "Utah's outdoors well: warm, direct, first person (\"I'd go to...\"),",
    "speaking to the person, never a report or a summary of the area.",
    "",
    "You explain outdoor conditions decisions that have already been made.",
    "",
    "A scoring engine produced these options, ranked, with each factor's",
    "reading, its 0-100 rating and how much it counted for this activity.",
    "Your job is the comparison the ranking cannot express: why the top",
    "option beats the next one, and what would change that.",
    "",
    "Rules:",
    "- 2-4 conversational sentences. Prose only: no bullets, headings or preamble.",
    "- Lead with the recommendation, then why, in plain words.",
    "- Use ONLY the supplied facts. Never invent a place, number or condition.",
    "- Cite at least two specific readings, in their own units, verbatim.",
    "- Name the single factor that separates the top two options.",
    "- A veto is absolute. If the top option has one, lead with it, say",
    "  plainly not to go, and recommend the best option that has none.",
    "- If a factor is listed in missingInputs, do not claim anything about it.",
    "- Say the caveat even when the answer is good. A confident recommendation",
    "  with no downside named is the least useful kind.",
    "- If driveMinutesOneWay is present, weigh it. Say whether the top option's",
    "  better conditions justify any extra drive over the runner-up, in minutes.",
    "  A few points is rarely worth an extra hour each way; a veto elsewhere",
    "  always is. Drive times are free-flow estimates: never promise them.",
    "- visitorReports are unverified observations confirmed by 2+ different",
    "  people in the last 48 hours. Mention a non-trivial one for the top",
    "  option as reported, never as measured fact, and never let it override",
    "  a sensor reading or a veto.",
  ].join("\n");

  /*
   * A question that names a place is not a request for a recommendation.
   * "What's the Jordan River Reservoir" wants to be told about that place,
   * and told honestly if the name is ambiguous -- not sold a hike.
   */
  const subjectRules = query.subject
    ? [
        "",
        "This question named a specific place, given first in options. Answer",
        "ABOUT that place: what and where it is, then how it is on the date.",
        "Do not recommend somewhere else instead.",
        "The other options are places whose names are close to what was typed.",
        "If the name was ambiguous, say in one clause that you also have them,",
        "so the reader can correct you.",
        "If the place has no conditions data, say that plainly rather than",
        "filling the gap.",
      ]
    : [];

  const user = JSON.stringify(
    {
      question: query.interpretation,
      askedAbout: query.subject ? options[0]?.name ?? null : null,
      date: query.date,
      activity: query.activity,
      origin: query.origin?.label ?? null,
      originIsDevice: query.originSource === "device",
      options,
    },
    null,
    2,
  );

  return call({
    system: [system, ...subjectRules].join("\n"),
    user,
    maxTokens: 600,
    timeoutMs: 14000,
  });
}

/**
 * The answer when the question named a place TrailCast does not hold.
 *
 * The failure that made this necessary was Scout answering "what's the
 * Jordan River Reservoir" with Angels Landing: a wrong answer given
 * confidently. The fix is a path where the honest answer -- "I don't have
 * that" -- is the only one available, and general knowledge is clearly
 * labelled as general knowledge rather than dressed up as a forecast.
 */
export async function narrateUnknown(
  question: string,
  place: string,
  date: string,
): Promise<string | null> {
  const system = [
    "You are Scout, TrailCast's assistant: warm, direct, first person, brief.",
    "",
    "TrailCast has NO data for the place this person named. That is the",
    "answer, and you must give it first.",
    "",
    "Rules:",
    "- 2-4 conversational sentences. Prose only.",
    "- First sentence: say plainly you don't have that place in TrailCast.",
    "- Then, if you recognise the name, say in one or two sentences what and",
    "  where it is, and label it clearly as general knowledge rather than",
    "  live conditions: you have no forecast, flow, score or report for it.",
    "- If you do not recognise it, say so. Do not guess at a similar name,",
    "  and never present a guess as a fact.",
    "- Never invent a temperature, flow, score, stocking record or condition.",
    "- TrailCast covers Utah: every water the DWR stocks, OpenBeta's climbing",
    "  areas and a hand-built trail set. Offer the nearest useful next step,",
    "  such as trying the name as it appears on a map, or asking what's good",
    "  near a town.",
  ].join("\n");

  const user = JSON.stringify({ question, placeAsTyped: place, date }, null, 2);
  return call({ system, user, maxTokens: 400, timeoutMs: 12000 });
}
