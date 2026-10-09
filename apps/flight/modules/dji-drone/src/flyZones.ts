// DJI FlySafe zones (as the Android module reports them) turned into flight-core's NoFlyZone, which
// the pre-flight check uses: restricted zones block, authorisation zones block until unlocked in
// DJI Fly, warning zones warn, and height zones allow flights that stay below their limit.

import type { NoFlyZone } from "../../../../../packages/flight-core/src/safety.ts";
import type { NativeFlyZone } from "./DjiDrone.types.ts";

const TYPE_NAMES: Record<string, string> = {
  AIRPORT: "airport",
  COMMERCIAL_AIRPORTS: "airport",
  PRIVATE_COMMERCIAL_AIRPORTS: "airport",
  RECREATIONAL_AIRPORTS: "airfield",
  PRIVATE_RECREATIONAL_AIRPORTS: "airfield",
  UNPAVED_AIRPORT: "airfield",
  HELIPORT: "heliport",
  MILITARY: "military site",
  PRISON: "prison",
  POWER_PLANT: "power station",
  NUCLEAR_POWER_PLANT: "nuclear power station",
  NATIONAL_PARKS: "national park",
  SCHOOL: "school",
  STADIUM: "stadium",
  TEMPORARY_FLIGHT_RESTRICTIONS: "temporary flight restriction",
};

function kindOf(category: string | null): NoFlyZone["kind"] {
  if (category === "RESTRICTED") return "restricted";
  if (category === "AUTHORIZATION") return "authorisation";
  return "warning";
}

export function flyZonesFromDji(zones: NativeFlyZone[]): NoFlyZone[] {
  const out: NoFlyZone[] = [];
  for (const z of zones) {
    const what = z.type ? TYPE_NAMES[z.type] : undefined;
    const name = `DJI zone "${z.name || "unnamed"}"${what ? ` (${what})` : ""}`;
    const kind = kindOf(z.category);
    if (z.areas.length > 0) {
      for (const a of z.areas) {
        const heightLimitM = a.limitM > 0 ? a.limitM : undefined;
        if (a.points.length >= 3) out.push({ name, kind, polygon: a.points.map(([lat, lng]) => ({ lat, lng })), heightLimitM });
        else if (a.circle) out.push({ name, kind, circle: { center: { lat: a.circle.lat, lng: a.circle.lng }, radiusM: a.circle.radiusM }, heightLimitM });
      }
    } else if (z.circle) {
      // A zone that starts above the ground only limits how high the drone may go.
      const heightLimitM = z.lowerM > 0 ? z.lowerM : undefined;
      out.push({ name, kind, circle: { center: { lat: z.circle.lat, lng: z.circle.lng }, radiusM: z.circle.radiusM }, heightLimitM });
    }
  }
  return out;
}
