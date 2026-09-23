import { ACTIVITY_IDS, ACTIVITIES } from "../activities";
import { resolveDatePhrase, todayIso } from "../dates";
import { findPlace } from "./places";
import { findSubjects, namedPlace } from "./subject";
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

  let maxDistanceMi = parseMiles(text, /(?:under|less than|shorter than|max)\s+(\d+(?:\.\d+)?)\s*(?:mi|mile)/);
  let maxGainFt = parseMiles(text, /(?:under|less than|max)\s+(\d+(?:\.\d+)?)\s*(?:ft|feet|'|vert)/);

  /*
   * Intent words. Before these, the parser understood only activity, day,
   * place and explicit distances, so "somewhere shady", "an easy one" and
   * "something with a waterfall" all reduced to the same query and got the
   * same answer. Each word below changes what is searched or how it is
   * ranked, and every one is echoed back in the interpretation so the reader
   * can see what was understood.
   */
  const easy = /\b(easy|short|quick|beginner|family|kids?|mellow|chill|casual)\b/.test(text);
  const hard = /\b(hard|long|big day|challeng\w*|strenuous|workout|epic|tough)\b/.test(text);
  const preferShade = /\b(shad(?:e|y|ed)|cool(?:er)?|out of the sun|beat the heat)\b/.test(text);
  const preferSun = !preferShade && /\b(sunny|in the sun|warm(?:er)?|sun[- ]?facing)\b/.test(text);
  const wantsWater = /\b(waterfalls?|falls|lakes?|swim\w*|alpine lake)\b/.test(text);

  /*
   * Two things people ask for that a weather score cannot express: whether
   * the dog can come, and where the leaves are. Both change the answer
   * completely, and both were previously ignored.
   */
  const needsDogFriendly = /\b(dogs?|puppy|puppies|pets?|pup)\b/.test(text);
  const wantsFallColor =
    /\b(fall colou?rs?|autumn colou?rs?|leaves|foliage|aspens?|leaf peep\w*|colou?r)\b/.test(text);

  const rockMatch = text.match(/\b(sandstone|granite|limestone|quartzite|conglomerate|basalt)\b/);
  const rockType = rockMatch?.[1] as AskQuery["rockType"];

  const speciesMatch = text.match(
    /\b(browns?|rainbows?|cutthroats?|cutty|cutties|brookies?|brooks?|whitefish|kokanee)\b/,
  );
  const SPECIES_WORD: Record<string, string> = {
    brown: "brown", browns: "brown", rainbow: "rainbow", rainbows: "rainbow",
    cutthroat: "bonneville-cutthroat", cutthroats: "bonneville-cutthroat",
    cutty: "bonneville-cutthroat", cutties: "bonneville-cutthroat",
    brook: "brook", brooks: "brook", brookie: "brook", brookies: "brook",
    whitefish: "whitefish", kokanee: "kokanee",
  };
  const species = speciesMatch?.[1] ? SPECIES_WORD[speciesMatch[1]] : undefined;
  if (species) activity = "fish";

  let minGainFt: number | undefined;
  if (easy && !hard && activity !== "climb" && activity !== "fish") {
    maxDistanceMi = maxDistanceMi ?? 5;
    maxGainFt = maxGainFt ?? 1200;
  }
  if (hard && !easy && activity !== "climb" && activity !== "fish") {
    minGainFt = 2000;
  }

  const parts = [`${ACTIVITIES[activity].label.toLowerCase()} on ${date}`];
  if (place) parts.push(`near ${place.label}`);
  if (withinMi !== undefined) parts.push(`within ${Math.round(withinMi)} mi`);
  if (maxDistanceMi !== undefined) parts.push(`under ${maxDistanceMi} mi long`);
  if (maxGainFt !== undefined) parts.push(`under ${maxGainFt.toLocaleString()} ft of gain`);
  if (minGainFt !== undefined) parts.push(`at least ${minGainFt.toLocaleString()} ft of gain`);
  if (preferShade) parts.push("favouring shade");
  if (preferSun) parts.push("favouring sun");
  if (wantsWater) parts.push("with a lake or waterfall");
  if (needsDogFriendly) parts.push("where dogs are allowed");
  if (wantsFallColor) parts.push("for fall color");
  if (rockType) parts.push(`on ${rockType}`);
  const SPECIES_LABEL: Record<string, string> = {
    brown: "brown trout", rainbow: "rainbow trout", "bonneville-cutthroat": "cutthroat",
    brook: "brook trout", whitefish: "whitefish", kokanee: "kokanee",
  };
  if (species) parts.push(`holding ${SPECIES_LABEL[species] ?? species}`);

  /*
   * Does the question name somewhere in particular? This runs before the
   * generic search so that "whats the jordan river resivar" is answered
   * about the Jordan River rather than turned into a hike query that
   * confidently returns Angels Landing.
   */
  const subjects = findSubjects(question);
  const subject = subjects[0];
  if (subject && !subject.trail.activities.includes(activity)) {
    activity = subject.trail.activities[0] ?? activity;
    parts[0] = `${ACTIVITIES[activity].label.toLowerCase()} on ${date}`;
  }
  if (subject) parts.unshift(`about ${subject.trail.name}`);
  const unknownPlace = subject ? undefined : (namedPlace(question) ?? undefined);

  return {
    activity,
    date,
    subject: subject?.trail.id,
    subjectAlternatives: subjects.slice(1).map((s) => s.trail.id),
    unknownPlace,
    near: place?.label,
    origin: place ? { lat: place.lat, lon: place.lon, label: place.label } : undefined,
    withinMi,
    maxDistanceMi,
    maxGainFt,
    minGainFt,
    preferShade: preferShade || undefined,
    preferSun: preferSun || undefined,
    wantsWater: wantsWater || undefined,
    needsDogFriendly: needsDogFriendly || undefined,
    wantsFallColor: wantsFallColor || undefined,
    rockType,
    species,
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
    // Intents the model schema does not cover are carried from the rules
    // parse, so refining a query never silently discards "shady" or "easy".
    ...fallback,
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
