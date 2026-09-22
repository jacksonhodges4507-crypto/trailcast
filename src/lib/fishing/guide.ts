import { SPECIES, type Species, type SpeciesId } from "./species";
import type { Trail } from "../types";
import { TRAILS } from "../trails";
import { DWR_SPECIES, isDwrTrail, type DwrTrail } from "./dwr";

/**
 * Per-water fishing guide: who lives there, what they are eating this month,
 * and what to tie on.
 *
 * Hatch timing is compiled from regional charts (Norrik's Provo River hatch
 * chart; Spinner Fall Guide Service's Green River calendar). Regulations are
 * quoted from Utah DWR's rules for specific waters. Both change -- hatches
 * shift with the year's weather and regulations are revised annually -- so
 * the panel says where they came from and to check before fishing.
 *
 * Suggestions here are flies and artificial lures only. Several of these
 * waters are artificial-only, and a guide that recommended bait on the Middle
 * Provo would be recommending a citation.
 */

export type WaterType = "tailwater" | "freestone" | "stillwater";

export interface Pick {
  name: string;
  /** Hook size for flies, weight for lures. */
  size?: string;
  why: string;
}

interface WaterInfo {
  type: WaterType;
  species: { id: SpeciesId; abundance: "primary" | "common" | "present" }[];
  regulations: string[];
  /** Month numbers (1-12) with a local event that overrides the calendar. */
  special?: { months: number[]; eating: string; fly: Pick }[];
  notes?: string[];
}

const WATERS: Record<string, WaterInfo> = {
  "provo-river-middle": {
    type: "tailwater",
    species: [
      { id: "brown", abundance: "primary" },
      { id: "rainbow", abundance: "common" },
      { id: "bonneville-cutthroat", abundance: "present" },
      { id: "whitefish", abundance: "common" },
    ],
    regulations: [
      "Artificial flies and lures only.",
      "Limit 2 trout under 15 inches.",
    ],
    special: [
      {
        months: [4, 5, 6],
        eating: "olive and golden stoneflies below Jordanelle",
        fly: { name: "Pat's Rubber Legs", size: "#8–10", why: "Stonefly nymphs are thick below the dam in spring." },
      },
    ],
    notes: ["One of the densest brown trout populations in the West — wary fish, so go small and long on the leader."],
  },
  "provo-river-lower": {
    type: "tailwater",
    species: [
      { id: "brown", abundance: "primary" },
      { id: "rainbow", abundance: "common" },
      { id: "whitefish", abundance: "common" },
    ],
    regulations: [
      "Artificial flies and lures only.",
      "Limit 2 trout under 15 inches.",
    ],
    notes: ["Warms faster than the Middle Provo in late summer — check the water temperature before a midday session."],
  },
  "weber-river": {
    type: "freestone",
    species: [
      { id: "brown", abundance: "primary" },
      { id: "rainbow", abundance: "common" },
      { id: "bonneville-cutthroat", abundance: "present" },
      { id: "whitefish", abundance: "common" },
    ],
    regulations: [
      "Upper river: artificial flies and lures only; limit 2 trout.",
      "Lower river: cutthroat, or trout with cutthroat markings, must be released immediately.",
    ],
  },
  "green-river-a-section": {
    type: "tailwater",
    species: [
      { id: "rainbow", abundance: "primary" },
      { id: "brown", abundance: "primary" },
    ],
    regulations: [
      "Smallmouth bass, burbot, walleye and northern pike may not be released — they must be kept and killed.",
      "Threatened and endangered native fish must be released immediately.",
    ],
    special: [
      {
        months: [5, 6],
        eating: "cicadas, which land clumsily and often",
        fly: { name: "Foam cicada", size: "#8–10", why: "The Green's signature late-spring event; fish look up for it." },
      },
      {
        months: [9],
        eating: "tricos and tiny olives (sight-fishing season)",
        fly: { name: "Trico spinner", size: "#20–22", why: "Peak trico month on the Green, with fish rising in the flats." },
      },
    ],
    notes: ["Famously clear and cold below the dam. Scuds are on the menu every month of the year."],
  },
  "logan-river": {
    type: "freestone",
    species: [
      { id: "bonneville-cutthroat", abundance: "primary" },
      { id: "brown", abundance: "common" },
      { id: "whitefish", abundance: "common" },
    ],
    regulations: [
      "Upper sections: artificial flies and lures only; limit 2 trout and whitefish combined.",
      "Upper areas are closed from January 1 until 6 a.m. on the second Saturday of July.",
    ],
    notes: ["A stronghold for native Bonneville cutthroat. Handle them wet and release them fast."],
  },
  "strawberry-reservoir": {
    type: "stillwater",
    species: [
      { id: "bear-lake-cutthroat", abundance: "primary" },
      { id: "rainbow", abundance: "common" },
      { id: "kokanee", abundance: "common" },
    ],
    regulations: [
      "Limit 4 trout or kokanee combined.",
      "All cutthroat from 15 to 22 inches must be released immediately.",
      "No more than 2 cutthroat under 15 inches, and no more than 1 over 22 inches.",
      "Trout and salmon may not be filleted, nor heads or tails removed, in the field.",
    ],
  },
  "big-cottonwood-creek": {
    type: "freestone",
    species: [
      { id: "brown", abundance: "common" },
      { id: "bonneville-cutthroat", abundance: "common" },
      { id: "brook", abundance: "present" },
      { id: "rainbow", abundance: "present" },
    ],
    regulations: ["No water-specific rules listed; Utah statewide regulations apply."],
    notes: ["Small, pocketed water — short, accurate casts beat distance."],
  },
  "fremont-river": {
    type: "freestone",
    species: [
      { id: "brown", abundance: "primary" },
      { id: "rainbow", abundance: "common" },
    ],
    regulations: ["No water-specific rules listed; Utah statewide regulations apply."],
    notes: ["Fishes best in spring and fall; midsummer afternoons get hot enough to stress fish."],
  },
};

// ---------------------------------------------------------------------------
// Monthly calendar for Utah trout rivers
// ---------------------------------------------------------------------------

interface MonthPlan {
  eating: string[];
  flies: Pick[];
}

const F = {
  zebraMidge: { name: "Zebra Midge", size: "#20–24", why: "Midges hatch every month of the year here." },
  griffiths: { name: "Griffith's Gnat", size: "#18–22", why: "For midges clustering on the surface." },
  bwoSpring: { name: "Parachute BWO", size: "#16–20", why: "Blue-winged olives, best on cloudy afternoons." },
  bwoFall: { name: "Parachute BWO", size: "#20–24", why: "Fall olives run smaller than spring ones." },
  rs2: { name: "RS2", size: "#20–22", why: "Emerging olive nymph, fished just under the film." },
  stoneNymph: { name: "Pat's Rubber Legs", size: "#8–10", why: "Stonefly nymphs crawl to the banks to hatch." },
  stimulator: { name: "Stimulator (yellow/orange)", size: "#10–14", why: "Covers golden stones and yellow sallies." },
  caddis: { name: "Elk Hair Caddis", size: "#14–16", why: "Caddis skitter at dusk through summer." },
  caddisPupa: { name: "Caddis pupa", size: "#16", why: "Fished on the swing before the evening hatch." },
  pmd: { name: "PMD Sparkle Dun", size: "#16–18", why: "Pale morning duns, the key summer mayfly." },
  pheasant: { name: "Pheasant Tail nymph", size: "#16–18", why: "The all-purpose mayfly nymph." },
  drake: { name: "Green Drake", size: "#10–12", why: "Short, big-bug hatch that brings up large fish." },
  hopper: { name: "Hopper or Chubby Chernobyl", size: "#8–12", why: "Grasshoppers blown into the water along grassy banks." },
  ant: { name: "Black ant", size: "#16–18", why: "Terrestrial fish eat all summer; flying-ant falls can be huge." },
  beetle: { name: "Foam beetle", size: "#14", why: "A reliable change-up when fish refuse hoppers." },
  trico: { name: "Trico spinner", size: "#20–22", why: "Morning spinner falls on slow water." },
  bugger: { name: "Woolly Bugger (olive/black)", size: "#6–10", why: "Pre-spawn browns turn aggressive and chase." },
  egg: { name: "Glo Bug egg", size: "#14–16", why: "Trout follow the fall spawn to eat drifting eggs." },
  scud: { name: "Scud / Ray Charles sowbug", size: "#14–18", why: "Tailwaters grow crustaceans year-round." },
};

const RIVER_CALENDAR: Record<number, MonthPlan> = {
  1: { eating: ["midges"], flies: [F.zebraMidge, F.griffiths] },
  2: { eating: ["midges", "the first blue-winged olives on warm days"], flies: [F.zebraMidge, F.rs2] },
  3: { eating: ["midges", "blue-winged olives"], flies: [F.bwoSpring, F.rs2, F.zebraMidge] },
  4: { eating: ["blue-winged olives", "stonefly nymphs", "early caddis"], flies: [F.bwoSpring, F.stoneNymph, F.caddisPupa] },
  5: { eating: ["caddis", "stoneflies", "yellow sallies"], flies: [F.caddis, F.stimulator, F.stoneNymph] },
  6: { eating: ["pale morning duns", "caddis", "golden stones", "green drakes"], flies: [F.pmd, F.drake, F.stimulator, F.caddis] },
  7: { eating: ["pale morning duns", "caddis", "yellow sallies", "the first grasshoppers"], flies: [F.pmd, F.caddis, F.stimulator, F.hopper] },
  8: { eating: ["grasshoppers, ants and beetles", "pale morning duns", "caddis"], flies: [F.hopper, F.ant, F.beetle, F.pmd] },
  9: { eating: ["grasshoppers and ants", "tricos", "the return of fall olives"], flies: [F.hopper, F.ant, F.trico, F.bwoFall] },
  10: { eating: ["blue-winged olives", "midges", "sculpins and small fish (pre-spawn browns hunt them)"], flies: [F.bwoFall, F.bugger, F.zebraMidge] },
  11: { eating: ["blue-winged olives", "midges", "drifting trout eggs"], flies: [F.bwoFall, F.egg, F.bugger] },
  12: { eating: ["midges"], flies: [F.zebraMidge, F.griffiths] },
};

const RIVER_LURES: Pick[] = [
  { name: "Panther Martin or Blue Fox spinner", size: "1/16–1/8 oz", why: "Cast across and retrieve through seams and pocket water." },
  { name: "Rapala Countdown (brown trout pattern)", size: "CD3–CD5", why: "Imitates the small fish big browns hunt; best in low light." },
];

const FALL_LURE: Pick = {
  name: "Jerkbait or larger spinner",
  size: "1/4 oz",
  why: "Pre-spawn browns strike from aggression, not hunger — go bigger in October.",
};

const STILLWATER: Record<"ice" | "iceOff" | "summer" | "fall", MonthPlan & { lures: Pick[] }> = {
  ice: {
    eating: ["zooplankton and chubs under the ice"],
    flies: [],
    lures: [
      { name: "Ice jig with a soft-plastic grub", size: "1/16–1/8 oz", why: "Jig slowly just off the bottom." },
      { name: "Small spoon", size: "1/8 oz", why: "Flash draws cutthroat through the ice." },
    ],
  },
  iceOff: {
    eating: ["chironomids (midges)", "leeches", "chubs in the shallows"],
    flies: [
      { name: "Chironomid under an indicator", size: "#14–18", why: "The dominant food right after ice-off." },
      { name: "Balanced leech", size: "#10–12", why: "Suspended leeches draw cruising cutthroat." },
    ],
    lures: [
      { name: "Tube jig (white or smoke)", size: "1/8–1/4 oz", why: "The classic Strawberry cutthroat bait: imitates a chub." },
      { name: "Kastmaster", size: "1/4 oz", why: "Cover water from shore while fish are shallow." },
    ],
  },
  summer: {
    eating: ["damselfly nymphs", "leeches", "chubs, and plankton for kokanee"],
    flies: [
      { name: "Damselfly nymph", size: "#10–12", why: "Early summer migrations along the weed beds." },
      { name: "Woolly Bugger", size: "#8", why: "Strip it along drop-offs as fish move deeper." },
    ],
    lures: [
      { name: "Dodger + small squid, trolled", size: "1–1.5 mph", why: "The standard kokanee rig; find the depth of the school." },
      { name: "Tube jig or flatfish, trolled", size: "1/8 oz", why: "Cutthroat hold deeper as the surface warms." },
    ],
  },
  fall: {
    eating: ["chubs", "leeches", "fall midges"],
    flies: [
      { name: "Olive leech or bugger", size: "#8–10", why: "Cutthroat return to the shallows to feed hard before ice." },
    ],
    lures: [
      { name: "Tube jig", size: "1/8–1/4 oz", why: "Big cutthroat cruise shallow points again in fall." },
      { name: "Jake's Spin-A-Lure", size: "1/4 oz", why: "Flash-and-wobble spoon for cruising fish from shore." },
    ],
  },
};

function stillwaterSeason(month: number): keyof typeof STILLWATER {
  if (month === 12 || month <= 3) return "ice";
  if (month <= 5) return "iceOff";
  if (month <= 8) return "summer";
  return "fall";
}

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

export interface FishingGuide {
  month: string;
  type: WaterType;
  species: (Species & { abundance: "primary" | "common" | "present" })[];
  eating: string[];
  flies: Pick[];
  lures: Pick[];
  regulations: string[];
  notes: string[];
  sources: { name: string; url: string }[];
}

const SOURCES = [
  { name: "Utah DWR rules for specific waters", url: "https://www.eregulations.com/utah/fishing/rules-for-specific-waters" },
  { name: "Norrik Provo River hatch chart", url: "https://norrik.com/fly-hatches/provo-river-hatch-chart/" },
  { name: "Spinner Fall Green River calendar", url: "https://www.spinnerfall.com/green-river-calendar" },
];

/* ------------------------------------------------------------------ *
 * DWR waters
 *
 * Utah DWR stocks and surveys about a thousand waters that nobody has
 * hand-written a hatch chart for. Rather than show those anglers nothing,
 * we build a guide from what DWR does publish: the species in the water and
 * whether it is a lake or a stream. The panel says plainly that this is the
 * general seasonal pattern, not local knowledge.
 * ------------------------------------------------------------------ */

/** Lures by DWR species code, for the warmwater fish the trout calendars miss. */
const WARM_LURES: Record<string, Pick[]> = {
  LM: [
    { name: "Wacky-rigged Senko", size: "4–5 in", why: "Largemouth sit in weeds and timber; a slow fall gets bit." },
    { name: "Squarebill crankbait", size: "1/4–1/2 oz", why: "Cover shoreline water fast to find the active fish." },
  ],
  SM: [
    { name: "Tube jig (green pumpkin)", size: "1/8–1/4 oz", why: "Smallmouth eat crayfish; drag it along rock." },
    { name: "Ned rig", size: "1/16–1/8 oz", why: "The reliable answer when they are picky on clear water." },
  ],
  CC: [
    { name: "Nightcrawler or chicken liver on a bottom rig", size: "1/2–1 oz sinker", why: "Catfish hunt the bottom by smell, best after dark." },
  ],
  WE: [
    { name: "Jig tipped with a nightcrawler", size: "1/8–1/4 oz", why: "The standard walleye presentation along drop-offs." },
    { name: "Bottom bouncer and crawler harness", size: "1–2 oz", why: "Troll it to cover flats at low light." },
  ],
  WI: [
    { name: "White swimbait or casting spoon", size: "1/2 oz", why: "Wipers chase bait schools — match the flash and retrieve fast." },
  ],
  WB: [
    { name: "Small silver spoon or curly-tail grub", size: "1/8–1/4 oz", why: "White bass school tight; once you find one there are fifty." },
  ],
  KC: [
    { name: "Small tube or marabou jig under a float", size: "1/32–1/16 oz", why: "Crappie suspend around brush; hover the jig at their depth." },
  ],
  YP: [
    { name: "Small jig tipped with a piece of worm", size: "1/32–1/16 oz", why: "Perch feed on the bottom in schools, hard through the ice." },
  ],
  BG: [
    { name: "Piece of worm under a bobber", size: "#8 hook", why: "The easiest fish in Utah to catch, and the best one to start a kid on." },
  ],
  TM: [
    { name: "Large inline spinner or jerkbait", size: "6–8 in", why: "Tiger muskie ambush big prey; use a wire leader and a long-nose release." },
  ],
};

const DEEP_LAKER: Pick = {
  name: "White tube jig, jigged deep",
  size: "1–2 oz",
  why: "Lake trout hold 60–100 ft down most of the year; get to the bottom.",
};

const COLDWATER_CODES = new Set(["RB", "BC", "CR", "BL", "CT", "BK", "BN", "TG", "SP", "LT", "KO", "GR"]);

const DWR_SOURCES = [
  { name: "Utah DWR fish stocking reports", url: "https://dwrapps.utah.gov/fishstocking/Fish" },
  { name: "Utah Fishing Guidebook", url: "https://wildlife.utah.gov/guidebooks.html" },
];

let dwrIndex: Map<string, DwrTrail> | null = null;

function dwrWater(trailId: string): DwrTrail | null {
  if (!trailId.startsWith("dwr-")) return null;
  if (!dwrIndex) {
    dwrIndex = new Map();
    for (const trail of TRAILS) if (isDwrTrail(trail)) dwrIndex.set(trail.id, trail);
  }
  return dwrIndex.get(trailId) ?? null;
}

/** The Dex entries a DWR water holds, in the order DWR lists them. */
export function dexIdsFor(trail: Trail): SpeciesId[] {
  if (!isDwrTrail(trail)) return [];
  const ids: SpeciesId[] = [];
  for (const code of trail.speciesCodes) {
    const dex = DWR_SPECIES[code]?.dex;
    if (dex && dex in SPECIES && !ids.includes(dex as SpeciesId)) ids.push(dex as SpeciesId);
  }
  return ids;
}

function dwrGuide(trail: DwrTrail, month: number, thisYear: number): FishingGuide {
  const codes = trail.speciesCodes;
  const cold = codes.filter((c) => COLDWATER_CODES.has(c));
  const warm = codes.filter((c) => c in WARM_LURES);
  const lake = trail.waterKind === "lake";

  let eating: string[] = [];
  let flies: Pick[] = [];
  let lures: Pick[] = [];

  if (cold.length > 0) {
    if (lake) {
      const plan = STILLWATER[stillwaterSeason(month)];
      eating = [...plan.eating];
      flies = [...plan.flies];
      lures = [...plan.lures];
    } else {
      const plan = RIVER_CALENDAR[month] ?? RIVER_CALENDAR[1]!;
      eating = [...plan.eating];
      flies = [...plan.flies];
      lures = [...RIVER_LURES];
    }
    if (codes.includes("LT")) lures.push(DEEP_LAKER);
  }

  if (warm.length > 0) {
    eating.push("crayfish, and the small baitfish these fish school on");
    for (const code of warm) lures.push(...(WARM_LURES[code] ?? []));
    if (cold.length === 0) {
      flies = [];
      eating = [
        "crayfish and small baitfish",
        lake ? "insects blown onto the shallows on warm evenings" : "whatever the current sweeps past them",
      ];
    }
  }

  if (eating.length === 0) eating = ["whatever the water is producing — nobody has surveyed the hatch here"];

  const species = dexIdsFor(trail).map((id, i) => ({
    ...SPECIES[id],
    abundance: (i === 0 ? "primary" : "common") as "primary" | "common" | "present",
  }));

  const stale = thisYear - trail.lastStocked;
  const notes = [
    "This is the general seasonal pattern for a Utah " +
      (lake ? "stillwater" : "stream") +
      ", not local knowledge of this particular water — treat it as a starting point.",
  ];
  if (trail.stockedFish > 0 && stale <= 2) {
    notes.push(`DWR put about ${trail.stockedFish.toLocaleString("en-US")} fish in here in ${trail.lastStocked}.`);
  } else if (stale > 2) {
    notes.push(`No stocking on record since ${trail.lastStocked}, so what is left here is holdover or wild fish.`);
  }

  const dedupe = (items: Pick[]) =>
    items.filter((item, i) => items.findIndex((other) => other.name === item.name) === i);

  return {
    month: MONTHS[month - 1] ?? "",
    type: lake ? "stillwater" : "freestone",
    species,
    eating: [...new Set(eating)],
    flies: dedupe(flies).slice(0, 5),
    lures: dedupe(lures).slice(0, 5),
    regulations: [
      "Statewide rules apply unless a sign at the water says otherwise.",
      "Check the current Utah Fishing Guidebook before you go — limits change year to year.",
    ],
    notes,
    sources: DWR_SOURCES,
  };
}

/** Every water that holds a species, for the Dex's "where to find it". */
export function watersFor(speciesId: SpeciesId): string[] {
  return Object.entries(WATERS)
    .filter(([, info]) => info.species.some((s) => s.id === speciesId))
    .map(([id]) => id);
}

/**
 * Every water that holds a species, curated waters first, then the DWR
 * records. Sorted so the biggest stockings lead — a Dex entry for walleye
 * should open on Willard Bay, not on an unnamed pond.
 */
const waterCache = new Map<SpeciesId, string[]>();

export function allWatersFor(speciesId: SpeciesId): string[] {
  const cached = waterCache.get(speciesId);
  if (cached) return cached;
  const dwr = TRAILS.filter(
    (t): t is DwrTrail => isDwrTrail(t) && dexIdsFor(t).includes(speciesId),
  )
    .sort((a, b) => b.stockedFish - a.stockedFish)
    .map((t) => t.id);
  const all = [...watersFor(speciesId), ...dwr];
  waterCache.set(speciesId, all);
  return all;
}

export function hasGuide(trailId: string): boolean {
  return trailId in WATERS || dwrWater(trailId) !== null;
}

/** Does this water hold the species? Covers curated waters and DWR records. */
export function holdsSpecies(trail: Trail, speciesId: SpeciesId): boolean {
  if (isDwrTrail(trail)) return dexIdsFor(trail).includes(speciesId);
  return WATERS[trail.id]?.species.some((s) => s.id === speciesId) ?? false;
}

/**
 * Build the guide for a water on a date. Returns null for places with no
 * fishing data rather than inventing a plausible-looking one.
 */
export function fishingGuide(trailId: string, isoDate: string): FishingGuide | null {
  const month = Number(isoDate.slice(5, 7));
  if (!Number.isInteger(month) || month < 1 || month > 12) return null;

  const info = WATERS[trailId];
  if (!info) {
    const water = dwrWater(trailId);
    if (!water) return null;
    return dwrGuide(water, month, Number(isoDate.slice(0, 4)) || water.lastStocked);
  }

  let eating: string[];
  let flies: Pick[];
  let lures: Pick[];

  if (info.type === "stillwater") {
    const plan = STILLWATER[stillwaterSeason(month)];
    eating = [...plan.eating];
    flies = [...plan.flies];
    lures = [...plan.lures];
  } else {
    const plan = RIVER_CALENDAR[month] ?? RIVER_CALENDAR[1]!;
    eating = [...plan.eating];
    flies = [...plan.flies];
    lures = month >= 9 && month <= 11 ? [...RIVER_LURES, FALL_LURE] : [...RIVER_LURES];

    // Tailwaters grow scuds and sowbugs all year.
    if (info.type === "tailwater") {
      eating.push("scuds and sowbugs");
      flies.push(F.scud);
    }
  }

  // Local events lead: a cicada fall on the Green matters more than the
  // generic calendar.
  for (const event of info.special ?? []) {
    if (!event.months.includes(month)) continue;
    eating.unshift(event.eating);
    flies.unshift(event.fly);
  }

  const dedupe = (items: Pick[]) =>
    items.filter((item, i) => items.findIndex((other) => other.name === item.name) === i);

  return {
    month: MONTHS[month - 1] ?? "",
    type: info.type,
    species: info.species.map((s) => ({ ...SPECIES[s.id], abundance: s.abundance })),
    eating: [...new Set(eating)],
    flies: dedupe(flies).slice(0, 5),
    lures: dedupe(lures),
    regulations: info.regulations,
    notes: info.notes ?? [],
    sources: SOURCES,
  };
}
