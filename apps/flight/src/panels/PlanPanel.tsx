import { Text, View } from "react-native";

import { DJI_MIN_RETURN_HEIGHT_M, MINI_4_PRO_MAX_WIND_MS, UK_MAX_ALTITUDE_M, validateSettings, type SignalLossAction } from "../../../../packages/flight-core/src/safety.ts";
import { PHOTO_INTERVAL_S } from "../../../../packages/flight-core/src/planner.ts";
import { compass } from "../../../../packages/garden-core/src/index.ts";

import { canFly } from "../../modules/dji-drone";
import { photoChoice, photosPerRun, surveyStats } from "../flight";
import { S, commit, go, useApp } from "../store";
import { Btn, Check, H2, Lead, Note, Seg, Stats, Status, Stepper } from "../ui";

const CHECKS: [string, string][] = [
  ["Operator ID and Flyer ID registered", "Required by the CAA for drones with a camera"],
  ["Airspace checked today", "Check Drone Assist (NATS) or DJI Fly for today's restrictions. The app only checks DJI's own no-fly zones"],
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
  const pc = photoChoice(s);
  const perRun = photosPerRun(s);
  const settingIssues = validateSettings(s.safety).filter((i) => i.status !== "pass");
  const set = (fn: () => void) => {
    fn();
    commit();
  };
  return (
    <View>
      <H2>Flight plan</H2>
      <Lead>
        The drone takes off from the yellow point and flies {st.passes} smooth runs along the plot, about{" "}
        {(st.mission.estimate.lineSpacingM ?? 0).toFixed(1)} m apart, taking photos as it goes without stopping{s.edgeLap ? ", then a lap round the edge" : ""}
        {s.film ? ", then films a fly-over down the garden" : ""}. It comes back and lands where it started, and never crosses the property boundary. Tap the
        map to move the take-off point.
      </Lead>
      <Stepper label="Flying height" value={s.alt} min={12} max={40} step={1} format={(v) => `${v} m`} onChange={(v) => set(() => (s.alt = v))} />
      <Stepper label="Photo overlap" value={s.ov} min={65} max={85} step={5} format={(v) => `${v}%`} onChange={(v) => set(() => (s.ov = v))} />
      <Stepper
        label={`Photos per flight${perRun === pc.recommended ? " (recommended)" : ""}`}
        value={perRun * pc.runs}
        min={pc.min * pc.runs}
        max={pc.max * pc.runs}
        step={pc.runs}
        format={String}
        onChange={(v) =>
          set(() => {
            const n = Math.round(v / pc.runs);
            s.photosPerRun = n === pc.recommended ? null : n;
          })
        }
      />
      <Note>
        Recommended: {pc.recommended * pc.runs} photos ({pc.recommended} on each of the {pc.runs} runs). Fewer is a quicker flight but the survey has less to work
        with; more gives more detail but the drone flies the runs more slowly. Between {pc.min * pc.runs} and {pc.max * pc.runs}.
        {s.edgeLap ? " The lap round the edge adds its own photos." : ""}
      </Note>
      {s.photosPerRun !== null && <Btn label="Use the recommended number" alt onPress={() => set(() => (s.photosPerRun = null))} />}
      <Stepper
        label={`Time between photos${s.photoIntervalS === PHOTO_INTERVAL_S ? " (recommended)" : ""}`}
        value={s.photoIntervalS}
        min={2}
        max={8}
        step={0.5}
        format={(v) => `${v} s`}
        onChange={(v) => set(() => (s.photoIntervalS = v))}
      />
      <Note>
        The drone flies each run slowly enough to give the camera this long to save each photo, so it never has to stop. {PHOTO_INTERVAL_S} s suits a fast (U3 / V30)
        memory card. A slow card needs more: a card that takes about 4 s per photo needs 5 s here. Longer means a longer flight.
      </Note>
      <Check
        checked={s.edgeLap}
        title="Lap round the edge"
        detail="After the passes, fly once round the edge of the plot with the camera tilted, to capture walls, steps and tree heights. Stays inside the boundary"
        onChange={(v) => set(() => (s.edgeLap = v))}
      />
      <Check
        checked={s.film}
        title="Record a video of the flight (recommended)"
        detail="After the photos, the drone films a slow run down the middle of the garden towards the house and back: about a minute of video, saved on the drone's card. The Mini 4 Pro cannot film and take the survey photos at the same time, so the video comes at the end. Untick for photos only"
        onChange={(v) => set(() => (s.film = v))}
      />
      <Check checked={false} disabled title="RTK positioning" detail="Centimetre-level GPS for contractor-grade levels. Needs the Matrice 4E; the Mini 4 Pro does not have it" />
      <Stats items={surveyStatItems()} />

      <H2 small>Safety</H2>
      <Stepper
        label="Return height"
        value={s.safety.returnHeightM}
        min={Math.max(DJI_MIN_RETURN_HEIGHT_M, s.safety.tallestObstacleM + s.safety.obstacleClearanceM)}
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
        status="pass"
        text={s.mode === "sim" ? "Weather: not needed in the DJI simulator" : "Weather: checked against the Met Office forecast on the Scan tab before take-off"}
      />
      {canFly ? (
        <Btn label="Start scan" onPress={() => go("scan")} disabled={!s.checks.every(Boolean)} />
      ) : (
        <Note style={{ marginTop: 8 }}>Scans are flown from the Android phone plugged into the drone controller.</Note>
      )}
      {canFly && !s.checks.every(Boolean) && <Note style={{ marginTop: 8 }}>Tick every item to enable the scan.</Note>}
    </View>
  );
}
