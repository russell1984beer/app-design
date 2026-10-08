// Plotwise: the app, laid out like the prototype (prototype/plotwise-prototype.html): a map of the
// plot on top, a panel for the current tab underneath, and six tabs along the bottom.

import { StatusBar } from "expo-status-bar";
import { useEffect } from "react";
import { KeyboardAvoidingView, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from "react-native";
import { SafeAreaProvider, useSafeAreaInsets } from "react-native-safe-area-context";
import Svg, { Circle, Path, Rect } from "react-native-svg";

import { canFly } from "./modules/dji-drone";
import { drone } from "./src/drone";
import { EmergencyBar } from "./src/EmergencyBar";
import { MapView } from "./src/MapView";
import { DesignPanel } from "./src/panels/DesignPanel";
import { MaterialsPanel } from "./src/panels/MaterialsPanel";
import { PlanPanel } from "./src/panels/PlanPanel";
import { RoofPanel } from "./src/panels/RoofPanel";
import { ScanPanel } from "./src/panels/ScanPanel";
import { SurveyPanel } from "./src/panels/SurveyPanel";
import { go, loadSaved, useApp, type Tab } from "./src/store";
import { TestBench } from "./src/TestBench";
import { C } from "./src/theme";

export default function App() {
  return (
    <SafeAreaProvider>
      <Shell />
    </SafeAreaProvider>
  );
}

function Shell() {
  const s = useApp();
  const insets = useSafeAreaInsets();
  const { width, height } = useWindowDimensions();
  // Side by side on tablets, and on the phone turned sideways in the controller.
  const wide = width >= 820 || width > height;

  useEffect(() => {
    loadSaved();
    drone.start();
  }, []);

  if (s.showBench) {
    return (
      <View style={{ flex: 1, paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: "#e9eee9" }}>
        <StatusBar style="dark" />
        <TestBench />
        <EmergencyBar />
      </View>
    );
  }

  const Panel = { plan: PlanPanel, scan: ScanPanel, survey: SurveyPanel, design: DesignPanel, roof: RoofPanel, quote: MaterialsPanel }[s.tab];

  return (
    <View style={[styles.body, { paddingTop: insets.top }]}>
      <StatusBar style="dark" />
      <View style={styles.header}>
        <Text style={styles.brand}>Plotwise</Text>
        <Text style={styles.proj}>Test property, whole plot</Text>
      </View>
      <KeyboardAvoidingView behavior="height" style={[styles.main, wide && { flexDirection: "row" }]}>
        <View style={[styles.mapWrap, wide && { paddingHorizontal: 16, paddingVertical: 8 }]}>
          <MapView />
        </View>
        <View style={[styles.panel, wide ? { width: 390, maxHeight: undefined, borderTopRightRadius: 0 } : { maxHeight: height * 0.46 }]}>
          <ScrollView contentContainerStyle={{ padding: 18, paddingTop: 16 }} keyboardShouldPersistTaps="handled">
            <Panel />
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
      <EmergencyBar />
      <Nav tab={s.tab} bottom={insets.bottom} />
    </View>
  );
}

const TABS: [Tab, string][] = [
  ["plan", "Plan"],
  ["scan", "Scan"],
  ["survey", "Survey"],
  ["design", "Design"],
  ["roof", "Roof"],
  ["quote", "Materials"],
];

function Nav({ tab, bottom }: { tab: Tab; bottom: number }) {
  return (
    <View style={[styles.nav, { paddingBottom: bottom }]} accessibilityRole="tablist">
      {TABS.filter(([id]) => canFly || id !== "scan").map(([id, label]) => {
        const on = tab === id;
        return (
          <Pressable key={id} accessibilityRole="tab" accessibilityState={{ selected: on }} onPress={() => go(id)} style={styles.navBtn}>
            <View style={[styles.navIcon, on && { backgroundColor: C.hivis }]}>
              <TabIcon id={id} colour={on ? C.ink : C.muted} />
            </View>
            <Text style={[styles.navText, on && { color: C.ink, fontWeight: "700" }]}>{label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

function TabIcon({ id, colour }: { id: Tab; colour: string }) {
  const p = { stroke: colour, strokeWidth: 1.8, fill: "none", strokeLinecap: "round", strokeLinejoin: "round" } as const;
  return (
    <Svg width={22} height={20} viewBox="0 0 24 24">
      {id === "plan" && (
        <>
          <Path d="M4 6l5-2 6 2 5-2v14l-5 2-6-2-5 2z" {...p} />
          <Path d="M9 4v14M15 6v14" {...p} />
        </>
      )}
      {id === "scan" && (
        <>
          <Circle cx={6} cy={6} r={2.5} {...p} />
          <Circle cx={18} cy={6} r={2.5} {...p} />
          <Circle cx={6} cy={18} r={2.5} {...p} />
          <Circle cx={18} cy={18} r={2.5} {...p} />
          <Rect x={9.5} y={9.5} width={5} height={5} rx={1} {...p} />
          <Path d="M8 8l1.5 1.5M16 8l-1.5 1.5M8 16l1.5-1.5M16 16l-1.5-1.5" {...p} />
        </>
      )}
      {id === "survey" && <Path d="M3 17c3-4 6-4 9-1s6 3 9-1M3 11c3-4 6-4 9-1s6 3 9-1" {...p} />}
      {id === "design" && (
        <>
          <Rect x={4} y={4} width={7} height={7} {...p} />
          <Circle cx={17} cy={7.5} r={3.5} {...p} />
          <Rect x={4} y={14} width={16} height={6} {...p} />
        </>
      )}
      {id === "roof" && <Path d="M3 12l9-7 9 7M6 10v9h12v-9M14 13l-2 3h3l-2 3" {...p} />}
      {id === "quote" && <Path d="M6 3h9l3 3v15H6zM9 10h6M9 14h6M9 18h4" {...p} />}
    </Svg>
  );
}

const styles = StyleSheet.create({
  body: { flex: 1, backgroundColor: C.ground },
  header: { flexDirection: "row", alignItems: "baseline", justifyContent: "space-between", gap: 12, paddingTop: 14, paddingHorizontal: 16, paddingBottom: 6 },
  brand: { fontWeight: "800", fontSize: 22, color: C.ink, letterSpacing: -0.2 },
  proj: { fontSize: 13, color: C.muted, textAlign: "right", flexShrink: 1 },
  main: { flex: 1, minHeight: 0 },
  mapWrap: { flex: 1, minHeight: 0, paddingHorizontal: 8 },
  panel: { backgroundColor: C.paper, borderTopLeftRadius: 20, borderTopRightRadius: 20, borderTopWidth: 1, borderColor: C.line },
  nav: { flexDirection: "row", backgroundColor: C.paper, borderTopWidth: 1, borderColor: C.line },
  navBtn: { flex: 1, alignItems: "center", gap: 3, paddingTop: 9, paddingBottom: 11 },
  navIcon: { borderRadius: 8, paddingHorizontal: 6, paddingVertical: 2 },
  navText: { fontSize: 11, color: C.muted },
});
