import type { RockType, Trail } from "../types";
import { OB_AREAS, OB_REGIONS, type ObAreaRow } from "../data/openbetaAreas";

/**
 * Every climbing area in Utah, from OpenBeta.
 *
 * The hand-curated set was fifty-eight crags. OpenBeta records close to
 * sixteen thousand routes in Utah, and a reader who asks about Dogwood Crag
 * and is handed the La Sal Mountains has been failed twice over -- once by
 * the data and once by the answer. This is the data half.
 *
 * Routes are still fetched live per area, so a route added to OpenBeta this
 * morning shows up this morning. Only the list of *places* is a snapshot,
 * refreshed monthly by CI, because crags do not appear weekly.
 *
 * What OpenBeta does not carry is the attribute set the scoring engine wants:
 * approach, aspect, tree cover. Those stay hand-curated, and an imported crag
 * takes neutral values rather than invented ones -- the panel says where the
 * area came from so a reader can tell a surveyed entry from an imported one.
 */

export type ObTrail = Trail & { obUuid: string };

/**
 * Rock by region.
 *
 * Utah's geology is regional enough that this is a defensible inference
 * rather than a guess -- Indian Creek is Wingate sandstone, Little Cottonwood
 * is granite, American Fork is limestone -- and it matters, because wet
 * sandstone loses most of its strength and the rock rule has to know. Every
 * value set here is marked `inferred`, and the panel says so, because a
 * region is not a survey.
 */
const ROCK_BY_REGION: [RegExp, RockType][] = [
  [/little cottonwood|lone peak|bells canyon/i, "granite"],
  [/big cottonwood|ferguson|storm mountain/i, "quartzite"],
  [/american fork|rock canyon|logan canyon|maple canyon|hobble creek/i, "limestone"],
  [/maple canyon/i, "conglomerate"],
  [/indian creek|moab|potash|wall street|castle valley|kane springs|river road|zion|san rafael|escalante|capitol reef/i, "sandstone"],
  [/saint george|st\. george|moes valley|black rocks|chuckwalla|virgin river|snow canyon|utah hills|woodbury/i, "sandstone"],
  [/ibex|joes valley|joe's valley|triassic|san rafael swell/i, "sandstone"],
  [/uinta|bear river|stansbury/i, "quartzite"],
  [/city of rocks|three peaks|cedar city/i, "granite"],
];

function rockFor(region: string, name: string): RockType | undefined {
  const haystack = `${region} ${name}`;
  for (const [pattern, rock] of ROCK_BY_REGION) {
    if (pattern.test(haystack)) return rock;
  }
  return undefined;
}

function withDashes(uuid: string): string {
  return uuid.length === 32
    ? `${uuid.slice(0, 8)}-${uuid.slice(8, 12)}-${uuid.slice(12, 16)}-${uuid.slice(16, 20)}-${uuid.slice(20)}`
    : uuid;
}

function toTrail(row: ObAreaRow): ObTrail {
  const [uuid, name, regionIndex, lat, lon, routes] = row;
  const region = OB_REGIONS[regionIndex] ?? "Utah";
  const rock = rockFor(region, name);

  return {
    id: `obx-${uuid.slice(0, 12)}`,
    obUuid: withDashes(uuid),
    name,
    region,
    state: "UT",
    lat,
    lon,
    // OpenBeta carries none of these. Obvious defaults beat plausible
    // inventions: they feed only the daylight estimate, which for climbing is
    // dominated by time at the crag rather than the walk in.
    elevationFt: 0,
    gainFt: 200,
    distanceMi: 0.5,
    activities: ["climb"],
    surface: "rock",
    aspect: "mixed",
    exposed: true,
    waterCrossings: 0,
    rockType: rock,
    rockTypeSource: rock ? "inferred" : undefined,
    routes,
    blurb: `${routes} recorded route${routes === 1 ? "" : "s"} on OpenBeta, in ${region}. Approach and aspect aren't surveyed for this one.`,
    sourceName: "OpenBeta",
    sourceUrl: `https://openbeta.io/areas/${withDashes(uuid)}`,
  };
}

/**
 * All imported crags, minus any that duplicates a hand-curated area, and with
 * shared names disambiguated. Utah has several "North Wall"s.
 */
export function openbetaAreas(curated: Trail[]): ObTrail[] {
  const climbing = curated.filter((t) => t.activities.includes("climb"));
  const firstWord = (s: string) => s.toLowerCase().split(/\s+/)[0] ?? "";

  const seen = new Map<string, number>();
  const out: ObTrail[] = [];

  for (const row of OB_AREAS) {
    const trail = toTrail(row);
    const duplicate = climbing.some(
      (c) =>
        Math.abs(c.lat - trail.lat) < 0.01 &&
        Math.abs(c.lon - trail.lon) < 0.013 &&
        firstWord(c.name) === firstWord(trail.name),
    );
    if (duplicate) continue;

    const key = `${trail.name}|${trail.region}`;
    const count = (seen.get(key) ?? 0) + 1;
    seen.set(key, count);
    if (count > 1) trail.name = `${trail.name} (${count})`;
    out.push(trail);
  }
  return out;
}

export function isObTrail(trail: Trail): trail is ObTrail {
  return (trail as Partial<ObTrail>).obUuid !== undefined;
}
