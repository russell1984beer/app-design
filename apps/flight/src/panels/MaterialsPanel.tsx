import { useState } from "react";
import { Text, View } from "react-native";

import { gbp, quantities } from "../../../../packages/garden-core/src/index.ts";

import { terrainFor } from "../MapView";
import { go, useApp } from "../store";
import { Btn, Card, H2, Lead, Line, Note, Row } from "../ui";
import { EmptyState } from "./SurveyPanel";

export function MaterialsPanel() {
  const s = useApp();
  const [exportNote, setExportNote] = useState(false);
  if (!s.scanned) return <EmptyState what="Material quantities" />;
  const items = s.items.filter((i) => !i.exist);
  if (!items.length)
    return (
      <View>
        <H2>Materials</H2>
        <Lead>Add a patio, lawn or planting bed in Design to see quantities and costs.</Lead>
        <Btn label="Open design" onPress={() => go("design")} />
      </View>
    );
  const z = terrainFor(s.plot).z;
  const Q = items.map((it) => quantities(it, z));
  const total = Q.reduce((a, q) => a + q.cost, 0);
  return (
    <View>
      <H2>Materials</H2>
      <Lead>Quantities come from the measured survey and include 5% waste where it applies.</Lead>
      {Q.map((q, i) => (
        <Card key={i}>
          <H2 small>{q.title}</H2>
          {q.lines.map((l, j) => (
            <Line key={j} first={j === 0} k={l[0]} v={l[1]} />
          ))}
          <Line k="Materials estimate" v={gbp(q.cost)} />
        </Card>
      ))}
      <View style={{ flexDirection: "row", justifyContent: "space-between", alignItems: "baseline", marginTop: 6, marginBottom: 2 }}>
        <Text style={{ fontSize: 15, color: "#1E3436" }}>Materials total</Text>
        <Text style={{ fontSize: 24, fontWeight: "800", color: "#1E3436" }}>{gbp(total)}</Text>
      </View>
      <Note>Prices are sample supplier rates, excluding labour and VAT. Setting your own rates and exporting a PDF quote or DXF plan come later.</Note>
      <Row>
        <Btn label={exportNote ? "Export is not built yet" : "Export PDF"} alt style={{ flex: 1 }} onPress={() => setExportNote(true)} />
        <Btn label={exportNote ? "Export is not built yet" : "Export DXF"} alt style={{ flex: 1 }} onPress={() => setExportNote(true)} />
      </Row>
    </View>
  );
}
