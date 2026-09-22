import type { Trail } from "../types";
import { DWR_WATERS, type DwrRow } from "../data/dwrWaters";

/**
 * Turns DWR's stocking records into places TrailCast can score.
 *
 * DWR names waters in a compressed field-notebook style ("DEER CR RES",
 * "RED CASTLE,UPPER G16", "BESS L BTN"), so names are expanded and
 * title-cased, and the trailing basin codes that mean something only inside
 * the agency are dropped. Uinta lake codes ("Z-35", "GR-104") are kept:
 * they are how anglers and maps actually refer to those lakes.
 */

export interface DwrSpecies {
  name: string;
  /** The Fish Dex entry, where there is one. */
  dex?: string;
}

export const DWR_SPECIES: Record<string, DwrSpecies> = {
  RB: { name: "Rainbow trout", dex: "rainbow" },
  BC: { name: "Bonneville cutthroat", dex: "bonneville-cutthroat" },
  CR: { name: "Colorado River cutthroat", dex: "colorado-cutthroat" },
  BL: { name: "Bear Lake cutthroat", dex: "bear-lake-cutthroat" },
  CT: { name: "Cutthroat trout", dex: "bonneville-cutthroat" },
  BK: { name: "Brook trout", dex: "brook" },
  BN: { name: "Brown trout", dex: "brown" },
  TG: { name: "Tiger trout", dex: "tiger-trout" },
  SP: { name: "Splake", dex: "splake" },
  LT: { name: "Lake trout", dex: "lake-trout" },
  KO: { name: "Kokanee salmon", dex: "kokanee" },
  GR: { name: "Arctic grayling", dex: "grayling" },
  CC: { name: "Channel catfish", dex: "channel-catfish" },
  BG: { name: "Bluegill", dex: "bluegill" },
  KC: { name: "Crappie", dex: "crappie" },
  LM: { name: "Largemouth bass", dex: "largemouth" },
  SM: { name: "Smallmouth bass", dex: "smallmouth" },
  WE: { name: "Walleye", dex: "walleye" },
  WB: { name: "White bass", dex: "wiper" },
  WI: { name: "Wiper", dex: "wiper" },
  TM: { name: "Tiger muskie", dex: "tiger-muskie" },
  YP: { name: "Yellow perch", dex: "yellow-perch" },
};

/** Utah county codes as DWR uses them (alphabetical, 01-29). */
const COUNTIES = [
  "Beaver", "Box Elder", "Cache", "Carbon", "Daggett", "Davis", "Duchesne", "Emery", "Garfield", "Grand",
  "Iron", "Juab", "Kane", "Millard", "Morgan", "Piute", "Rich", "Salt Lake", "San Juan", "Sanpete",
  "Sevier", "Summit", "Tooele", "Uintah", "Utah", "Wasatch", "Washington", "Wayne", "Weber",
];

export function countyName(code: string): string {
  const n = Number(code);
  return COUNTIES[n - 1] ? `${COUNTIES[n - 1]} County` : "Utah";
}

const WORDS: Record<string, string> = {
  RES: "Reservoir",
  "RES.": "Reservoir",
  L: "Lake",
  R: "River",
  CR: "Creek",
  CRK: "Creek",
  CK: "Creek",
  CYN: "Canyon",
  FK: "Fork",
  P: "Pond",
  PND: "Pond",
  PD: "Pond",
  SP: "Springs",
  N: "North",
  S: "South",
  E: "East",
  W: "West",
  MID: "Middle",
  LF: "Left",
  RT: "Right",
  LWR: "Lower",
  MT: "Mount",
  FT: "Fort",
  NO: "No.",
  IMP: "Impoundment",
  BRG: "Bridge",
  PO: "Pond",
  CNTY: "County",
  G: "",
  F: "",
  C: "",
};

/** Basin and district suffixes that mean nothing outside DWR. */
const DROP = new Set(["NCL", "BTN", "BTS", "BT", "EBS", "EB", "GT", "TLM", "NBS", "NB", "FL", "EMW", "SB", "DC"]);

const LAKE_CODE = /^(?:[A-Z]{1,2}-\s?\d{1,3}|[A-Z]{1,2}\d{1,3})$/;

function titleCase(word: string): string {
  if (/^[A-Z]{1,2}-\d+$/.test(word) || LAKE_CODE.test(word)) return word;
  return word
    .toLowerCase()
    .replace(/(^|[-(])([a-z])/g, (_m, pre: string, ch: string) => pre + ch.toUpperCase());
}

/** "RED CASTLE,UPPER G16" -> "Upper Red Castle (G16)"; "DEER CR RES" -> "Deer Creek Reservoir". */
export function prettyName(raw: string): string {
  let name = raw
    .replace(/\s+/g, " ")
    .replace(/([A-Z])-\s(\d)/g, "$1-$2")
    .trim();
  if ((name.match(/\(/g) ?? []).length > (name.match(/\)/g) ?? []).length) name += ")";
  let qualifier = "";
  const comma = name.match(/^(.*?),\s*(UPPER|LOWER|MIDDLE|EAST|WEST|NORTH|SOUTH|LITTLE UPPER)\b(.*)$/);
  if (comma) {
    name = `${comma[1]}${comma[3] ?? ""}`;
    qualifier = comma[2]!;
  }
  const tokens = name
    .replace(/,/g, " ")
    .replace(/\(/g, " ( ")
    .replace(/\)/g, " ) ")
    .split(" ")
    .filter(Boolean)
    .map((token) => {
      // "7-BANANA-GT": drop a trailing basin code glued on with a hyphen.
      const parts = token.split("-");
      return parts.length > 1 && DROP.has(parts[parts.length - 1]!.toUpperCase()) ? parts.slice(0, -1).join("-") : token;
    });
  const kept: string[] = [];
  const codes: string[] = [];
  tokens.forEach((token, i) => {
    const t = token.toUpperCase();
    if (DROP.has(t) && i > 0) return;
    if (LAKE_CODE.test(t) && i > 0) {
      codes.push(t.replace(/\s/g, ""));
      return;
    }
    const mapped = WORDS[t];
    if (mapped !== undefined) {
      // A lone "P" or "L" mid-name is an abbreviation; so is "R" at the end.
      if (mapped) kept.push(mapped);
      return;
    }
    kept.push(titleCase(token));
  });
  let pretty = kept.join(" ").replace(/\s+/g, " ").replace(/\( /g, "(").replace(/ \)/g, ")").replace(/\(\)/g, "").trim();
  if (qualifier) pretty = `${qualifier.split(" ").map(titleCase).join(" ")} ${pretty}`;
  if (codes.length > 0) pretty = pretty ? `${pretty} (${codes.join(", ")})` : codes.join(", ");
  return pretty || titleCase(raw);
}

export type DwrTrail = Trail & {
  waterKind: "lake" | "river";
  speciesCodes: string[];
  lastStocked: number;
  stockedFish: number;
};

function toTrail(row: DwrRow): DwrTrail {
  const [id, raw, kind, lat, lon, county, species, lastYear, hundreds] = row;
  const codes = (species.match(/.{2}/g) ?? []).filter((c) => c in DWR_SPECIES);
  const names = [...new Set(codes.map((c) => DWR_SPECIES[c]!.name.toLowerCase()))];
  const isLake = kind === "L";
  const noun = isLake ? (/RES/.test(raw) ? "reservoir" : /\bP(OND|ND)?\b|PONDS?/.test(raw) ? "pond" : "lake") : "stream";
  const list = names.length > 2 ? `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}` : names.join(" and ");

  return {
    id: `dwr-${id.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
    name: prettyName(raw),
    region: countyName(county),
    state: "UT",
    lat,
    lon,
    elevationFt: 0,
    gainFt: 0,
    distanceMi: 0,
    activities: ["fish"],
    surface: "mixed",
    aspect: "mixed",
    exposed: true,
    waterCrossings: 0,
    blurb: `A ${noun} Utah DWR stocks with ${list || "trout"}; last stocked in ${lastYear}.`,
    sourceName: "Utah DWR",
    sourceUrl: "https://dwrapps.utah.gov/fishstocking/Fish",
    waterKind: isLake ? "lake" : "river",
    speciesCodes: codes,
    lastStocked: lastYear,
    stockedFish: hundreds * 100,
  };
}

/**
 * All DWR waters as places, minus any that duplicate a hand-curated water
 * (curated entries carry a proper fishing guide and win).
 */
export function dwrTrails(curated: Trail[]): DwrTrail[] {
  const fishing = curated.filter((t) => t.activities.includes("fish"));
  const near = (a: { lat: number; lon: number }, b: { lat: number; lon: number }) =>
    Math.abs(a.lat - b.lat) < 0.03 && Math.abs(a.lon - b.lon) < 0.04;
  const firstWord = (s: string) => s.toLowerCase().split(/\s+/)[0] ?? "";

  const seen = new Map<string, number>();
  const out: DwrTrail[] = [];
  for (const row of DWR_WATERS) {
    const trail = toTrail(row);
    if (fishing.some((c) => near(c, trail) && firstWord(c.name) === firstWord(trail.name))) continue;
    // Several reaches of one river share a name; number them so each is distinct.
    const key = `${trail.name}|${trail.region}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) trail.name = `${trail.name} (reach ${count})`;
    out.push(trail);
  }
  return out;
}

export function isDwrTrail(trail: Trail): trail is DwrTrail {
  return (trail as Partial<DwrTrail>).speciesCodes !== undefined;
}
