// The first real flight, a short check before the full scan (flight-core planFirstFlight). The drone
// hovers 10 m above the take-off point while the pilot compares the wind reading and, if they want,
// tries unplugging the phone; then it scans the bottom of the garden up to the take-off point and
// lands where it took off.

import { useEffect, useState } from "react";
import { View } from "react-native";

import { FIRST_FLIGHT } from "../../../../packages/flight-core/src/planner.ts";
import { compass } from "../../../../packages/garden-core/src/index.ts";

import { SIM_HOME, useDrone } from "../drone";
import { anchorFor, firstFlightMission, launch, prepareFlight, RETURN_REASON, STATE_TEXT } from "../flight";
import { S, commitNow, useApp } from "../store";
import { Btn, H2, Lead, Note, P, Readout, Status } from "../ui";
import { useForecast } from "../weather";
import { PreflightList } from "./ScanPanel";

/** Shown on the Scan tab before any scan: what the check is, and the button to fly it. */
export function FirstFlightStart() {
  const s = useApp();
  const d = useDrone();
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const plan = prepareFlight("check", s, d.telemetry);
  const photoCount = firstFlightMission(s, SIM_HOME).estimate.photoCount;
  const done = s.firstFlightDoneAt;

  if (!open) {
    return (
      <View style={{ marginTop: 14 }}>
        <H2 small>First flight check</H2>
        <Note>
          {done
            ? `Flown on ${new Date(done).toLocaleDateString("en-GB", { day: "numeric", month: "long" })}. You can fly it again at any time.`
            : `Fly this before the first full scan: ${FIRST_FLIGHT.altitudeM} m up, a short hover, a scan of the bottom of the garden up to the take-off point, then it lands where it took off.`}
        </Note>
        <Btn label="Set up the first flight check" alt={!!done} onPress={() => setOpen(true)} />
      </View>
    );
  }

  async function fly() {
    setError(null);
    const p = prepareFlight("check", S, d.telemetry);
    if ("error" in p || !p.check.canTakeOff) return;
    try {
      await launch(p, false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <View style={{ marginTop: 14 }}>
      <H2 small>First flight check</H2>
      <Lead>
        Daylight, propellers on, the drone on the take-off point in the garden, people and pets indoors. Hold the controller the whole time: its Pause button
        stops the drone and gives you the sticks, and its Return to Home button brings it back.
      </Lead>
      <Readout>
        <P>1. It takes off and climbs to {FIRST_FLIGHT.altitudeM} m above the take-off point.</P>
        <P>2. It hovers there for {FIRST_FLIGHT.holdS} seconds while you check the wind reading, and try unplugging the phone if you want to.</P>
        <P>
          3. It scans the bottom of the garden up to the take-off point at {FIRST_FLIGHT.altitudeM} m: {photoCount} photos, starting at the far end and working back.
        </P>
        <P>4. It comes back over the take-off point and lands straight down.</P>
      </Readout>
      {s.mode === "sim" && <Note style={{ marginBottom: 8, color: "#B7791F", fontWeight: "700" }}>DJI simulator is selected: propellers OFF. Switch to Real flight for the real check.</Note>}
      <PreflightList plan={plan} />
      {error && <Status status="block" text={error} />}
      <Btn label="Take off for the first flight check" onPress={fly} disabled={"error" in plan || !plan.check.canTakeOff} />
      <Btn label="Not now" alt onPress={() => setOpen(false)} />
    </View>
  );
}

/** While the check flies, and its result afterwards. */
export function FirstFlightProgress() {
  const s = useApp();
  const d = useDrone();
  const job = d.job?.kind === "check" ? d.job : null;
  const session = job?.session;
  const t = d.telemetry;
  const { result } = useForecast(s.mode === "real" ? anchorFor(s, t) : null);
  const [, tick] = useState(0);

  // Redraw every second for the hover countdown.
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  const finished = session?.state === "landed" && session.returnReason === "complete";
  useEffect(() => {
    if (finished && S.mode === "real") {
      S.firstFlightDoneAt = new Date().toISOString();
      commitNow();
    }
  }, [finished]);

  if (!job || !session) return null;
  const hold = session.holdRemainingS;
  const photos = session.progress.completedWaypoints.filter((i) => job.mission.waypoints[i]?.photo).length;
  const totalPhotos = job.mission.estimate.photoCount;
  const forecast = result && "forecast" in result ? result.forecast : null;

  return (
    <View>
      <H2>First flight check</H2>
      <Readout>
        <P bold>{hold !== undefined ? `Hovering: ${Math.ceil(hold)} s left` : (STATE_TEXT[session.state] ?? session.state)}</P>
        <P>
          Height {t ? `${t.altitudeM.toFixed(1)} m` : "–"} · Battery {t?.batteryPercent ? `${t.batteryPercent}%` : "–"} · Photos {photos} of {totalPhotos}
        </P>
        {session.returnReason && <P>{session.returnReason === "complete" ? "Check complete: landed where it took off." : RETURN_REASON[session.returnReason]}</P>}
      </Readout>

      {hold !== undefined && (
        <View>
          <H2 small>While it hovers</H2>
          <Readout>
            <P bold>Wind</P>
            <P>
              The drone says: {t?.wind ? `${t.wind.speedMs.toFixed(1)} m/s from the ${compass(t.wind.fromDeg)} (${Math.round(t.wind.fromDeg)}°)` : "no wind reading"}
              {t?.windWarning && t.windWarning !== "none" ? `, warning: ${t.windWarning}` : ""}.
            </P>
            <P>
              Met Office forecast: {forecast ? `${forecast.speedMs.toFixed(1)} m/s from the ${compass(forecast.fromDeg)}, gusts ${forecast.gustMs.toFixed(1)} m/s` : "not available"}.
            </P>
            <Note>
              Do they roughly agree, and does the direction match what you feel and see (trees, flags)? Take a screenshot of this box. A reading ten times too
              big or too small, or from the opposite side, tells us the drone's units or direction are read wrongly.
            </Note>
          </Readout>
          <Readout>
            <P bold>Unplugging the phone (optional)</P>
            <Note>
              Unplug the phone from the controller for 5 seconds, then plug it back in. The drone should hold its position while the cable is out. When the
              cable is back, the app brings it home and the check ends there: it may climb to your return height ({s.safety.returnHeightM} m) first, then come
              down on the take-off point. Keep your thumbs near the sticks; the controller still works the whole time.
            </Note>
          </Readout>
          <Btn label="Carry on to the scan now" onPress={() => session.endHold()} />
        </View>
      )}

      {d.flying && <Btn label="Return home" danger onPress={() => d.returnHome()} />}

      {!d.flying && (
        <View>
          {finished ? (
            <Status status="pass" text="First flight check done. The photos are on the drone's memory card; they can go through the survey tool like a full scan." />
          ) : (
            <Status status="warn" text="The check did not finish. Look at the reason above; you can fly it again." />
          )}
          <Note>Send a screenshot of this screen and the wind box to Claude.</Note>
          <Btn
            label="Done"
            alt
            onPress={() => d.clearJob()}
          />
        </View>
      )}
    </View>
  );
}
