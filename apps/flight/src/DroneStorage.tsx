// How many photos still fit on the drone, and a button to wipe its storage (two taps, on the ground).
// Repeated simulator tests fill the drone's memory; a full drone cannot take a scan's photos.

import { useState } from "react";
import { View } from "react-native";

import { DjiDrone } from "../modules/dji-drone";
import { drone, useDrone } from "./drone";
import { Btn, Note, Status } from "./ui";

export function DroneStorage() {
  const d = useDrone();
  const t = d.telemetry;
  const [confirm, setConfirm] = useState(false);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const left = t?.photosLeft;
  if (left === undefined) return null;
  const onGround = !d.flying && t?.flightMode === "onGround";

  async function format() {
    if (!confirm) {
      setConfirm(true);
      setMsg(null);
      return;
    }
    setConfirm(false);
    setBusy(true);
    drone.addLog("Formatting the drone's storage…");
    try {
      await DjiDrone.formatStorage();
      drone.addLog("Drone storage formatted.");
      setMsg({ ok: true, text: "Done: the drone's storage is empty." });
    } catch (e) {
      const why = (e as Error).message;
      drone.addLog(`Could not format the drone's storage: ${why}`);
      setMsg({ ok: false, text: `Could not format: ${why}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ marginTop: 8 }}>
      <Note>Drone storage: room for {left} more photo{left === 1 ? "" : "s"}.</Note>
      <Btn
        label={busy ? "Formatting…" : confirm ? "Tap again: erase every photo on the drone" : "Format the drone's storage"}
        alt={!confirm}
        danger={confirm}
        disabled={busy || !onGround}
        onPress={format}
      />
      {confirm && <Note>This wipes all photos and videos on the drone for good. Copy off any you want to keep first.</Note>}
      {confirm && <Btn label="Cancel" alt onPress={() => setConfirm(false)} />}
      {msg && <Status status={msg.ok ? "pass" : "block"} text={msg.text} />}
    </View>
  );
}
