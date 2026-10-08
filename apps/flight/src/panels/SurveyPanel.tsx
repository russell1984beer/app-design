import { useState } from "react";
import { Text, View } from "react-native";

import { area, fmtLevel, gradientText, measureLine, perimeter } from "../../../../packages/garden-core/src/index.ts";

import { terrainFor } from "../MapView";
import { S, commit, go, useApp } from "../store";
import { currentSurvey, openSurveyFile, removeSurvey, shareScanDetails } from "../survey";
import { Big, Btn, H2, Lead, Legend, Note, P, Readout, Row, Seg, Status } from "../ui";

/** Where the levels come from: the real processed survey, or the draft from the title plan. */
export function SurveySource() {
  const s = useApp();
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const survey = currentSurvey();
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
      <H2 small>{survey ? "Drone survey" : "Draft survey"}</H2>
      {survey ? (
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
        {s.lastScan && (
          <Btn
            label="Send scan details to PC"
            alt
            style={{ flex: 1 }}
            onPress={() => shareScanDetails(s.lastScan!).catch((e) => setMsg({ ok: false, text: (e as Error).message }))}
          />
        )}
      </Row>
      {survey && <Btn label="Remove the survey and use the draft" alt onPress={removeSurvey} />}
      {msg && <Status status={msg.ok ? "pass" : "block"} text={msg.text} />}
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

export function SurveyPanel() {
  const s = useApp();
  if (!s.scanned) return <EmptyState what="Measurements" />;
  const P_ = s.pts;
  const { lvl } = terrainFor(s.plot);
  let readout;
  if (s.tool === "dist") {
    if (!P_.length) readout = <P>Tap two points on the map to measure between them.</P>;
    else if (P_.length === 1)
      readout = (
        <P>
          Point A is at <Text style={{ fontWeight: "700" }}>{fmtLevel(lvl(P_[0][0], P_[0][1]))} m</Text>. Tap a second point.
        </P>
      );
    else {
      const m = measureLine(lvl, P_[0], P_[1]);
      readout = (
        <>
          <Big>{m.distanceM.toFixed(2)} m</Big>
          <P>
            {m.riseM >= 0 ? "Rises" : "Falls"} {Math.abs(m.riseM * 100).toFixed(0)} cm from A to B
          </P>
          <P>Gradient {gradientText(m.gradient)}</P>
        </>
      );
    }
  } else if (P_.length < 3) {
    readout = <P>Tap around the shape you want to measure{P_.length ? ` (${P_.length} point${P_.length > 1 ? "s" : ""} so far)` : ""}.</P>;
  } else if (s.closed) {
    readout = (
      <>
        <Big>{area(P_).toFixed(1)} m²</Big>
        <P>Perimeter {perimeter(P_).toFixed(2)} m</P>
      </>
    );
  } else readout = <P>Running area {area(P_).toFixed(1)} m². Add more points or close the shape.</P>;

  return (
    <View>
      <H2>Survey</H2>
      <Seg
        options={[["photo", "Photo"], ["contours", "Contours"], ["slope", "Slope"]]}
        value={s.layer}
        onChange={(v) => {
          s.layer = v;
          commit();
        }}
      />
      {s.layer === "slope" && <Legend items={[["#D3E3C6", "Under 4%"], ["#ECE09C", "4 to 8%"], ["#E9B46B", "8 to 15%"], ["#D8784C", "Over 15%"]]} />}
      {s.layer === "contours" && (
        <Note style={{ marginBottom: 10 }}>
          Contours every 25 cm. Heights are relative to the back door threshold.{" "}
          {currentSurvey() ? "Measured by the drone survey." : "These levels are estimates until a real survey is opened."}
        </Note>
      )}
      <Seg
        options={[["dist", "Distance"], ["area", "Area"]]}
        value={s.tool}
        onChange={(v) => {
          s.tool = v;
          s.pts = [];
          s.closed = false;
          commit();
        }}
      />
      <Readout>{readout}</Readout>
      <Row>
        {s.tool === "area" && P_.length >= 3 && !s.closed && (
          <Btn
            label="Close shape"
            style={{ flex: 1 }}
            onPress={() => {
              s.closed = true;
              commit();
            }}
          />
        )}
        {P_.length > 0 && (
          <Btn
            label="Clear"
            alt
            style={{ flex: 1 }}
            onPress={() => {
              s.pts = [];
              s.closed = false;
              commit();
            }}
          />
        )}
      </Row>
      <SurveySource />
    </View>
  );
}
