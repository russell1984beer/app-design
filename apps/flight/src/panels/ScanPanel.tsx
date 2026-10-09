import { useState } from "react";
import { View } from "react-native";

import { useDrone } from "../drone";
import { anchorFor, offsetWords, OFFSET_WARN_M, takeoffMismatch, RETURN_REASON, SIM_TEST_COUNT, STATE_TEXT, launch, prepareFlight, resumable, surveyStats, type FlightPlan } from "../flight";
import { S, commit, go, useApp, type FlightMode } from "../store";
import { compass } from "../../../../packages/garden-core/src/index.ts";
import { shareScanDetails } from "../survey";
import { refreshFlyZones, useFlyZones } from "../flysafe";
import { useLidar } from "../lidar";
import { hasForecastKey, refreshForecast, useForecast } from "../weather";
import { Bar, Btn, H2, Lead, Note, P, Readout, Seg, Stats, Status } from "../ui";
import { FirstFlightProgress, FirstFlightStart } from "./FirstFlight";
import { surveyStatItems } from "./PlanPanel";

/** Drone link, mode switch and live numbers: shared by the Scan and Roof tabs. */
export function DroneStatus() {
  const s = useApp();
  const d = useDrone();
  const t = d.telemetry;
  return (
    <View>
      <Seg<FlightMode>
        options={[["sim", "DJI simulator"], ["real", "Real flight"]]}
        value={s.mode}
        onChange={(m) => {
          if (d.flying) return;
          S.mode = m;
          commit();
        }}
      />
      {s.mode === "sim" ? (
        <Note style={{ marginBottom: 8, color: "#B7791F", fontWeight: "700" }}>Simulator: propellers OFF, drone on a table, phone plugged into the controller.</Note>
      ) : (
        <Note style={{ marginBottom: 8 }}>
          Real flights unlock after all {SIM_TEST_COUNT} simulator tests pass ({s.testsPassed.length} so far).
        </Note>
      )}
      <Readout>
        <P>{d.status}</P>
        <P>
          Link {t?.signalOk ? "OK" : "none"} · Battery {t?.batteryPercent ? `${t.batteryPercent}%` : "–"} · Height {t ? `${t.altitudeM.toFixed(1)} m` : "–"}
        </P>
        {s.mode === "real" && <WeatherLine />}
        {s.mode === "real" && <FlyZoneLine />}
        {s.mode === "real" && <HeightsLine />}
      </Readout>
      {s.mode === "real" && <TakeoffPointCheck />}
    </View>
  );
}

/**
 * The flight plans assume the drone stands on the plan's take-off point. If the house shows up
 * shifted in the LIDAR, it does not: offer to move the take-off point to where the drone is.
 */
function TakeoffPointCheck() {
  const s = useApp();
  const d = useDrone();
  const off = takeoffMismatch(s, anchorFor(s, d.telemetry));
  if (!off || Math.abs(off.alongM) < OFFSET_WARN_M || d.flying) return null;
  const newY = Math.min(Math.max(s.home[1] + off.alongM, 1), s.plot.rearGardenM - 1);
  return (
    <View style={{ marginBottom: 10 }}>
      <Status
        status="block"
        text={`The drone is not on the take-off point: going by where your house shows up in the LIDAR, it is about ${offsetWords(off.alongM)} than the yellow spot on the plan.`}
      />
      <Note>Either carry the drone to the yellow spot, or move the yellow spot to where the drone is. Every flight starts from the yellow spot.</Note>
      <Btn
        label={`Move the take-off point to the drone (${offsetWords(off.alongM)})`}
        alt
        onPress={() => {
          S.home = [s.home[0], newY];
          commit();
        }}
      />
    </View>
  );
}

/** Tree and roof heights (and real levels) from the Environment Agency's LIDAR, fetched by itself. */
function HeightsLine() {
  const s = useApp();
  const d = useDrone();
  const pos = anchorFor(s, d.telemetry);
  const { site, loading, error } = useLidar(pos, s.home);
  if (!pos) return null;
  if (site) return <P>Heights: from the Environment Agency's LIDAR{site.dsm ? "" : " (ground only, no tree or roof heights)"}.</P>;
  if (loading) return <P>Heights: getting the Environment Agency's LIDAR…</P>;
  return <P>Heights: {error ? `could not get the LIDAR (${error}). Check the route is clear with your own eyes.` : "waiting…"}</P>;
}

/** DJI's no-fly zones near the take-off point. What they mean for this flight is in the pre-flight list. */
function FlyZoneLine() {
  const s = useApp();
  const d = useDrone();
  const pos = anchorFor(s, d.telemetry);
  const { result, loading } = useFlyZones(pos);
  if (!pos) return <P>No-fly zones: waiting for the drone's GPS position.</P>;
  if (loading && !result) return <P>No-fly zones: checking DJI's FlySafe map…</P>;
  if (!result) return null;
  if ("error" in result)
    return (
      <View>
        <P>No-fly zones: could not check ({result.error}). Check DJI Fly before you fly.</P>
        <Btn label="Check the no-fly zones again" alt onPress={() => refreshFlyZones(pos)} />
      </View>
    );
  const n = new Set(result.zones.map((z) => z.name)).size;
  return <P>No-fly zones: {n === 0 ? "none nearby on DJI's FlySafe map." : `${n} DJI zone${n > 1 ? "s" : ""} nearby. Any that affect this flight are listed below.`}</P>;
}

/** The Met Office wind forecast for where the drone is sitting (the take-off point). */
function WeatherLine() {
  const s = useApp();
  const d = useDrone();
  const pos = anchorFor(s, d.telemetry);
  const { result, loading } = useForecast(pos);
  if (!pos) return <P>Weather: waiting for the drone's GPS position.</P>;
  if (loading && !result) return <P>Weather: checking the Met Office forecast…</P>;
  if (!result) return null;
  if ("error" in result)
    return (
      <View>
        <P>Weather: {result.error}</P>
        {hasForecastKey() && <Btn label="Check the weather again" alt onPress={() => refreshForecast(pos)} />}
      </View>
    );
  const f = result.forecast;
  return (
    <P>
      Weather: wind {f.speedMs.toFixed(1)} m/s from the {compass(f.fromDeg)}, gusts up to {f.gustMs.toFixed(1)} m/s in the next 2 hours (your limit {s.safety.maxGustMs} m/s).
    </P>
  );
}

export function FlightProgress({ kind }: { kind: "survey" | "roof" }) {
  const d = useDrone();
  const job = d.job;
  if (!job || job.kind !== kind) return null;
  const session = job.session;
  const total = job.mission.waypoints.length;
  const done = session.progress.completedWaypoints.length;
  return (
    <View>
      <Bar fraction={done / total} />
      <Stats
        items={[
          [String(done), `of ${total} photos`],
          [d.telemetry?.batteryPercent ? `${d.telemetry.batteryPercent}%` : "–", "Battery"],
        ]}
      />
      <Readout>
        <P bold>{STATE_TEXT[session.state] ?? session.state}</P>
        {session.returnReason && <P>{RETURN_REASON[session.returnReason]}</P>}
      </Readout>
      {d.flying && <Btn label="Return home" danger onPress={() => d.returnHome()} />}
    </View>
  );
}

export function PreflightList({ plan }: { plan: FlightPlan | { error: string } | null }) {
  if (!plan) return null;
  if ("error" in plan) return <Status status="block" text={plan.error} />;
  const items = plan.check.items.filter((i) => i.status !== "pass");
  if (!items.length) return <Status status="pass" text="All pre-flight checks passed." />;
  return (
    <View>
      {items.map((i) => (
        <Status key={i.id + i.message} status={i.status} text={i.message} />
      ))}
    </View>
  );
}

export function ScanPanel() {
  const s = useApp();
  const d = useDrone();
  const [error, setError] = useState<string | null>(null);
  const st = surveyStats(s);
  const job = d.job?.kind === "survey" ? d.job : null;
  const resume = resumable("survey");
  const plan = prepareFlight("survey", s, d.telemetry, !!resume);

  async function takeOff(fromSaved: boolean) {
    setError(null);
    const p = prepareFlight("survey", S, d.telemetry, fromSaved);
    if ("error" in p || !p.check.canTakeOff) return;
    try {
      await launch(p, fromSaved);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (d.job?.kind === "check") {
    return (
      <View>
        <FirstFlightProgress />
      </View>
    );
  }

  if (job && (d.flying || job.session.state !== "landed" || !job.session.isComplete)) {
    const landed = job.session.state === "landed";
    return (
      <View>
        <H2>{landed ? "Scan stopped" : "Scanning"}</H2>
        <Lead>{landed ? "The photos taken so far are kept. Swap the battery if needed, then resume." : "Keep the drone in sight. Tap Return home to stop the scan safely, or take over with the controller at any time."}</Lead>
        <FlightProgress kind="survey" />
        {landed && (
          <>
            <PreflightList plan={plan} />
            {resume && <Btn label={`Resume scan (${resume.done} of ${resume.total} photos done)`} onPress={() => takeOff(true)} disabled={"error" in plan || !plan.check.canTakeOff} />}
            <Btn label="Edit flight plan" alt onPress={() => go("plan")} />
          </>
        )}
      </View>
    );
  }

  if (job && job.session.isComplete) {
    return (
      <View>
        <H2>Scan complete</H2>
        <Lead>
          All {job.mission.waypoints.length} photos are on the drone's memory card and the drone is home. To turn them into a measured survey: copy the
          photos to the PC, send the scan details to the PC too, and run the survey tool (docs/survey-processing.md). Then open the survey file on the Survey tab.
        </Lead>
        {s.lastScan && s.mode === "real" && <Btn label="Send scan details to the PC" onPress={() => shareScanDetails(s.lastScan!).catch(() => {})} />}
        <Btn
          label="View survey"
          onPress={() => {
            S.scanned = true;
            go("survey");
          }}
        />
        <Btn label="Scan again" alt onPress={() => takeOff(false)} disabled={"error" in plan || !plan.check.canTakeOff} />
      </View>
    );
  }

  return (
    <View>
      <H2>Ready to scan</H2>
      <Lead>Place the drone on the take-off point, clear of people and pets. It will fly {st.passes} passes across the plot, then come back and land there on its own.</Lead>
      <DroneStatus />
      <Stats items={surveyStatItems()} />
      <PreflightList plan={plan} />
      {error && <Status status="block" text={error} />}
      {resume && <Btn label={`Resume scan (${resume.done} of ${resume.total} photos done)`} onPress={() => takeOff(true)} disabled={"error" in plan || !plan.check.canTakeOff} />}
      <Btn label={resume ? "Start again from the beginning" : "Take off and scan"} alt={!!resume} onPress={() => takeOff(false)} disabled={"error" in plan || !plan.check.canTakeOff} />
      <FirstFlightStart />
      <Btn label="Edit flight plan" alt onPress={() => go("plan")} />
      <Btn
        label="Simulator tests"
        alt
        onPress={() => {
          S.showBench = true;
          commit();
        }}
      />
    </View>
  );
}
