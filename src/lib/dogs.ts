import type { Trail } from "./types";

/**
 * Can you bring the dog?
 *
 * This is the question that turns a good plan into a wasted drive, and it is
 * one people get wrong constantly in the Wasatch, because the rule is not
 * about the trail — it is about whose drinking water you are standing in.
 * Dogs are banned outright from Salt Lake City's protected watershed
 * canyons, which is why Lake Blanche is a no and Mount Olympus, one canyon
 * over, is a yes. Mill Creek is not culinary watershed, so dogs are fine
 * there; that inconsistency is the whole reason this needs stating per
 * place rather than per region.
 *
 * Every entry below cites the body whose rule it is. Where nobody has
 * checked, the field stays unset and the panel says so rather than
 * inventing a permission somebody might act on.
 */

const WATERSHED = "Salt Lake City protected watershed — dogs prohibited";
const NPS = "National Park Service — dogs are not allowed on park trails";
const FOREST = "Uinta-Wasatch-Cache National Forest — leash required";
const BLM = "BLM — leash required on developed trails";
const CITY = "County or city trail — leash required";

export const DOG_RULES: Record<string, { dogs: Trail["dogs"]; source: string }> = {
  // Little and Big Cottonwood, and Bells Canyon: culinary watershed.
  "lake-blanche": { dogs: "no", source: WATERSHED },
  "donut-falls": { dogs: "no", source: WATERSHED },
  "desolation-lake": { dogs: "no", source: WATERSHED },
  "wasatch-crest": { dogs: "no", source: `${WATERSHED} (the Mill Creek end allows them)` },
  "red-pine-lake": { dogs: "no", source: WATERSHED },
  "bells-canyon": { dogs: "no", source: WATERSHED },
  "big-cottonwood-creek": { dogs: "no", source: WATERSHED },
  "little-cottonwood-crag": { dogs: "no", source: WATERSHED },
  "gate-buttress-lcc": { dogs: "no", source: WATERSHED },
  "storm-mountain-bcc": { dogs: "no", source: WATERSHED },

  // National parks.
  "angels-landing": { dogs: "no", source: NPS },
  "delicate-arch": { dogs: "no", source: NPS },
  "zion-namaste-wall": { dogs: "no", source: NPS },

  // Forest Service and other public land: leash.
  "timpanogos-timpooneke": { dogs: "leash", source: FOREST },
  "stewart-falls": { dogs: "leash", source: FOREST },
  "mount-olympus": { dogs: "leash", source: FOREST },
  "american-fork-crag": { dogs: "leash", source: FOREST },
  "rock-canyon-provo": { dogs: "leash", source: FOREST },
  "logan-canyon-china-cave": { dogs: "leash", source: FOREST },
  "maple-canyon": { dogs: "leash", source: FOREST },
  "logan-river": { dogs: "leash", source: FOREST },
  "provo-river-middle": { dogs: "leash", source: FOREST },
  "provo-river-lower": { dogs: "leash", source: FOREST },
  "weber-river": { dogs: "leash", source: FOREST },
  "strawberry-reservoir": { dogs: "leash", source: FOREST },
  "fremont-river": { dogs: "leash", source: FOREST },

  "slickrock-moab": { dogs: "leash", source: BLM },
  "wall-street-moab": { dogs: "leash", source: BLM },
  "indian-creek-supercrack": { dogs: "leash", source: BLM },
  "chuckwalla-st-george": { dogs: "leash", source: BLM },
  "virgin-river-gorge": { dogs: "leash", source: BLM },
  "ibex-utah": { dogs: "leash", source: BLM },
  "joes-valley": { dogs: "leash", source: BLM },
  "green-river-a-section": { dogs: "leash", source: BLM },

  "y-mountain": { dogs: "leash", source: CITY },
  "corner-canyon": { dogs: "leash", source: `${CITY} (off-leash in Draper's designated areas)` },
  "bonneville-shoreline-slc": { dogs: "leash", source: CITY },
  "ogden-9th-street": { dogs: "leash", source: CITY },
};

/** Apply the rules to a curated set, leaving anything unlisted unset. */
export function withDogRules<T extends Trail>(trails: T[]): T[] {
  return trails.map((trail) => {
    const rule = DOG_RULES[trail.id];
    return rule ? { ...trail, dogs: rule.dogs, dogsSource: rule.source } : trail;
  });
}

/**
 * Paved surface and wheelchair access.
 *
 * Two different claims, kept apart on purpose. Paved says the surface is
 * hard; accessible says the grade and width are usable by someone in a
 * wheelchair or pushing a stroller — a far stronger statement that a
 * surface tag cannot support on its own. A trail is only marked accessible
 * where the land manager says it is, because getting this wrong strands
 * somebody at a trailhead.
 */
export const ACCESS_RULES: Record<string, { paved?: boolean; accessible?: Trail["accessible"]; source: string }> = {
  "bonneville-shoreline-slc": {
    paved: false,
    accessible: "no",
    source: "Dirt singletrack with steep pitches and no accessible section.",
  },
  "donut-falls": {
    paved: false,
    accessible: "partly",
    source: "The first half is a wide graded road-bed; the last stretch to the falls is rock scrambling.",
  },
  "delicate-arch": {
    paved: false,
    accessible: "no",
    source: "National Park Service — slickrock, exposure and 480 ft of climbing.",
  },
  "angels-landing": {
    paved: false,
    accessible: "no",
    source: "National Park Service — chains, exposure and 1,500 ft of climbing.",
  },
  "stewart-falls": { paved: false, accessible: "no", source: "Dirt trail with roots and a stream crossing." },
  "corner-canyon": { paved: false, accessible: "partly", source: "Draper's paved Porter Rockwell path connects to the dirt network." },
  "y-mountain": { paved: false, accessible: "no", source: "Steep switchbacked gravel, about 1,000 ft in a mile." },
  "timpanogos-timpooneke": { paved: false, accessible: "no", source: "Mountain trail, 4,400 ft of climbing." },
  "lake-blanche": { paved: false, accessible: "no", source: "Rocky mountain trail, 2,700 ft of climbing." },
  "mount-olympus": { paved: false, accessible: "no", source: "Steep rocky trail with scrambling near the summit." },
};

/** Apply surface and access facts to a curated set. */
export function withAccessRules<T extends Trail>(trails: T[]): T[] {
  return trails.map((trail) => {
    const rule = ACCESS_RULES[trail.id];
    if (!rule) return trail;
    return {
      ...trail,
      ...(rule.paved !== undefined ? { paved: rule.paved } : {}),
      ...(rule.accessible ? { accessible: rule.accessible } : {}),
      accessSource: rule.source,
    };
  });
}

/** What the detail panel says about surface and wheelchair access. */
export function accessSentence(trail: Trail): string {
  const surface = trail.paved === true ? "Paved." : trail.paved === false ? "Not paved." : "";
  const access =
    trail.accessible === "yes"
      ? "Wheelchair accessible."
      : trail.accessible === "partly"
        ? "Partly accessible."
        : trail.accessible === "no"
          ? "Not wheelchair accessible."
          : "Wheelchair access hasn't been checked for this one.";
  return [surface, access, trail.accessSource ?? ""].filter(Boolean).join(" ");
}

export const DOG_LABEL: Record<NonNullable<Trail["dogs"]>, string> = {
  yes: "Dogs OK",
  leash: "Leash",
  no: "No dogs",
};

/** What the detail panel says under the stat. */
export function dogSentence(trail: Trail): string {
  if (!trail.dogs) {
    return "Nobody has checked whether dogs are allowed here, so don't take this as permission — call the land manager.";
  }
  if (trail.dogs === "no") return `Dogs are not allowed. ${trail.dogsSource ?? ""}`.trim();
  if (trail.dogs === "leash") return `Dogs are allowed on a leash. ${trail.dogsSource ?? ""}`.trim();
  return `Dogs are allowed. ${trail.dogsSource ?? ""}`.trim();
}
