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
  | "kokanee"
  | "colorado-cutthroat"
  | "tiger-trout"
  | "splake"
  | "lake-trout"
  | "grayling"
  | "channel-catfish"
  | "bluegill"
  | "crappie"
  | "largemouth"
  | "smallmouth"
  | "walleye"
  | "wiper"
  | "tiger-muskie"
  | "yellow-perch";

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
  license: "Public domain" | "CC BY-SA 4.0" | "CC BY-SA 2.5";
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
  "colorado-cutthroat": { ...commons("b/b6/Colo_river_cutthroat_BLM.jpg"), credit: "US Bureau of Land Management", license: "Public domain" },
  "tiger-trout": { ...commons("3/3f/TigerTrout2.jpg"), credit: "TyreeUM", license: "Public domain" },
  splake: { ...commons("a/ab/Splake_-_33749890944.jpg"), credit: "USFWS Midwest Region", license: "Public domain" },
  "lake-trout": { ...commons("b/ba/Lake_trout_fishes_salvelinus_namaycush.jpg"), credit: "Timothy Knepp, USFWS", license: "Public domain" },
  grayling: { ...commons("0/07/Underwater_Arctic_Grayling.jpg"), credit: "AKSMITH, English Wikipedia", license: "CC BY-SA 2.5" },
  "channel-catfish": { ...commons("3/38/Channel_Catfish_(Ictalurus_punctatus)_white_background.jpg"), credit: "USFWS Mountain-Prairie", license: "Public domain" },
  bluegill: { ...commons("d/d4/Bluegill_(cropped).jpg"), credit: "Paleo1954", license: "CC BY-SA 4.0" },
  crappie: { ...commons("3/38/Black_crappie.jpg"), credit: "US Fish and Wildlife Service", license: "Public domain" },
  largemouth: { ...commons("f/fb/Largemouth_Bass_(Micropterus_salmoides)_June_2023_(cropped).jpg"), credit: "USFWS Mountain-Prairie", license: "Public domain" },
  smallmouth: { ...commons("f/f3/Smallmouth_Bass_(49561724026).jpg"), credit: "USFWS Mountain-Prairie", license: "Public domain" },
  walleye: { ...commons("4/41/Walleye_(Sander_vitreus)_(1).jpg"), credit: "USFWS Mountain-Prairie", license: "Public domain" },
  wiper: { ...commons("c/c1/Hybrid_striped_bass_(51254193135).jpg"), credit: "USFWS Mountain-Prairie", license: "Public domain" },
  "tiger-muskie": { ...commons("5/59/Tiger_muskellunge_(Duane_Raver).png"), credit: "Duane Raver, USFWS", license: "Public domain" },
  "yellow-perch": { ...commons("c/c7/Yellow_Perch_(Perca_flavescens)_(cropped).jpg"), credit: "USFWS Mountain-Prairie", license: "Public domain" },
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
  "colorado-cutthroat": {
    id: "colorado-cutthroat",
    name: "Colorado River cutthroat",
    scientific: "Oncorhynchus clarkii pleuriticus",
    glyph: "🟠",
    native: true,
    identify:
      "The most colourful of Utah's cutthroat: a vivid red-orange slash under the jaw, golden to crimson flanks, and spots bunched toward the tail.",
    typicalSize: "8–14 in",
    spawns: "Late spring to early summer",
    habits:
      "Native to the Colorado River side of Utah. Lives in small, cold headwater streams and high lakes in the Uintas and southern mountains, and rises readily to dry flies.",
  },
  "tiger-trout": {
    id: "tiger-trout",
    name: "Tiger trout",
    scientific: "Salmo trutta × Salvelinus fontinalis",
    glyph: "🐯",
    native: false,
    identify: "A brown × brook trout hybrid covered in a maze-like, worm-track pattern from head to tail. No other trout looks like it.",
    typicalSize: "10–20 in",
    spawns: "Sterile; does not spawn",
    habits:
      "An aggressive predator DWR stocks to eat chubs and other unwanted fish. Hits streamers, spoons and spinners harder than most trout.",
  },
  splake: {
    id: "splake",
    name: "Splake",
    scientific: "Salvelinus namaycush × S. fontinalis",
    glyph: "🔷",
    native: false,
    identify:
      "A lake trout × brook trout hybrid. Pale spots on a dark body, and a tail forked less than a lake trout's but more than a brook trout's.",
    typicalSize: "12–20 in",
    spawns: "Fall (rarely successful)",
    habits: "Likes cold, deep lakes. A favourite through the ice on tube jigs tipped with sucker meat.",
  },
  "lake-trout": {
    id: "lake-trout",
    name: "Lake trout",
    scientific: "Salvelinus namaycush",
    glyph: "🗻",
    native: false,
    identify: "Grey-green with cream spots, no red or pink anywhere, and a deeply forked tail.",
    typicalSize: "20–40 in",
    spawns: "Fall, over rocky reefs",
    habits:
      "Utah's biggest trout, at Flaming Gorge, Bear Lake and Fish Lake. Deep in summer, so it takes jigs or deep trolling; shallow at ice-off and ice-up.",
  },
  grayling: {
    id: "grayling",
    name: "Arctic grayling",
    scientific: "Thymallus arcticus",
    glyph: "⛵",
    native: false,
    identify: "Unmistakable sail-like dorsal fin speckled in iridescent blue and pink, and a small, delicate mouth.",
    typicalSize: "8–14 in",
    spawns: "Spring, just after ice-off",
    habits: "A high-lake fish, mostly in the Uintas. Feeds on insects at the surface; small dry flies and nymphs work best.",
  },
  "channel-catfish": {
    id: "channel-catfish",
    name: "Channel catfish",
    scientific: "Ictalurus punctatus",
    glyph: "🐱",
    native: false,
    identify: "Whisker-like barbels, smooth scaleless skin, a deeply forked tail, and scattered dark spots on younger fish.",
    typicalSize: "2–10 lb",
    spawns: "Early summer",
    habits:
      "A bottom feeder that bites best at dusk and after dark in warm water. Nightcrawlers, chicken liver or cut bait on the bottom.",
  },
  bluegill: {
    id: "bluegill",
    name: "Bluegill",
    scientific: "Lepomis macrochirus",
    glyph: "🔵",
    native: false,
    identify: "A small, round sunfish with a dark flap at the back of the gill cover and faint vertical bars; breeding males have orange breasts.",
    typicalSize: "5–8 in",
    spawns: "Late spring into summer, in shallow nests",
    habits: "Easy to catch near docks and weed edges on small worms, tiny jigs or little poppers. The best fish for getting kids hooked.",
  },
  crappie: {
    id: "crappie",
    name: "Crappie",
    scientific: "Pomoxis spp.",
    glyph: "⚪",
    native: false,
    identify: "Silvery and speckled black, with large dorsal and anal fins and a big, paper-thin mouth.",
    typicalSize: "7–12 in",
    spawns: "Spring",
    habits: "Schools around brush, docks and drop-offs. Small tube jigs and minnows, fished slowly.",
  },
  largemouth: {
    id: "largemouth",
    name: "Largemouth bass",
    scientific: "Micropterus salmoides",
    glyph: "🟩",
    native: false,
    identify: "Green with a dark horizontal band down the side; the upper jaw reaches past the back of the eye.",
    typicalSize: "1–4 lb",
    spawns: "Spring",
    habits: "Hides in weeds and cover in warm water. Soft plastics, spinnerbaits, and topwater lures at dawn and dusk.",
  },
  smallmouth: {
    id: "smallmouth",
    name: "Smallmouth bass",
    scientific: "Micropterus dolomieu",
    glyph: "🟫",
    native: false,
    identify: "Bronze-brown with dark vertical bars and red eyes; the jaw stops at the eye, unlike a largemouth's.",
    typicalSize: "1–3 lb",
    spawns: "Spring",
    habits: "Rocky shorelines and points. Tubes, jigs and crankbaits.",
    note: "In some Utah waters smallmouth must be kept, not released, to protect native fish. Check the rules for the water you are on.",
  },
  walleye: {
    id: "walleye",
    name: "Walleye",
    scientific: "Sander vitreus",
    glyph: "👁️",
    native: false,
    identify: "Large, glassy eyes, sharp teeth, golden-olive flanks and a white tip on the lower lobe of the tail.",
    typicalSize: "15–24 in",
    spawns: "Early spring",
    habits: "Feeds in low light. A jig tipped with a nightcrawler, or a crankbait along drop-offs at dusk.",
  },
  wiper: {
    id: "wiper",
    name: "Wiper",
    scientific: "Morone saxatilis × M. chrysops",
    glyph: "⚡",
    native: false,
    identify: "A white bass × striped bass hybrid: silver with broken dark stripes running nose to tail.",
    typicalSize: "2–8 lb",
    spawns: "Sterile; does not spawn",
    habits: "Hunts baitfish in open-water schools. Watch for surface boils, then throw white swimbaits, spoons or topwater.",
  },
  "tiger-muskie": {
    id: "tiger-muskie",
    name: "Tiger muskie",
    scientific: "Esox masquinongy × E. lucius",
    glyph: "🦈",
    native: false,
    identify: "Long and torpedo-shaped with dark tiger-stripe bars, a duck-bill mouth and a lot of teeth.",
    typicalSize: "30–40 in",
    spawns: "Sterile; does not spawn",
    habits: "An ambush predator on weed edges. Large inline spinners, jerkbaits or big streamers, and a wire or heavy leader.",
    note: "Utah limits on tiger muskie are strict (historically one fish, over 40 inches). Check the current guidebook before keeping one.",
  },
  "yellow-perch": {
    id: "yellow-perch",
    name: "Yellow perch",
    scientific: "Perca flavescens",
    glyph: "🟡",
    native: false,
    identify: "Yellow with six to eight dark vertical bars and orange lower fins.",
    typicalSize: "6–10 in",
    spawns: "Spring",
    habits: "Schools near the bottom. Small jigs tipped with worm or perch meat, especially through the ice.",
  },
};

export const SPECIES = Object.fromEntries(
  (Object.keys(BASE) as SpeciesId[]).map((id) => [id, { ...BASE[id], photo: PHOTOS[id] }]),
) as Record<SpeciesId, Species>;

export const SPECIES_IDS = Object.keys(SPECIES) as SpeciesId[];
