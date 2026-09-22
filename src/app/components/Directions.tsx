"use client";

export interface DirectionsProps {
  name: string;
  lat: number;
  lon: number;
}

/**
 * Hand-off to a real navigation app. TrailCast estimates drive time; it is
 * not a turn-by-turn router, so the honest move is to open one.
 *
 * Coordinates rather than the name go in the destination, because "Wall
 * Street" or "Ibex" typed into a maps search finds the wrong place. For areas
 * the point is the area's centre, which the note says.
 */
export default function Directions({ name, lat, lon }: DirectionsProps) {
  const point = `${lat.toFixed(5)},${lon.toFixed(5)}`;
  const google = `https://www.google.com/maps/dir/?api=1&destination=${point}&travelmode=driving`;
  const apple = `https://maps.apple.com/?daddr=${point}&dirflg=d&q=${encodeURIComponent(name)}`;

  return (
    <div className="directions">
      <span className="directions-label">Directions</span>
      <a href={google} target="_blank" rel="noreferrer noopener">
        Google Maps
      </a>
      <a href={apple} target="_blank" rel="noreferrer noopener">
        Apple Maps
      </a>
    </div>
  );
}
