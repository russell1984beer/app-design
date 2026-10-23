// What the Survey, Design and Materials tabs show before there is a survey, and where the levels
// come from (drone survey, LIDAR or the draft), with the buttons to change that.

import { useState } from "react";
import { View } from "react-native";

import { S, commit, go, useApp } from "../store";
import { useDrone } from "../drone";
import { anchorFor, offsetWords } from "../flight";
import { currentLidar, fetchLidar, setLidarHome, useLidar } from "../lidar";
import { takeoffOffset } from "../lidarMath";
import { TAKEOFF_WARN_M, planToGps } from "../placement";
import { currentSurvey, droneSurvey, openSurveyFile, removeSurvey, scanDetailsToSend, shareScanDetails } from "../survey";
import { Btn, H2, Lead, Note, Row, Status } from "../ui";

/** Where the levels come from: the processed drone survey, the LIDAR, or the draft from the title plan. */
export function SurveySource() {
  const s = useApp();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const survey = droneSurvey();
  const lidar = currentLidar();
  // A part-flown survey filled from the LIDAR has its own explanation.
  const shown = currentSurvey();
  const open = async () => {
    setMsg(null);
    try {
      if ((await openSurveyFile()) === "opened") setMsg({ ok: true, text: "Survey opened. Levels, contours, slope and the photo now come from it." });
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    }
  };
  return (
    <View style={{ marginTop: 14 }}>
      <H2 small>{survey ? "Drone survey" : lidar ? "LIDAR levels" : "Draft survey"}</H2>
      {survey && shown !== survey && shown?.label ? (
        <Note>{shown.label}</Note>
      ) : survey?.label ? (
        <Note>{survey.label}</Note>
      ) : !survey && lidar ? (
        <Note>{currentSurvey()?.label ?? "LIDAR levels could not be placed on this plot."}</Note>
      ) : survey ? (
        <Note>
          Flown {new Date(survey.flownAt).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })} from {survey.photoCount} photos. It covers{" "}
          {Math.round(survey.coverage * 100)}% of the plot{survey.coverage < 0.9 ? "; the gaps are filled in from nearby heights" : ""}.
        </Note>
      ) : (
        <Note>
          These levels are a draft from the title plan. For real ones: fly a scan, process the photos on the PC (see docs/survey-processing.md), then open the survey file here.
        </Note>
      )}
      <Row>
        <Btn label={survey ? "Open a newer survey" : "Open survey file"} alt style={{ flex: 1 }} onPress={open} />
        {scanDetailsToSend() && s.mode === "real" && (
          <Btn
            label="Send scan details to PC"
            alt
            style={{ flex: 1 }}
            onPress={() => shareScanDetails(scanDetailsToSend()!).catch((e) => setMsg({ ok: false, text: (e as Error).message }))}
          />
        )}
      </Row>
      {survey && <Btn label={lidar ? "Remove the survey and use the LIDAR levels" : "Remove the survey and use the draft"} alt onPress={removeSurvey} />}
      {!survey && <LidarFetch />}
      {msg && <Status status={msg.ok ? "pass" : "block"} text={msg.text} />}
    </View>
  );
}

/** Getting the free Environment Agency LIDAR: needs the drone's GPS position on the take-off point. */
function LidarFetch() {
  const s = useApp();
  const d = useDrone();
  const anchor = s.mode === "real" ? anchorFor(s, d.telemetry) : null;
  const { site, loading, error } = useLidar(anchor, s.home);
  if (loading) return <Status status="warn" text="Getting the Environment Agency's LIDAR levels…" />;
  if (site) {
    // Fetched with the drone somewhere other than the plan's take-off point? The house shows it.
    const off = takeoffOffset(site, s.plot, (p) => planToGps({ ...s, home: site.home }, site.anchor, p), `stored,${site.home.join(",")}`);
    const misplaced = off && Math.abs(off.alongM) >= TAKEOFF_WARN_M;
    return (
      <View>
        {misplaced && (
          <View>
            <Status
              status="warn"
              text={`The LIDAR shows your house about ${Math.abs(off.alongM).toFixed(0)} m out of place: the drone was ${offsetWords(off.alongM)} than the take-off point when it was fetched.`}
            />
            <Btn label="Line the LIDAR up with the house" alt onPress={() => setLidarHome([site.home[0], site.home[1] + off.alongM])} />
          </View>
        )}
        {anchor && <Btn label="Get the LIDAR again (drone on the take-off point)" alt onPress={() => fetchLidar(anchor, s.home)} />}
      </View>
    );
  }
  return (
    <View>
      <Note>
        Free real levels for England: the Environment Agency's LIDAR (1 m grid). On the Scan tab choose Real flight, put the drone on the take-off point
        and switch it on; once it has GPS, the levels are fetched by themselves. Or tap below.
      </Note>
      {error && <Status status="warn" text={`Could not get the LIDAR: ${error}.`} />}
      <Btn label="Get the LIDAR levels now" alt disabled={!anchor} onPress={() => anchor && fetchLidar(anchor, s.home)} />
    </View>
  );
}

export function EmptyState({ what }: { what: string }) {
  return (
    <View>
      <H2>No survey yet</H2>
      <Lead>Fly a scan to measure the garden. {what} will use the real dimensions and levels.</Lead>
      <Btn label="Plan a flight" onPress={() => go("plan")} />
      <Btn
        label="Load draft of your garden"
        alt
        onPress={() => {
          S.scanned = true;
          commit();
        }}
      />
      <SurveySource />
    </View>
  );
}
