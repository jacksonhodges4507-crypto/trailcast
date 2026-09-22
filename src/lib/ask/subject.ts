import { TRAILS } from "../trails";
import type { Trail } from "../types";

/**
 * Does the question name a specific place we know?
 *
 * The rules parser understands *kinds* of question ("a shady hike Saturday").
 * It had no idea that "whats the jordan river resivar" names a place at all,
 * so it fell back to a generic hike search and confidently answered with
 * Angels Landing. That is the worst failure an assistant can have: a wrong
 * answer delivered as a right one.
 *
 * So before anything else, we ask whether the question names a place in the
 * dataset. People type place names from memory, on a phone, so the match has
 * to survive missing vowels, swapped letters and DWR's own spellings:
 * "resivar" has to reach "reservoir" and "jordanelle" has to be reachable
 * from "jordan". When nothing matches well, we say so instead of guessing.
 */

/** Spellings people actually type, mapped to the word we index on. */
const SPELLINGS: Record<string, string> = {
  resivar: "reservoir", resevoir: "reservoir", reservior: "reservoir",
  resavoir: "reservoir", resivoir: "reservoir", reservoire: "reservoir",
  reservor: "reservoir", resevior: "reservoir", res: "reservoir",
  rez: "reservoir", crick: "creek", ck: "creek", cr: "creek",
  cyn: "canyon", mtn: "mountain", mnt: "mountain", mt: "mountain",
  rvr: "river", lk: "lake", pnd: "pond", frk: "fork", n: "north",
  s: "south", e: "east", w: "west",
};

/** Words that carry no identity of their own: every third water is a "lake". */
const GENERIC = new Set([
  "lake", "lakes", "reservoir", "river", "creek", "fork", "canyon", "pond",
  "ponds", "trail", "trails", "peak", "mountain", "mountains", "upper",
  "lower", "north", "south", "east", "west", "middle", "little", "big",
  "state", "park", "bay", "wall", "crag", "area", "loop", "ridge", "point",
  "spring", "springs", "reach", "county", "stream", "river's",
]);

const STOP = new Set([
  "a", "an", "the", "is", "are", "was", "at", "in", "on", "of", "to", "for",
  "about", "me", "my", "i", "it", "its", "and", "or", "with", "near", "by",
  "from", "how", "what", "whats", "where", "wheres", "which", "who", "when",
  "tell", "show", "know", "any", "some", "good", "best", "like", "can",
  "could", "should", "do", "does", "did", "go", "going", "get", "there",
  "here", "you", "your", "us", "we", "this", "that", "be", "been",
  "conditions", "condition", "today", "tomorrow", "weekend", "now",
]);

function canon(word: string): string {
  const bare = word.replace(/[^a-z0-9]/g, "");
  return SPELLINGS[bare] ?? bare;
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .map(canon)
    .filter((w) => w.length > 0 && !STOP.has(w));
}

/** Levenshtein distance, given up on once it passes `cap`. */
function within(a: string, b: string, cap: number): boolean {
  if (Math.abs(a.length - b.length) > cap) return false;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const value = Math.min(row[j - 1]! + 1, prev[j]! + 1, prev[j - 1]! + cost);
      row.push(value);
      if (value < best) best = value;
    }
    if (best > cap) return false;
    prev = row;
  }
  return prev[b.length]! <= cap;
}

/**
 * How well one word from a place's name is covered by the question.
 * Exact beats a prefix beats a typo, so "jordan river" prefers the Jordan
 * River over Jordanelle even though both are reachable from "jordan".
 */
function wordScore(nameWord: string, asked: string[]): number {
  let best = 0;
  for (const word of asked) {
    if (word === nameWord) return 1;
    if (nameWord.length >= 5 && word.length >= 4 && nameWord.startsWith(word)) {
      best = Math.max(best, 0.8);
    } else if (word.length >= 5 && nameWord.length >= 4 && word.startsWith(nameWord)) {
      best = Math.max(best, 0.8);
    } else {
      const cap = Math.min(nameWord.length, word.length) >= 6 ? 2 : 1;
      if (Math.min(nameWord.length, word.length) >= 4 && within(nameWord, word, cap)) {
        best = Math.max(best, 0.6);
      }
    }
  }
  return best;
}

/** Something to break ties with: a busier place is the likelier subject. */
function prominence(trail: Trail): number {
  const withExtras = trail as Trail & { stockedFish?: number; routes?: number };
  if (trail.sourceName === "Utah DWR") return withExtras.stockedFish ?? 0;
  if (withExtras.routes) return 5_000_000 + withExtras.routes;
  return 10_000_000;
}

export interface SubjectMatch {
  trail: Trail;
  /** 0-1: how completely the question covers the place's name. */
  confidence: number;
}

interface Indexed {
  trail: Trail;
  words: string[];
}

let index: Indexed[] | null = null;

function indexed(): Indexed[] {
  if (!index) {
    index = TRAILS.map((trail) => ({
      trail,
      words: tokenize(trail.name.replace(/\(reach \d+\)/i, "")),
    })).filter((entry) => entry.words.length > 0);
  }
  return index;
}

/**
 * The places the question could be naming, best first. Empty when the
 * question names no place we hold — which is a real answer, not a failure.
 */
export function findSubjects(question: string, limit = 3): SubjectMatch[] {
  const asked = tokenize(question);
  if (asked.length === 0) return [];

  const scored: { entry: Indexed; confidence: number; specific: number }[] = [];

  for (const entry of indexed()) {
    let total = 0;
    let specific = 0;
    for (const word of entry.words) {
      const score = wordScore(word, asked);
      total += score;
      if (score >= 0.6 && !GENERIC.has(word)) specific += score;
    }
    // A place identified only by the word "lake" is not identified at all.
    if (specific === 0) continue;

    const nameCoverage = total / entry.words.length;
    const askCoverage = Math.min(1, total / asked.length);
    const confidence = nameCoverage * 0.75 + askCoverage * 0.25;
    if (confidence < 0.5) continue;
    scored.push({ entry, confidence, specific });
  }

  scored.sort((a, b) => {
    if (Math.abs(b.confidence - a.confidence) > 0.02) return b.confidence - a.confidence;
    if (b.specific !== a.specific) return b.specific - a.specific;
    return prominence(b.entry.trail) - prominence(a.entry.trail);
  });

  return scored.slice(0, limit).map((s) => ({ trail: s.entry.trail, confidence: s.confidence }));
}

export function findSubject(question: string): SubjectMatch | null {
  return findSubjects(question, 1)[0] ?? null;
}

const ASKING_ABOUT = /^\s*(?:what(?:'?s| is| are)?|where(?:'?s| is)?|how(?:'?s| is)?|tell me about|hows|whats|wheres)\s+(?:the\s+|a\s+)?/i;
const NOT_A_PLACE =
  /\b(i|we|you|my|me|should|can|could|would|ride|riding|run|running|go|going|somewhere|anything|best|good|nearby|weekend|saturday|sunday|monday|tuesday|wednesday|thursday|friday|where|what|how)\b/i;
const PLACE_WORD = /\b(reservoir|resivar|resevoir|reservior|lake|river|creek|canyon|peak|mountain|trail|pond|fork|wall|crag|falls?)\b/i;

/**
 * The place the question seems to be about, for when we have to say we don't
 * hold it. Returns null when the question isn't naming anywhere in particular.
 */
export function namedPlace(question: string): string | null {
  const text = question.trim().replace(/[?.!]+$/, "");
  const phrase = text
    .replace(ASKING_ABOUT, "")
    .replace(/\b(like|conditions?|weather|fishing|fish|hiking|climbing|today|tomorrow|right now|this weekend)\b/gi, "")
    .replace(/^\s*(?:at|in|on|near|to|around|by|the|a)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();

  // Only claim we don't hold somewhere when the question clearly named a
  // place. "Where should I ride near Park City" is a search, not a place.
  if (!phrase || phrase.split(" ").length > 5) return null;
  if (!PLACE_WORD.test(phrase)) return null;
  if (NOT_A_PLACE.test(phrase)) return null;

  return phrase
    .split(" ")
    .map((w) => (w.length > 2 ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}
