import type { AskQuery, TrailReport } from "../types";
import { coerceQuery } from "./parse";
import { ACTIVITY_IDS } from "../activities";
import { PLACES } from "./places";

const API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-5";

/** The configured model, treating blank and whitespace as unset. */
function modelName(): string {
  return (process.env["ANTHROPIC_MODEL"] ?? "").trim() || DEFAULT_MODEL;
}

/** Test seam for the blank-env-var case that cost an afternoon. */
export const modelForTests = modelName;

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
/**
 * Why the last model call did not produce prose.
 *
 * Falling back silently is right for the reader -- they get a real answer
 * either way -- but it made the feature undebuggable from outside: a missing
 * key, a rejected key and a rate limit all looked identical, which is
 * exactly the confusion that cost an afternoon. This records the reason, and
 * the ask endpoint reports it. It never carries the key or any response
 * body, only a status.
 */
export type LlmStatus =
  | "off"
  | "ok"
  | "unauthorized"
  | "rate-limited"
  | "credit"
  | "timeout"
  | "network"
  | `http-${string}`
  | "empty";

let lastStatus: LlmStatus = "off";

export function llmStatus(): LlmStatus {
  return lastStatus;
}

async function call(options: CallOptions): Promise<string | null> {
  const apiKey = process.env["ANTHROPIC_API_KEY"];
  if (!apiKey) {
    lastStatus = "off";
    return null;
  }

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
        // An env var set to an empty string is not an unset env var, and `??`
        // only catches the second. A blank ANTHROPIC_MODEL was being sent
        // verbatim, and the API rejected every request with "model: String
        // should have at least 1 character" -- which, before the status field
        // existed, looked exactly like having no key at all.
        model: modelName(),
        max_tokens: options.maxTokens,
        system: options.system,
        messages: [{ role: "user", content: options.user }],
      }),
    });

    if (!response.ok) {
      /*
       * A 400 covers several unrelated causes -- an exhausted balance, a
       * model name the account cannot use, a malformed request -- and
       * guessing between them from the status alone is how an afternoon
       * gets spent. The API states the reason in its own error body, so
       * that is what gets recorded: its type, and the first part of its
       * message. No key and no request content, only the complaint.
       */
      let detail = "";
      try {
        const body = (await response.json()) as { error?: { type?: string; message?: string } };
        const kind = body.error?.type ?? "";
        const message = (body.error?.message ?? "").slice(0, 120);
        detail = [kind, message].filter(Boolean).join(": ");
      } catch {
        detail = "";
      }
      lastStatus =
        response.status === 401 || response.status === 403
          ? "unauthorized"
          : response.status === 429
            ? "rate-limited"
            : (`http-${response.status}${detail ? ` (${detail})` : ""}` as LlmStatus);
      return null;
    }

    const payload = (await response.json()) as {
      content?: { type?: string; text?: string }[];
    };

    const text = payload.content
      ?.filter((block) => block.type === "text")
      .map((block) => block.text ?? "")
      .join("")
      .trim();

    if (text && text.length > 0) {
      lastStatus = "ok";
      return text;
    }
    lastStatus = "empty";
    return null;
  } catch (error) {
    // Any failure here is non-fatal by design: the caller falls back to the
    // deterministic path and the user never sees an error. It is recorded
    // so that "the AI isn't working" is answerable without guessing.
    lastStatus = error instanceof Error && error.name === "AbortError" ? "timeout" : "network";
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
    dogs: report.trail.dogs ?? null,
    // The shape of the day, so timing advice is grounded rather than invented.
    hourly: (report.conditions.hours ?? [])
      .filter((h) => h.tempF !== undefined)
      .map((h) => ({
        hour: h.hour,
        tempF: Math.round(h.tempF as number),
        rainChancePct: h.precipChancePct ?? null,
        windMph: h.windMph !== undefined ? Math.round(h.windMph) : null,
      })),
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
    "The reader sees the ranked places, their scores and their readings as",
    "cards directly BELOW your text. So do not summarise those cards. Your",
    "job is the reasoning a card cannot carry: what you would actually do,",
    "why, what you weighed it against, and when to be there.",
    "",
    "Shape: three short paragraphs, separated by a blank line.",
    "  1. Answer the question that was asked, in a sentence or two. If they",
    "     asked where to go, name one place and commit to it.",
    "  2. Why that one, and what it beats. Name the factor that separates it",
    "     from the runner-up, with both readings.",
    "  3. When to be there and what could go wrong. Use the hourly shape if",
    "     one is supplied: 'go early, it hits 91 by two' is the sentence a",
    "     score cannot give them.",
    "",
    "Rules:",
    "- Prose only: no bullets, headings, markdown or preamble.",
    "- Never open with 'Based on' or restate the question back at them.",
    "- Never end with a list of the places and their scores; the cards below",
    "  already do that, and repeating it is what makes you sound like a",
    "  search result instead of an answer.",
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
    maxTokens: 700,
    timeoutMs: 16000,
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
    "  where it is -- hedged, always: \"I think\", \"if I'm thinking of the",
    "  right one\". Never state a place's location as settled fact. Trail and",
    "  crag names repeat across states, so the one you are picturing may not",
    "  be the one they mean, and a confident wrong location is worse than no",
    "  location at all.",
    "- Whatever you recall is general knowledge, not a reading: you have no",
    "  forecast, flow, score or report for it. Say so.",
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
