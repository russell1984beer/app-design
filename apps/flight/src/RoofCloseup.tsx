// The example report's drawn close-ups, as in the prototype.

import { useState } from "react";
import { View } from "react-native";
import Svg, { Circle, Ellipse, Path, Rect } from "react-native-svg";

import type { RoofIssue } from "../../../packages/garden-core/src/index.ts";

export function RoofCloseup({ kind }: { kind: RoofIssue["key"] }) {
  const [w, setW] = useState(0);
  const tiles = [];
  for (let r = 0; r < 5; r++) {
    for (let c = 0; c < 11; c++) {
      const off = r % 2 ? 14 : 0;
      const dy = kind === "slip" && r === 2 && c === 5 ? 12 : 0;
      tiles.push(<Rect key={`${r}-${c}`} x={c * 28 - off} y={r * 26 + dy} width={27} height={25} rx={2} fill={(r * 7 + c * 3) % 5 ? "#A9614C" : "#9A553F"} />);
    }
  }
  const box = (x: number, y: number, bw: number, bh: number, colour: string) => <Rect x={x} y={y} width={bw} height={bh} fill="none" stroke={colour} strokeWidth={3} rx={4} />;
  let extra = null;
  if (kind === "slip")
    extra = (
      <>
        <Rect x={140} y={52} width={27} height={12} fill="#2B2321" />
        {box(134, 46, 40, 44, "#C8442F")}
      </>
    );
  if (kind === "ridge")
    extra = (
      <>
        <Rect x={0} y={0} width={300} height={30} fill="#7E4636" />
        <Path d="M110 8l14 10 10-8 16 12" stroke="#E8E1D2" strokeWidth={3} fill="none" />
        {box(100, -2, 60, 36, "#D98A1E")}
      </>
    );
  if (kind === "flash")
    extra = (
      <>
        <Rect x={180} y={10} width={80} height={70} fill="#8B5444" />
        <Path d="M170 80h100v14H170z" fill="#8E9599" />
        <Path d="M250 80l22-10v14z" fill="#B7BEC2" />
        {box(240, 62, 40, 38, "#D98A1E")}
      </>
    );
  if (kind === "gutter")
    extra = (
      <>
        <Rect x={0} y={104} width={300} height={22} fill="#E9ECEA" />
        {[60, 90, 115, 150, 175].map((x, i) => (
          <Ellipse key={x} cx={x + 140} cy={110 + (i % 2) * 5} rx={10} ry={5} fill={i % 2 ? "#7A6A2E" : "#5E7F4E"} />
        ))}
        {box(186, 96, 114, 34, "#D98A1E")}
      </>
    );
  if (kind === "moss")
    extra = (
      <>
        {[
          [60, 70, 18],
          [85, 80, 12],
          [40, 88, 10],
          [110, 62, 9],
        ].map((m) => (
          <Circle key={m.join()} cx={m[0]} cy={m[1]} r={m[2]} fill="#6E8B3D" opacity={0.9} />
        ))}
        {box(22, 44, 110, 60, "#B8A21A")}
      </>
    );
  return (
    <View style={{ borderRadius: 10, overflow: "hidden", marginVertical: 8, backgroundColor: "#7E4636" }} onLayout={(e) => setW(e.nativeEvent.layout.width)} accessible accessibilityLabel="Close-up photo">
      {w > 0 && (
        <Svg width={w} height={(w * 130) / 300} viewBox="0 0 300 130">
          {tiles}
          {extra}
        </Svg>
      )}
    </View>
  );
}
