/** Great-circle distance in metres (haversine). */
export function distanceM(aLat: number, aLng: number, bLat: number, bLng: number): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(bLat - aLat);
  const dLng = toRad(bLng - aLng);
  const s =
    Math.sin(dLat / 2) ** 2 + Math.cos(toRad(aLat)) * Math.cos(toRad(bLat)) * Math.sin(dLng / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(s))));
}

export interface Fence {
  id: string;
  name: string;
  lat: number;
  lng: number;
  radiusM: number;
}

/**
 * The nearest fence that contains the point, allowing for the phone's
 * reported accuracy (capped at 100 m so a vague fix cannot widen the fence a lot).
 */
export function insideFence(
  lat: number,
  lng: number,
  accuracyM: number | null | undefined,
  fences: Fence[],
): { fence: Fence; distanceM: number } | null {
  const slack = Math.min(Math.max(accuracyM ?? 0, 0), 100);
  let best: { fence: Fence; distanceM: number } | null = null;
  for (const f of fences) {
    const d = distanceM(lat, lng, f.lat, f.lng);
    if (d <= f.radiusM + slack && (!best || d < best.distanceM)) best = { fence: f, distanceM: d };
  }
  return best;
}

export function validLatLng(lat: unknown, lng: unknown): boolean {
  return (
    typeof lat === 'number' && typeof lng === 'number' &&
    Number.isFinite(lat) && Number.isFinite(lng) &&
    lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180 &&
    !(lat === 0 && lng === 0)
  );
}
