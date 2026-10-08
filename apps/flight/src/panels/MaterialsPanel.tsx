import { useState } from "react";
import { Text, View } from "react-native";

import { DEFAULT_PRICES, PRICE_LIST, gbp, quantities } from "../../../../packages/garden-core/src/index.ts";

import { sharePlanDxf, shareQuotePdf } from "../exportFiles";
import { terrainFor } from "../MapView";
import { S, commit, go, useApp } from "../store";
import { Btn, Card, Field, H2, Lead, Line, Note, Row, Status } from "../ui";
import { EmptyState } from "./SurveyPanel";

export function MaterialsPanel() {
  const s = useApp();
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);
  const [showPrices, setShowPrices] = useState(false);
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
  const Q = items.map((it) => quantities(it, z, s.prices));
  const total = Q.reduce((a, q) => a + q.cost, 0);
  const own = PRICE_LIST.some((p) => s.prices[p.id] !== p.price);

  async function run(what: string, job: () => Promise<void>) {
    setBusy(what);
    setMessage(null);
    try {
      await job();
    } catch (e) {
      setMessage({ ok: false, text: `Could not make the ${what}: ${(e as Error).message}` });
    } finally {
      setBusy(null);
    }
  }

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
      <Note>
        {own ? "Using your own prices." : "Prices are sample supplier rates."} Materials only, excluding labour, delivery and VAT.
      </Note>
      <Row>
        <Btn label={busy === "PDF quote" ? "Making PDF…" : "Export PDF"} alt style={{ flex: 1 }} disabled={!!busy} onPress={() => run("PDF quote", shareQuotePdf)} />
        <Btn label={busy === "DXF plan" ? "Making DXF…" : "Export DXF"} alt style={{ flex: 1 }} disabled={!!busy} onPress={() => run("DXF plan", sharePlanDxf)} />
      </Row>
      {message && <Status status={message.ok ? "pass" : "block"} text={message.text} />}
      <Note style={{ marginTop: 6 }}>The PDF is a materials quote; the DXF is the plan for CAD programs. Both open the phone's share menu, so you can email or save them.</Note>

      <Btn label={showPrices ? "Hide your prices" : "Set your own prices"} alt onPress={() => setShowPrices(!showPrices)} />
      {showPrices && (
        <View style={{ marginTop: 10 }}>
          <Note style={{ marginBottom: 8 }}>Type a price and tap away to save it. Prices are in pounds.</Note>
          {PRICE_LIST.map((p) => (
            <Field
              key={p.id}
              label={`${p.label} (per ${p.unit})`}
              value={String(s.prices[p.id] ?? p.price)}
              numeric
              onCommit={(v) => {
                const n = parseFloat(v.replace(/[£,\s]/g, ""));
                if (!isNaN(n) && n >= 0) S.prices = { ...S.prices, [p.id]: n };
                commit();
              }}
            />
          ))}
          <Btn
            label="Go back to the sample prices"
            alt
            disabled={!own}
            onPress={() => {
              S.prices = { ...DEFAULT_PRICES };
              commit();
            }}
          />
        </View>
      )}
    </View>
  );
}
