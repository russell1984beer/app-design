import { Text, View } from "react-native";

import { MINI_4_PRO_MAX_WIND_MS, UK_MAX_ALTITUDE_M, validateSettings, type SignalLossAction } from "../../../../packages/flight-core/src/safety.ts";
import { compass } from "../../../../packages/garden-core/src/index.ts";

import { surveyStats } from "../flight";
import { S, commit, go, useApp } from "../store";
import { Btn, Check, H2, Lead, Note, Seg, Stats, Status, Stepper } from "../ui";

export const CHECKS: [string, string][] = [
  ["Operator ID and Flyer ID registered", "Required by the CAA for drones with a camera"],
  ["Airspace checked in DJI Fly", "No restrictions here today. The app does not check FlySafe zones yet"],
  ["Neighbours told about the flight", "Recommended for privacy"],
];

export function surveyStatItems(): [string, string][] {
  const st = surveyStats(S);
  return [
    [String(st.photos), "Photos"],
    [`${st.minutes.toFixed(1)} min`, "Flight time"],
    [`${st.gsdCm.toFixed(2)} cm`, "Detail per pixel"],
    [`±${st.accuracyCm.toFixed(1)} cm`, "Expected accuracy"],
  ];
}

export function PlanPanel() {
  const s = useApp();
  const st = surveyStats(s);
  const tooWide = (st.mission.estimate.lineSpacingM ?? 0) > (st.mission.estimate.maxLineSpacingM ?? Infinity);
  const settingIssues = validateSettings(s.safety).filter((i) => i.status !== "pass");
  const set = (fn: () => void) => {
    fn();
    commit();
  };
  return (
    <View>
      <H2>Flight plan</H2>
      <Lead>
        The drone flies {st.passes} passes across the plot, front to back, then a lap round the edge with the camera tilted, to capture the house,
        walls, steps and tree heights. Tap the map to move the take-off point.
      </Lead>
      <Stepper label="Flying height" value={s.alt} min={12} max={40} step={1} format={(v) => `${v} m`} onChange={(v) => set(() => (s.alt = v))} />
      <Stepper label="Photo overlap" value={s.ov} min={65} max={85} step={5} format={(v) => `${v}%`} onChange={(v) => set(() => (s.ov = v))} />
      <Stepper label="Distance between passes" value={s.spacing} min={1} max={10} step={0.5} format={(v) => `${v} m`} onChange={(v) => set(() => (s.spacing = v))} />
      {tooWide && <Status status="warn" text={`Passes this far apart leave gaps at ${s.alt} m. Use ${Math.floor((st.mission.estimate.maxLineSpacingM ?? 0) * 10) / 10} m or less, or fly higher.`} />}
      <Check checked={false} disabled title="RTK positioning" detail="Centimetre-level GPS for contractor-grade levels. Needs the Matrice 4E; the Mini 4 Pro does not have it" />
      <Stats items={surveyStatItems()} />

      <H2 small>Safety</H2>
      <Stepper
        label="Return height"
        value={s.safety.returnHeightM}
        min={s.safety.tallestObstacleM + s.safety.obstacleClearanceM}
        max={UK_MAX_ALTITUDE_M}
        step={1}
        format={(v) => `${v} m`}
        onChange={(v) => set(() => (s.safety = { ...s.safety, returnHeightM: v }))}
      />
      <Stepper
        label="Tallest roof, tree or aerial"
        value={s.safety.tallestObstacleM}
        min={2}
        max={40}
        step={0.5}
        format={(v) => `${v} m`}
        onChange={(v) => set(() => (s.safety = { ...s.safety, tallestObstacleM: v, returnHeightM: Math.max(s.safety.returnHeightM, v + s.safety.obstacleClearanceM) }))}
      />
      <Stepper label="Gust limit" value={s.safety.maxGustMs} min={3} max={MINI_4_PRO_MAX_WIND_MS} step={0.5} format={(v) => `${v} m/s`} onChange={(v) => set(() => (s.safety = { ...s.safety, maxGustMs: v }))} />
      <Stepper label="Land with at least" value={s.safety.landingReservePercent} min={10} max={50} step={5} format={(v) => `${v}%`} onChange={(v) => set(() => (s.safety = { ...s.safety, landingReservePercent: v }))} />
      <Stepper label="Geofence margin" value={s.safety.geofenceMarginM} min={1} max={15} step={1} format={(v) => `${v} m`} onChange={(v) => set(() => (s.safety = { ...s.safety, geofenceMarginM: v }))} />
      <Text style={{ fontSize: 14, marginTop: 6, marginBottom: 6 }}>If the controller signal is lost</Text>
      <Seg<SignalLossAction>
        options={[["returnHome", "Return home"], ["hover", "Hover"], ["land", "Land"]]}
        value={s.safety.signalLossAction}
        onChange={(v) => set(() => (s.safety = { ...s.safety, signalLossAction: v }))}
      />
      {settingIssues.map((i) => (
        <Status key={i.id} status={i.status} text={i.message} />
      ))}
      <Stepper
        label={`Rear garden faces (${compass(s.plot.gardenBearingDeg)})`}
        value={s.plot.gardenBearingDeg}
        min={0}
        max={359}
        step={1}
        format={(v) => `${v}°`}
        onChange={(v) => set(() => (s.plot = { ...s.plot, gardenBearingDeg: v }))}
      />
      <Note>Compass direction from the back door down the garden, from the title plan. Flights use it to line the plan up with GPS.</Note>

      <H2 small>Before you fly</H2>
      {CHECKS.map((c, i) => (
        <Check key={c[0]} checked={s.checks[i]} title={c[0]} detail={c[1]} onChange={(v) => set(() => (s.checks[i] = v))} />
      ))}
      <Status
        status={s.mode === "sim" ? "pass" : "block"}
        text={s.mode === "sim" ? "Weather: not needed in the DJI simulator" : "Weather: the Met Office forecast is not connected yet, so real flights are blocked"}
      />
      <Btn label="Start scan" onPress={() => go("scan")} disabled={!s.checks.every(Boolean)} />
      {!s.checks.every(Boolean) && <Note style={{ marginTop: 8 }}>Tick every item to enable the scan.</Note>}
    </View>
  );
}
