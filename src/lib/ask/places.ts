import type { LatLon } from "../geo";

export interface Place extends LatLon {
  label: string;
  aliases: string[];
}

/**
 * A tiny gazetteer. Deliberately small and explicit: a production build would
 * hand this to a geocoder, but pinning the handful of origins our dataset
 * actually serves keeps the demo fast, free and offline-testable.
 */
export const PLACES: Place[] = [
  { label: "Salt Lake City", lat: 40.7608, lon: -111.891, aliases: ["slc", "salt lake", "salt lake city", "the city"] },
  { label: "Provo", lat: 40.2338, lon: -111.6585, aliases: ["provo", "utah valley", "uvu", "byu", "orem"] },
  { label: "Park City", lat: 40.6461, lon: -111.498, aliases: ["park city", "pc"] },
  { label: "Draper", lat: 40.5247, lon: -111.8638, aliases: ["draper", "south valley"] },
  { label: "Moab", lat: 38.5733, lon: -109.5498, aliases: ["moab"] },
  { label: "St. George", lat: 37.0965, lon: -113.5684, aliases: ["st george", "saint george", "southern utah"] },
  { label: "Ogden", lat: 41.223, lon: -111.9738, aliases: ["ogden", "north valley"] },
  { label: "Sandy", lat: 40.5649, lon: -111.8389, aliases: ["sandy", "cottonwood heights"] },
];

export function findPlace(text: string): Place | undefined {
  const haystack = text.toLowerCase();
  let best: Place | undefined;
  let bestLength = 0;

  for (const place of PLACES) {
    for (const alias of place.aliases) {
      if (haystack.includes(alias) && alias.length > bestLength) {
        best = place;
        bestLength = alias.length;
      }
    }
  }

  return best;
}
