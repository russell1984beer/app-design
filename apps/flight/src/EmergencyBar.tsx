// The emergency STOP button. Shown above the panel on every tab while the app is flying the
// drone, so the pilot can stop it in one tap if they see an obstacle. The drone then hovers in
// place until the pilot chooses: carry on, come home, or land where it is.

import { useEffect, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";

import { useDrone } from "./drone";
import { C } from "./theme";

const STOPPABLE = ["takingOff", "climbing", "scanning"];

export function EmergencyBar() {
  const d = useDrone();
  const [confirmLand, setConfirmLand] = useState(false);
  const state = d.job?.session.state;
  const holding = state === "holding";

  useEffect(() => {
    if (!holding) setConfirmLand(false);
  }, [holding]);

  if (!state || (!holding && !STOPPABLE.includes(state))) return null;

  if (!holding) {
    return (
      <View style={styles.bar}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Emergency stop. The drone stops and hovers where it is."
          onPress={() => d.hold()}
          style={({ pressed }) => [styles.stop, pressed && { opacity: 0.8 }]}
        >
          <Text style={styles.stopText}>STOP</Text>
          <Text style={styles.stopSub}>Stop and hover here</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={[styles.bar, styles.held]} accessibilityLiveRegion="assertive">
      <Text style={styles.heldTitle}>Stopped. Hovering in place.</Text>
      <Text style={styles.heldNote}>
        Low battery, strong wind or leaving the area still bring it home by itself. To fly it yourself, press Pause on the controller, then use the sticks.
      </Text>
      <View style={styles.row}>
        <Choice label="Resume scan" onPress={() => d.resume()} />
        <Choice label="Return home" onPress={() => d.returnHome()} />
        <Choice
          label={confirmLand ? "Tap again: land here" : "Land here"}
          warn={confirmLand}
          onPress={() => {
            if (confirmLand) d.landHere();
            else setConfirmLand(true);
          }}
        />
      </View>
      {confirmLand && <Text style={styles.heldNote}>Only if the ground directly below is clear of people, pets and obstacles.</Text>}
    </View>
  );
}

function Choice({ label, onPress, warn }: { label: string; onPress: () => void; warn?: boolean }) {
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.choice, warn && { backgroundColor: C.stop, borderColor: C.stop }]}>
      <Text style={[styles.choiceText, warn && { color: C.white }]}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bar: { paddingHorizontal: 12, paddingVertical: 8, backgroundColor: C.ground },
  stop: { backgroundColor: C.stop, borderRadius: 14, paddingVertical: 14, alignItems: "center", borderWidth: 3, borderColor: "#7A1F12" },
  stopText: { color: C.white, fontSize: 24, fontWeight: "900", letterSpacing: 2 },
  stopSub: { color: C.white, fontSize: 13, fontWeight: "600" },
  held: { backgroundColor: C.hivis, gap: 6, paddingVertical: 12 },
  heldTitle: { fontSize: 17, fontWeight: "800", color: C.ink },
  heldNote: { fontSize: 12.5, color: C.ink, lineHeight: 17 },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  choice: { flexGrow: 1, borderRadius: 10, borderWidth: 2, borderColor: C.ink, backgroundColor: C.white, paddingVertical: 11, paddingHorizontal: 10 },
  choiceText: { color: C.ink, fontWeight: "800", fontSize: 14, textAlign: "center" },
});
