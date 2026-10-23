import { Text, View } from "react-native";

import { area, fmtLevel, gradientText, inHouse, measureLine, perimeter, type Pt } from "../../../../packages/garden-core/src/index.ts";

import { HEIGHT_BANDS, tallSpots } from "../MapView";
import { terrainFor } from "../terrain";
import { S, commit, useApp } from "../store";
import { currentSurvey, droneSurvey } from "../survey";
import { EmptyState, SurveySource } from "./EmptyState";
import { Big, Btn, H2, Legend, Note, P, Readout, Row, Seg } from "../ui";

/**
 * The LIDAR can be years old. The owner can say a tall spot has gone (a tree cut down); the map and
 * the pre-flight clearance check then use the ground there instead.
 */
function GoneSpots() {
  const s = useApp();
  // The house is not going anywhere: only trees, sheds and the like can be marked as gone.
  const spots = tallSpots(s).filter((p) => p.h >= 3 && !inHouse(s.plot, p.at[0], p.at[1]));
  const where = (p: Pt) => {
    const side = p[0] < s.plot.widthM / 3 ? "left side" : p[0] > (2 * s.plot.widthM) / 3 ? "right side" : "middle";
    const area = p[1] > s.plot.rearGardenM + s.plot.houseDepthM ? "front garden" : p[1] > s.plot.rearGardenM ? "house" : `${p[1].toFixed(0)} m from the bottom of the garden`;
    return `${area}, ${side}`;
  };
  return (
    <View style={{ marginBottom: 10 }}>
      <Note>The LIDAR may be a few years old. If a tall spot has gone (a tree cut down), mark it so the map and the safety check ignore it.</Note>
      {spots.map((p) => (
        <Btn
          key={`${p.at[0]},${p.at[1]}`}
          label={`${p.h.toFixed(1)} m, ${where(p.at)}: gone`}
          alt
          onPress={() => {
            S.goneSpots = [...S.goneSpots, p.at];
            commit();
          }}
        />
      ))}
      {s.goneSpots.length > 0 && (
        <Btn
          label={`Bring back the ${s.goneSpots.length === 1 ? "spot" : `${s.goneSpots.length} spots`} marked as gone`}
          alt
          onPress={() => {
            S.goneSpots = [];
            commit();
          }}
        />
      )}
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
        options={[["photo", "Photo"], ["contours", "Contours"], ["slope", "Slope"], ["heights", "Heights"]]}
        value={s.layer}
        onChange={(v) => {
          s.layer = v;
          commit();
        }}
      />
      {s.layer === "heights" &&
        (currentSurvey()?.surface ? (
          <View>
            <Legend items={HEIGHT_BANDS.map(([, colour, label]) => [colour, label] as [string, string])} />
            <Note style={{ marginBottom: 10 }}>How tall trees, sheds and roofs stand above the ground, with the tallest spots labelled.</Note>
            {!droneSurvey() && <GoneSpots />}
          </View>
        ) : (
          <Note style={{ marginBottom: 10 }}>No heights yet: they come with the LIDAR levels or a drone survey.</Note>
        ))}
      {s.layer === "slope" && <Legend items={[["#D3E3C6", "Under 4%"], ["#ECE09C", "4 to 8%"], ["#E9B46B", "8 to 15%"], ["#D8784C", "Over 15%"]]} />}
      {s.layer === "contours" && (
        <Note style={{ marginBottom: 10 }}>
          Contours every 25 cm. Heights are relative to the back door threshold.{" "}
          {droneSurvey() ? "Measured by the drone survey." : currentSurvey() ? "From the Environment Agency's LIDAR (1 m grid)." : "These levels are estimates until a real survey is opened."}
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
