/**
 * The Fish Dex: every species found across TrailCast's waters.
 *
 * Plain data with no dependencies, so it can be imported into client
 * components. Descriptions are written to help someone identify a fish in the
 * hand, which is the moment it matters -- several Utah waters require a
 * specific species to be released, and a cutthroat and a rainbow are easy to
 * confuse at a glance.
 */

export type SpeciesId =
  | "brown"
  | "rainbow"
  | "bonneville-cutthroat"
  | "bear-lake-cutthroat"
  | "brook"
  | "whitefish"
  | "kokanee";

export interface Species {
  id: SpeciesId;
  name: string;
  scientific: string;
  glyph: string;
  /** Native to Utah waters, or introduced. */
  native: boolean;
  /** How to tell it apart, especially from the fish it is most confused with. */
  identify: string;
  /** Typical size landed in Utah, not a record. */
  typicalSize: string;
  spawns: string;
  /** What it eats and how that changes the approach. */
  habits: string;
  /** Anything that changes whether you may keep it. */
  note?: string;
  photo: Photo;
}

export interface Photo {
  src: string;
  /** Who took it, as Wikimedia Commons credits them. */
  credit: string;
  license: "Public domain" | "CC BY-SA 4.0";
  /** The file's Commons page, which carries the full licence. */
  page: string;
  /** Set when the photo shows a close relative, not this exact fish. */
  caveat?: string;
}

const commons = (path: string) => {
  const file = path.split("/")[2]!;
  return {
    src: `https://upload.wikimedia.org/wikipedia/commons/thumb/${path}/500px-${file}`,
    page: `https://commons.wikimedia.org/wiki/File:${file}`,
  };
};

/*
 * Real photographs, from Wikimedia Commons. Public-domain images (mostly US
 * Fish and Wildlife Service and National Park Service) were preferred; the
 * two CC BY-SA photos are credited on screen as their licence requires.
 */
const PHOTOS: Record<SpeciesId, Photo> = {
  brown: {
    ...commons("2/27/Brown_Trout_(Salmo_trutta)_(53678765394).jpg"),
    credit: "USFWS Mountain-Prairie",
    license: "Public domain",
  },
  rainbow: {
    ...commons("c/c1/Close_up_of_rainbow_trout_fish_underwater_oncorhynchus_mykiss.jpg"),
    credit: "Eric Engbretson, USFWS",
    license: "Public domain",
  },
  "bonneville-cutthroat": {
    ...commons("4/49/Bonneville_cutthroat_october_2020.jpg"),
    credit: "BRTorgersen",
    license: "CC BY-SA 4.0",
  },
  "bear-lake-cutthroat": {
    ...commons("5/5d/Trout_cutthroat_fish_oncorhynchus_clarkii_clarkii.jpg"),
    credit: "Timothy Knepp, USFWS",
    license: "Public domain",
    caveat: "A coastal cutthroat, shown for the family markings; no free photo of the Bear Lake strain was available.",
  },
  brook: {
    ...commons("e/ee/Brook_trout_in_water.jpg"),
    credit: "Jay Fleming, US National Park Service",
    license: "Public domain",
  },
  whitefish: {
    ...commons("a/ae/Prosopium_williamsoni.jpg"),
    credit: "Woostermike, English Wikipedia",
    license: "Public domain",
  },
  kokanee: {
    ...commons("8/87/Kokanee_salmon.jpg"),
    credit: "Hemming1952",
    license: "CC BY-SA 4.0",
  },
};

const BASE: Record<SpeciesId, Omit<Species, "photo">> = {
  brown: {
    id: "brown",
    name: "Brown trout",
    scientific: "Salmo trutta",
    glyph: "\u{1F41F}",
    native: false,
    identify:
      "Golden-brown to buttery flanks with black and red spots, many ringed in pale blue or white halos. Few or no spots on the tail.",
    typicalSize: "10–18 in; larger fish are common in the Middle Provo and Green",
    spawns: "Fall (October–November)",
    habits:
      "The warmest-tolerant and wariest trout here. Feeds hardest at dawn, dusk and under cloud; big browns turn predatory and chase streamers, especially in the pre-spawn weeks of autumn.",
    note: "Introduced from Europe in the late 1800s. Avoid wading across gravel redds during the fall spawn.",
  },
  rainbow: {
    id: "rainbow",
    name: "Rainbow trout",
    scientific: "Oncorhynchus mykiss",
    glyph: "\u{1F308}",
    native: false,
    identify:
      "Silver sides with a pink-to-red band along the lateral line and small black spots scattered across the body AND the tail. No red slash under the jaw -- that is how you tell it from a cutthroat.",
    typicalSize: "10–16 in",
    spawns: "Spring",
    habits:
      "The most willing riser of the group and the most widely stocked. Holds in faster seams than browns and takes both dries and nymphs readily.",
  },
  "bonneville-cutthroat": {
    id: "bonneville-cutthroat",
    name: "Bonneville cutthroat",
    scientific: "Oncorhynchus clarkii utah",
    glyph: "\u{1F3F5}",
    native: true,
    identify:
      "A red-orange slash in the folds under the lower jaw. Larger, rounder black spots than a rainbow, concentrated toward the tail.",
    typicalSize: "8–16 in",
    spawns: "Late spring to early summer",
    habits:
      "Native to the Bonneville Basin and Utah's state fish. Less wary than browns and readily takes attractor dries and terrestrials in summer.",
    note: "Several waters require cutthroat to be released. Check the regulations for the water before keeping one.",
  },
  "bear-lake-cutthroat": {
    id: "bear-lake-cutthroat",
    name: "Bear Lake cutthroat",
    scientific: "Oncorhynchus clarkii utah (Bear Lake strain)",
    glyph: "\u{1F3F5}",
    native: true,
    identify:
      "A large, silvery cutthroat with the same red jaw slash and heavy spotting toward the tail; often paler than river cutthroat.",
    typicalSize: "15–25 in",
    spawns: "Spring",
    habits:
      "A predatory strain stocked in Strawberry to control Utah chub. Big fish cruise shallow in spring and fall and hit tube jigs, spoons and leech patterns.",
    note: "At Strawberry, every cutthroat from 15 to 22 inches must be released immediately -- they are the reservoir's chub control.",
  },
  brook: {
    id: "brook",
    name: "Brook trout",
    scientific: "Salvelinus fontinalis",
    glyph: "\u{1F7E2}",
    native: false,
    identify:
      "Technically a char. Dark olive back covered in pale worm-like markings, red spots with blue halos on the flanks, and lower fins edged in bright white.",
    typicalSize: "6–10 in",
    spawns: "Fall",
    habits: "Small-stream and high-lake fish, eager and unselective. Attractor dries and small nymphs are plenty.",
  },
  whitefish: {
    id: "whitefish",
    name: "Mountain whitefish",
    scientific: "Prosopium williamsoni",
    glyph: "\u{1F90D}",
    native: true,
    identify:
      "Silver, cylindrical and large-scaled, with a small down-turned mouth made for picking nymphs off the bottom. No spots.",
    typicalSize: "10–16 in",
    spawns: "Late fall",
    habits:
      "Often dismissed as a nuisance, but native and a sign of a healthy river. Feeds near the bottom year-round and keeps many winter days from being fishless.",
  },
  kokanee: {
    id: "kokanee",
    name: "Kokanee salmon",
    scientific: "Oncorhynchus nerka",
    glyph: "\u{1F534}",
    native: false,
    identify:
      "Landlocked sockeye. Bright silver with a blue-green back and almost no spots; in fall, spawning males turn red with a hooked jaw.",
    typicalSize: "12–18 in",
    spawns: "Fall, then die",
    habits:
      "Eats plankton, so it rarely takes a fly. Caught by trolling a dodger with a small squid or spinner at the depth the schools are holding, usually mid-summer.",
  },
};

export const SPECIES = Object.fromEntries(
  (Object.keys(BASE) as SpeciesId[]).map((id) => [id, { ...BASE[id], photo: PHOTOS[id] }]),
) as Record<SpeciesId, Species>;

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];
