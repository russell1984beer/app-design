import { useState } from "react";
import { View } from "react-native";

import { gsdCm, MINI_4_PRO } from "../../../../packages/flight-core/src/camera.ts";
import { EXAMPLE_ROOF_ISSUES, SEVERITY, reportSummary, roofArea } from "../../../../packages/garden-core/src/index.ts";

import { canFly } from "../../modules/dji-drone";
import { SIM_HOME, useDrone } from "../drone";
import { launch, prepareFlight, resumable, roofScan } from "../flight";
import { RoofCloseup } from "../RoofCloseup";
import { S, commit, useApp } from "../store";
import { Btn, Card, Check, Chip, H2, Lead, Line, Note, Row, Stats, Status } from "../ui";
import { DroneStatus, FlightProgress, PreflightList } from "./ScanPanel";

export function RoofPanel() {
  const s = useApp();
  const d = useDrone();
  const [error, setError] = useState<string | null>(null);
  const scan = roofScan(s, SIM_HOME);
  const area = Math.round(roofArea(s.plot));
  const job = d.job?.kind === "roof" ? d.job : null;
  const resume = resumable("roof");
  const plan = prepareFlight("roof", s, d.telemetry, !!resume);
  // Detail on the roof from the lower circle: straight-line distance to the middle of the slope.
  const low = scan.orbits[scan.orbits.length - 1];
  const slant = Math.hypot(scan.radiusM - s.plot.houseWidthM / 4, low.altitudeM - s.plot.ridgeHeightM * 0.8);
  const detailMm = gsdCm(MINI_4_PRO, slant) * 10;

  async function inspect(fromSaved: boolean) {
    setError(null);
    const p = prepareFlight("roof", S, d.telemetry, fromSaved);
    if ("error" in p || !p.check.canTakeOff) return;
    S.roof = { photosTaken: fromSaved ? S.roof.photosTaken : 0, showExample: false, sel: null };
    try {
      await launch(p, fromSaved);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  if (s.roof.showExample) return <ExampleReport area={area} />;

  if (job && (d.flying || !job.session.isComplete)) {
    const done = job.session.progress.completedWaypoints.length;
    const perOrbit = job.mission.waypoints.length / scan.orbits.length;
    const orbit = scan.orbits[Math.min(scan.orbits.length - 1, Math.floor(done / perOrbit))];
    const landed = job.session.state === "landed";
    return (
      <View>
        <H2>{landed ? "Roof scan stopped" : "Inspecting roof"}</H2>
        <Lead>
          {landed
            ? "The photos taken so far are kept."
            : `Keep the drone in sight. Circle ${Math.floor(done / perOrbit) + 1} of ${scan.orbits.length}, ${orbit.heightAboveRidgeM} m above the ridge. It will return to the take-off point when finished.`}
        </Lead>
        <FlightProgress kind="roof" />
        {landed && resume && <Btn label={`Resume roof scan (${resume.done} of ${resume.total} photos)`} onPress={() => inspect(true)} disabled={"error" in plan || !plan.check.canTakeOff} />}
      </View>
    );
  }

  if ((job && job.session.isComplete) || s.roof.photosTaken >= scan.mission.waypoints.length) {
    return (
      <View>
        <H2>Roof photos taken</H2>
        <Lead>
          {scan.mission.waypoints.length} close-up photos of the roof are on the drone's memory card. Automatic damage detection needs a model trained on labelled roof photos, which is not built
          yet. The example report shows what it will look like.
        </Lead>
        <Btn
          label="See an example report"
          onPress={() => {
            S.roof.showExample = true;
            S.roof.sel = 0;
            commit();
          }}
        />
        <Btn label="Inspect again" alt onPress={() => inspect(false)} disabled={"error" in plan || !plan.check.canTakeOff} />
      </View>
    );
  }

  return (
    <View>
      <H2>Roof inspection</H2>
      <Lead>
        The drone circles the house twice, at about {scan.orbits.map((o) => `${o.heightAboveRidgeM} m`).join(" and ")} above the ridge, taking angled close-ups of every slope, the ridge, chimney and
        gutters. The app will then flag anything that looks damaged.
      </Lead>
      <Stats
        items={[
          [String(scan.mission.waypoints.length), "Close-up photos"],
          [`${Math.round(scan.mission.estimate.durationS / 60 + 1)} min`, "Flight time"],
          [`${detailMm.toFixed(0)} mm`, "Detail per pixel"],
          [`${area} m²`, "Roof area to check"],
        ]}
      />
      <Check checked disabled title="Only your half of the roof is reported" detail="Your house is semi-detached, so the circles pass over next door's roof. Tell your neighbours before you fly" />
      <Check checked disabled title="Keeps clear of the roof" detail={`At least 2 m out from the roof edge and 2 m above the chimney and aerials. The drone's obstacle sensing may be off while the app flies it`} />
      {canFly ? (
        <>
      <DroneStatus />
      <PreflightList plan={plan} />
      {error && <Status status="block" text={error} />}
      {resume && <Btn label={`Resume roof scan (${resume.done} of ${resume.total} photos)`} onPress={() => inspect(true)} disabled={"error" in plan || !plan.check.canTakeOff} />}
      <Btn label="Inspect roof" alt={!!resume} onPress={() => inspect(false)} disabled={"error" in plan || !plan.check.canTakeOff} />
        </>
      ) : (
        <Note style={{ marginTop: 8 }}>Roof scans are flown from the Android phone plugged into the drone controller.</Note>
      )}
      <Btn
        label="See an example report"
        alt
        onPress={() => {
          S.roof.showExample = true;
          S.roof.sel = 0;
          commit();
        }}
      />
      <Note style={{ marginTop: 8 }}>With a thermal drone such as the Matrice 4T, the same flight can also show where heat escapes through the roof.</Note>
    </View>
  );
}

function ExampleReport({ area }: { area: number }) {
  const s = S;
  const sum = reportSummary(EXAMPLE_ROOF_ISSUES);
  const sel = s.roof.sel != null ? EXAMPLE_ROOF_ISSUES[s.roof.sel] : null;
  return (
    <View>
      <H2>Example roof report</H2>
      <Lead>
        This is an example, not your roof: damage detection is not built yet. Overall condition: fair. {sum.fixSoon} problem to fix soon, {sum.planFor} to plan for and {sum.watch} to keep an eye
        on. Tap a number on the roof or in the list for the close-up.
      </Lead>
      <Stats
        items={[
          [`${area} m²`, `Roof area (${s.plot.roofPitchDeg}° pitch)`],
          [`£${sum.low.toLocaleString("en-GB")}–${sum.high.toLocaleString("en-GB")}`, "Typical repairs, all items"],
        ]}
      />
      {sel && (
        <Card>
          <RoofCloseup kind={sel.key} />
          <H2 small>{sel.title}</H2>
          <Note style={{ fontSize: 13, color: "#1E3436", marginBottom: 6 }}>{sel.detail}</Note>
          <Line first k="What to do" v={sel.fix} />
          <Line k="Typical repair cost" v={`£${sel.cost[0]} to £${sel.cost[1]}`} />
        </Card>
      )}
      <View style={{ gap: 8 }}>
        {EXAMPLE_ROOF_ISSUES.map((it, i) => (
          <Chip
            key={it.key}
            wide
            round
            swatch={SEVERITY[it.severity].colour}
            pressed={s.roof.sel === i}
            label={`${i + 1}. ${it.title}`}
            sub={`${SEVERITY[it.severity].label}, ${it.where.toLowerCase()}`}
            onPress={() => {
              s.roof.sel = i;
              commit();
            }}
          />
        ))}
      </View>
      <Note style={{ marginTop: 10 }}>Repair costs are typical UK ranges; get quotes from a roofer before booking work.</Note>
      <Row>
        <Btn
          label="Back to roof scan"
          alt
          style={{ flex: 1 }}
          onPress={() => {
            s.roof.showExample = false;
            commit();
          }}
        />
      </Row>
    </View>
  );
}
