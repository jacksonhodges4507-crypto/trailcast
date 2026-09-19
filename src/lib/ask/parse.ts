import { ACTIVITY_IDS, ACTIVITIES } from "../activities";
import { resolveDatePhrase, todayIso } from "../dates";
import { findPlace } from "./places";
import type { ActivityId, AskQuery } from "../types";

const ACTIVITY_PATTERNS: [ActivityId, RegExp][] = [
  ["mtb", /\b(mtb|mountain bik\w*|bike|biking|ride|riding|singletrack)\b/],
  ["trail_run", /\b(run|running|jog\w*|trail run\w*)\b/],
  ["climb", /\b(climb\w*|crag\w*|bouldering|sport climb\w*)\b/],
  ["fish", /\b(fish|fishes|fishing|fisher\w*|angler|angling|fly\s?fish\w*|trout)\b/],
  ["hike", /\b(hike|hiking|hikes|walk|trek\w*|summit|peak)\b/],
];

function parseMiles(text: string, pattern: RegExp): number | undefined {
  const match = text.match(pattern);
  const raw = match?.[1];
  if (!raw) return undefined;
  const value = Number(raw);
  return Number.isFinite(value) ? value : undefined;
}

/**
 * The deterministic parser.
 *
 * This is not a fallback bolted on afterwards — it is the reference
 * implementation. The model-backed parser in `llm.ts` has to produce the same
 * `AskQuery` shape, which means the whole ask feature has tests that run
 * without a network call or an API key, and the product still works when the
 * model is unavailable.
 */
export function parseQuery(question: string, today: string = todayIso()): AskQuery {
  const text = question.toLowerCase();

  let activity: ActivityId = "hike";
  for (const [id, pattern] of ACTIVITY_PATTERNS) {
    if (pattern.test(text)) {
      activity = id;
      break;
    }
  }

  const date = resolveDatePhrase(text, today) ?? today;
  const place = findPlace(text);

  // "within 2 hours" reads as drive time; at mountain-road speeds that is
  // roughly 45 miles an hour.
  const withinMiles = parseMiles(text, /within\s+(\d+(?:\.\d+)?)\s*(?:mi|mile)/);
  const withinHours = parseMiles(text, /within\s+(\d+(?:\.\d+)?)\s*(?:hr|hour)/);
  const withinMi = withinMiles ?? (withinHours !== undefined ? withinHours * 45 : undefined);

  const maxDistanceMi = parseMiles(text, /(?:under|less than|shorter than|max)\s+(\d+(?:\.\d+)?)\s*(?:mi|mile)/);
  const maxGainFt = parseMiles(text, /(?:under|less than|max)\s+(\d+(?:\.\d+)?)\s*(?:ft|feet|'|vert)/);

  const parts = [`${ACTIVITIES[activity].label.toLowerCase()} on ${date}`];
  if (place) parts.push(`near ${place.label}`);
  if (withinMi !== undefined) parts.push(`within ${Math.round(withinMi)} mi`);
  if (maxDistanceMi !== undefined) parts.push(`under ${maxDistanceMi} mi long`);
  if (maxGainFt !== undefined) parts.push(`under ${maxGainFt} ft of gain`);

  return {
    activity,
    date,
    near: place?.label,
    origin: place ? { lat: place.lat, lon: place.lon, label: place.label } : undefined,
    withinMi,
    maxDistanceMi,
    maxGainFt,
    interpretation: parts.join(", "),
    parsedBy: "rules",
  };
}

/** Validate and normalise a query object that came back from a model. */
export function coerceQuery(raw: unknown, today: string, fallback: AskQuery): AskQuery {
  if (typeof raw !== "object" || raw === null) return fallback;
  const record = raw as Record<string, unknown>;

  const activity =
    typeof record["activity"] === "string" &&
    (ACTIVITY_IDS as string[]).includes(record["activity"])
      ? (record["activity"] as ActivityId)
      : fallback.activity;

  const date =
    typeof record["date"] === "string" && /^\d{4}-\d{2}-\d{2}$/.test(record["date"])
      ? record["date"]
      : fallback.date;

  const near = typeof record["near"] === "string" ? record["near"] : fallback.near;
  const place = near ? findPlace(near) : undefined;

  const numberOr = (value: unknown, fb: number | undefined): number | undefined =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fb;

  void today;

  return {
    activity,
    date,
    near: place?.label ?? near,
    origin: place
      ? { lat: place.lat, lon: place.lon, label: place.label }
      : fallback.origin,
    withinMi: numberOr(record["withinMi"], fallback.withinMi),
    maxDistanceMi: numberOr(record["maxDistanceMi"], fallback.maxDistanceMi),
    maxGainFt: numberOr(record["maxGainFt"], fallback.maxGainFt),
    interpretation:
      typeof record["interpretation"] === "string" && record["interpretation"].length > 0
        ? record["interpretation"]
        : fallback.interpretation,
    parsedBy: "llm",
  };
}
