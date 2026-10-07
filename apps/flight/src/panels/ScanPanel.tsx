import { useState } from "react";
import { View } from "react-native";

import { useDrone } from "../drone";
import { RETURN_REASON, SIM_TEST_COUNT, STATE_TEXT, launch, prepareFlight, resumable, surveyStats, type FlightPlan } from "../flight";
import { S, commit, go, useApp, type FlightMode } from "../store";
import { Bar, Btn, H2, Lead, Note, P, Readout, Seg, Stats, Status } from "../ui";
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
          Real flights unlock after all {SIM_TEST_COUNT} simulator tests pass ({s.testsPassed.length} so far) and the weather check is connected.
        </Note>
      )}
      <Readout>
        <P>{d.status}</P>
        <P>
          Link {t?.signalOk ? "OK" : "none"} · Battery {t?.batteryPercent ? `${t.batteryPercent}%` : "–"} · Height {t ? `${t.altitudeM.toFixed(1)} m` : "–"}
        </P>
      </Readout>
    </View>
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
          All {job.mission.waypoints.length} photos are on the drone's memory card and the drone is home. Turning them into a measured 3D survey
          (processing) is the next stage to build. Until then, the Survey shows a draft of your garden from the title plan with estimated levels.
        </Lead>
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
