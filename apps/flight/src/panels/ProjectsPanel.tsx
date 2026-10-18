import { useState } from "react";
import { Alert, Image, Text, View } from "react-native";

import { areaM2 } from "../../../../packages/flight-core/src/geo.ts";

import { addProject, deleteProject, drawingUri, findPostcode, openProject, pickDrawing, renameProject } from "../projects";
import { HOME_PROJECT_ID, S, commit, currentProject, useApp } from "../store";
import { C } from "../theme";
import { Btn, Card, Field, H2, Lead, Line, Note, Status } from "../ui";

export function ProjectsPanel() {
  const s = useApp();
  const p = currentProject();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  async function run(task: () => Promise<unknown>, ok?: string) {
    setBusy(true);
    setMessage(null);
    try {
      await task();
      if (ok) setMessage({ ok: true, text: ok });
    } catch (e) {
      setMessage({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const uri = drawingUri(p);
  return (
    <View>
      <H2>Projects</H2>
      <Lead>Each property has its own plot, scans and design. Tap one to open it.</Lead>
      {s.projects.map((x) => (
        <Btn
          key={x.id}
          label={x.id === s.projectId ? `${x.name} (open)` : x.name}
          alt={x.id !== s.projectId}
          disabled={busy}
          onPress={() => run(() => openProject(x.id))}
        />
      ))}
      {/* Added straight from the name box: a separate button could act before the typed name arrived. */}
      <Field
        label="Add a project: type its name and press the tick"
        value=""
        placeholder="e.g. 12 High Street"
        onCommit={(v) => {
          if (v.trim() && !busy) run(() => addProject(v), "Project added and opened.");
        }}
      />

      <H2 small>{p.name}</H2>
      <Field label="Name" value={p.name} onCommit={renameProject} />
      <Field
        label="Postcode"
        value={p.postcode}
        placeholder="e.g. AB1 2CD"
        onCommit={(v) => {
          if (v.trim() && v.trim().toUpperCase() !== p.postcode) run(() => findPostcode(v), "Postcode found: the satellite map will start there.");
        }}
      />
      {p.postcodeAt ? (
        <Note>Postcode found. The satellite map starts at its middle; your plot may be a little way off.</Note>
      ) : (
        <Note>Type the postcode and press the tick on the keyboard to find it.</Note>
      )}

      <H2 small>Plot drawing</H2>
      <Lead>
        The Land Registry title plan: its PDF file as downloaded (the first page is used), or a photo or screenshot of it. You line it up over a satellite
        photo and mark the corners (or trace the boundary, for any other shape), and the app works out the plot's size, direction and exact position.
      </Lead>
      {uri && p.drawing && (
        <Image source={{ uri }} style={{ width: "100%", aspectRatio: p.drawing.widthPx / p.drawing.heightPx, borderRadius: 10, marginBottom: 8 }} resizeMode="contain" />
      )}
      <Btn label={p.drawing ? "Choose a different title plan" : "Upload the title plan (PDF or picture)"} alt={!!p.drawing} disabled={busy} onPress={() => run(pickDrawing)} />
      <Btn
        label={p.corners ? "Line up again" : "Line it up on the map"}
        disabled={busy || !p.drawing || !p.postcodeAt}
        onPress={() => {
          S.lineUp = true;
          commit();
        }}
      />
      {(!p.drawing || !p.postcodeAt) && <Note>Find the postcode and upload the drawing first.</Note>}
      {p.corners && (
        <Card>
          {p.boundary && <Line first k="Boundary traced" v={`${p.boundary.length} points, about ${Math.round(areaM2(p.boundary))} m²`} />}
          <Line first={!p.boundary} k={p.boundary ? "Rectangle round it" : "Plot from the drawing"} v={`${s.plot.widthM} × ${s.plot.lengthM} m`} />
          <Line k="Rear garden" v={`${s.plot.rearGardenM} m`} />
          <Line k="Garden runs" v={`${s.plot.gardenBearingDeg}°`} />
          <Line k="Far corner (left)" v={`${p.corners[0].lat.toFixed(6)}, ${p.corners[0].lng.toFixed(6)}`} />
        </Card>
      )}
      <Note>
        {p.corners
          ? "Real flights are placed from this line-up: put the drone on the yellow take-off point (Plan map) and the app checks it is there before take-off. It still takes off from, and comes home to, the spot where it stands."
          : "Until the corners are marked, real flights line up on the drone: put it on the yellow take-off point before take-off."}
      </Note>

      {message && <Status status={message.ok ? "pass" : "block"} text={message.text} />}

      {s.projects.length > 1 && (
        <>
          <H2 small>Other projects</H2>
          {s.projects
            .filter((x) => x.id !== s.projectId && x.id !== HOME_PROJECT_ID)
            .map((x) => (
              <Btn
                key={`del-${x.id}`}
                label={`Delete ${x.name}`}
                danger
                alt
                disabled={busy}
                onPress={() =>
                  Alert.alert(`Delete ${x.name}?`, "Its plot, design, drawing and survey are removed from this phone.", [
                    { text: "Keep", style: "cancel" },
                    { text: "Delete", style: "destructive", onPress: () => deleteProject(x.id) },
                  ])
                }
              />
            ))}
          <Text style={{ color: C.muted, fontSize: 13 }}>The first project (your own property) cannot be deleted.</Text>
        </>
      )}
    </View>
  );
}
