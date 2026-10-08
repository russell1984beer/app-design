import { Pressable, Text, View } from "react-native";

import {
  DRAWABLE,
  KINDS,
  KIND_ORDER,
  MATERIALS,
  MONTHS,
  STYLES,
  SUN_LABEL,
  applyStyle,
  area,
  bedSun,
  clampToPlot,
  clockText,
  duplicate,
  isRound,
  itemArea,
  itemName,
  itemPerimeter,
  levelling,
  materialOf,
  plantCount,
  plantPool,
  rotate90,
  suggestPlants,
  sunText,
  type Item,
  type Plant,
} from "../../../../packages/garden-core/src/index.ts";

import { terrainFor } from "../MapView";
import { S, commit, go, history, nextId, useApp } from "../store";
import { C } from "../theme";
import { Btn, Check, Chip, Chips, Field, H2, Legend, Lead, Note, P, Readout, Row, Seg, Stepper } from "../ui";
import { EmptyState } from "./SurveyPanel";

const newWork = () => S.items.filter((i) => !i.exist);

function change(fn: () => void) {
  history.push(S.items);
  fn();
  commit();
}

export function DesignPanel() {
  const s = useApp();
  if (!s.scanned) return <EmptyState what="Your design" />;
  return (
    <View>
      <H2>Design</H2>
      <Seg
        options={[["layout", "Layout"], ["sun", "Sun and shade"], ["plants", "Plants"]]}
        value={s.dmode}
        onChange={(v) => {
          s.dmode = v;
          s.placing = null;
          s.drawing = null;
          commit();
        }}
      />
      {s.dmode === "sun" ? <SunPanel /> : s.dmode === "plants" ? <PlantsPanel /> : <LayoutPanel />}
      {newWork().length > 0 && <Btn label="See materials" onPress={() => go("quote")} />}
    </View>
  );
}

function Tools() {
  const s = S;
  return (
    <View style={{ flexDirection: "row", gap: 8, alignItems: "center", marginBottom: 10 }}>
      <SmallBtn
        label="Undo"
        disabled={!history.canUndo}
        onPress={() => {
          const prev = history.undo(s.items);
          if (!prev) return;
          s.items = prev;
          if (!s.items.find((i) => i.id === s.sel)) s.sel = null;
          s.vsel = null;
          commit();
        }}
      />
      <SmallBtn
        label="Redo"
        disabled={!history.canRedo}
        onPress={() => {
          const next = history.redo(s.items);
          if (!next) return;
          s.items = next;
          if (!s.items.find((i) => i.id === s.sel)) s.sel = null;
          s.vsel = null;
          commit();
        }}
      />
      <View style={{ marginLeft: "auto" }}>
        <Check
          checked={s.snap}
          title="Snap to 10 cm"
          onChange={(v) => {
            s.snap = v;
            commit();
          }}
        />
      </View>
    </View>
  );
}

function SmallBtn({ label, onPress, disabled }: { label: string; onPress: () => void; disabled?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      onPress={onPress}
      disabled={disabled}
      style={{ borderWidth: 1.5, borderColor: C.line, backgroundColor: C.white, borderRadius: 8, paddingVertical: 6, paddingHorizontal: 12, opacity: disabled ? 0.4 : 1 }}
    >
      <Text style={{ fontSize: 13, color: C.ink }}>{label}</Text>
    </Pressable>
  );
}

const swatchOf = (k: keyof typeof KINDS) => MATERIALS[k]?.[0][2] ?? KINDS[k].fill;

function LayoutPanel() {
  const s = S;
  if (s.drawing) {
    const D = s.drawing;
    const n = D.pts.length;
    return (
      <View>
        <Tools />
        <Note style={{ marginBottom: 6 }}>What are you drawing?</Note>
        <Chips>
          {DRAWABLE.map((k) => (
            <Chip
              key={k}
              label={KINDS[k].label}
              swatch={swatchOf(k)}
              swatchBorder={KINDS[k].stroke}
              pressed={D.kind === k}
              onPress={() => {
                D.kind = k;
                commit();
              }}
            />
          ))}
        </Chips>
        <Readout>
          <P>
            Tap the plan to place each corner of the shape. {n ? `${n} corner${n > 1 ? "s" : ""} so far${n > 2 ? `, ${area(D.pts).toFixed(1)} m²` : ""}.` : ""}{" "}
            {n < 3 ? "You need at least 3 corners." : "Tap Finish when the outline is complete."}
          </P>
        </Readout>
        <Row>
          <Btn
            label="Finish shape"
            style={{ flex: 1 }}
            disabled={n < 3}
            onPress={() =>
              change(() => {
                const it: Item = { id: nextId(), kind: D.kind, x: 0, y: 0, w: 0, h: 0, a: 0, pts: D.pts };
                if (it.kind === "bed") it.plants = suggestPlants(s.plot, s.items, it);
                s.items.push(it);
                s.sel = it.id;
                s.drawing = null;
              })
            }
          />
          <Btn
            label="Remove last"
            alt
            style={{ flex: 1 }}
            disabled={!n}
            onPress={() => {
              D.pts.pop();
              commit();
            }}
          />
          <Btn
            label="Cancel"
            alt
            style={{ flex: 1 }}
            onPress={() => {
              s.drawing = null;
              commit();
            }}
          />
        </Row>
      </View>
    );
  }

  const it = s.items.find((i) => i.id === s.sel);
  let body;
  if (s.placing) {
    body = (
      <Readout>
        <P>Tap the plan to place the {KINDS[s.placing].label.toLowerCase()}.</P>
      </Readout>
    );
  } else if (it) body = <ItemEditor it={it} />;
  else
    body = (
      <Readout>
        <P>
          Tap anything on the plan to edit it, including existing features like the patio, greenhouse and trees. Pick a style for a starting layout, add features one at a
          time, or draw your own shapes.
        </P>
      </Readout>
    );

  return (
    <View>
      <Tools />
      <Note style={{ marginBottom: 6 }}>Start from a style</Note>
      <Chips>
        {Object.entries(STYLES).map(([k, st]) => (
          <Chip
            key={k}
            label={st.label}
            pressed={s.style === k}
            onPress={() =>
              change(() => {
                const r = applyStyle(s.items, k, nextId);
                for (const a of r.added) if (a.kind === "bed" || a.kind === "raised") a.plants = suggestPlants(s.plot, r.items, a);
                s.items = r.items;
                s.style = k;
                s.styleNote = r.note;
                s.sel = null;
                s.placing = null;
              })
            }
          />
        ))}
      </Chips>
      {s.style && (
        <Note style={{ marginTop: -4, marginBottom: 12 }}>
          {STYLES[s.style].desc}. {s.styleNote} Everything can be edited.
        </Note>
      )}
      <Note style={{ marginBottom: 6 }}>Add a feature</Note>
      <Chips>
        {KIND_ORDER.map((k) => (
          <Chip
            key={k}
            label={KINDS[k].label}
            swatch={swatchOf(k)}
            swatchBorder={KINDS[k].stroke}
            pressed={s.placing === k}
            onPress={() => {
              s.placing = s.placing === k ? null : k;
              s.sel = null;
              commit();
            }}
          />
        ))}
        <Chip
          label="Draw your own shape"
          swatch="#fff"
          dashed
          onPress={() => {
            s.drawing = { kind: "lawn", pts: [] };
            s.sel = null;
            s.placing = null;
            commit();
          }}
        />
      </Chips>
      {body}
    </View>
  );
}

function ItemEditor({ it }: { it: Item }) {
  const s = S;
  const L = levelling(it, terrainFor(s.plot).z);
  const mats = MATERIALS[it.kind];
  const num = (v: string, apply: (n: number) => void) => {
    const n = parseFloat(v.replace(",", "."));
    if (isNaN(n)) return commit();
    change(() => {
      apply(n);
      clampToPlot(s.plot, it);
    });
  };
  const size = (f: "w" | "h") => (v: string) =>
    num(v, (n) => {
      it[f] = Math.max(0.3, Math.min(f === "w" ? s.plot.widthM : s.plot.lengthM, n));
      if (isRound(it.kind)) it.h = it.w;
    });
  return (
    <View>
      <Readout>
        <Field
          label="Name"
          value={it.label ?? ""}
          placeholder={KINDS[it.kind].label}
          onCommit={(v) => change(() => (it.label = v.trim() || undefined))}
        />
        {mats && (
          <>
            <Text style={{ fontSize: 12, color: C.muted, marginBottom: 4 }}>Material</Text>
            <Chips>
              {mats.map((m) => (
                <Chip key={m[0]} label={m[1]} swatch={m[2]} pressed={materialOf(it)?.[0] === m[0]} onPress={() => change(() => (it.mat = m[0]))} />
              ))}
            </Chips>
          </>
        )}
        {it.pts ? (
          <>
            <Note style={{ marginBottom: 8 }}>
              Custom shape, {itemArea(it).toFixed(1)} m², perimeter {itemPerimeter(it).toFixed(1)} m. Drag a square corner to reshape it, or drag a + to add a new corner.
            </Note>
            {s.vsel != null && it.pts.length > 3 && (
              <Btn
                label="Remove selected corner"
                alt
                style={{ marginTop: 0, marginBottom: 8 }}
                onPress={() =>
                  change(() => {
                    it.pts!.splice(s.vsel!, 1);
                    s.vsel = null;
                  })
                }
              />
            )}
          </>
        ) : isRound(it.kind) ? (
          <Field label="Across (m)" value={it.w.toFixed(1)} numeric onCommit={size("w")} />
        ) : (
          <View style={{ flexDirection: "row", gap: 8 }}>
            <Field label="Width (m)" value={it.w.toFixed(1)} numeric onCommit={size("w")} />
            <Field label="Length (m)" value={it.h.toFixed(1)} numeric onCommit={size("h")} />
            <Field label="Angle (°)" value={String(Math.round(it.a))} numeric onCommit={(v) => num(v, (n) => (it.a = ((n % 360) + 360) % 360))} />
          </View>
        )}
        <Note>
          Ground falls {(L.fall * 100).toFixed(0)} cm across it. Drag it to move{it.pts ? "" : ", the white square to resize"}
          {it.pts || isRound(it.kind) ? "" : " and the yellow dot to rotate"}.
        </Note>
        {it.exist && (
          <>
            <Note style={{ marginTop: 8 }}>This is an existing feature, so it isn't counted in materials.</Note>
            <Btn label="Count it as new work" alt style={{ marginTop: 6 }} onPress={() => change(() => delete it.exist)} />
          </>
        )}
      </Readout>
      <Row>
        <Btn
          label="Duplicate"
          alt
          style={{ flex: 1 }}
          onPress={() =>
            change(() => {
              const n = duplicate(s.plot, it, nextId());
              s.items.push(n);
              s.sel = n.id;
              s.vsel = null;
            })
          }
        />
        {!isRound(it.kind) && <Btn label="Rotate 90°" alt style={{ flex: 1 }} onPress={() => change(() => rotate90(s.plot, it))} />}
        <Btn
          label="Remove"
          alt
          style={{ flex: 1 }}
          onPress={() =>
            change(() => {
              s.items = s.items.filter((i) => i !== it);
              s.sel = null;
              s.vsel = null;
            })
          }
        />
      </Row>
      {(it.kind === "bed" || it.kind === "raised") && (
        <Btn
          label="Choose plants"
          alt
          onPress={() => {
            s.dmode = "plants";
            commit();
          }}
        />
      )}
    </View>
  );
}

function SunPanel() {
  const s = S;
  const month = MONTHS.find((m) => m.id === s.month)!;
  return (
    <View>
      <Lead>
        Your rear garden faces {s.plot.gardenBearingDeg > 112 && s.plot.gardenBearingDeg < 158 ? "south-east" : "this way"}, going by the north arrow on your title plan. Shadows include your
        house, the neighbouring houses, 1.8 m fences, trees and any shed you add.
      </Lead>
      <Seg
        options={MONTHS.map((m) => [m.id, m.label.slice(0, 3)] as [string, string])}
        value={s.month}
        onChange={(v) => {
          s.month = v;
          commit();
        }}
      />
      <Check
        checked={s.hours}
        title="Show hours of sun across the day"
        detail={`Colours each part of the garden by how much direct sun it gets in ${month.label}`}
        onChange={(v) => {
          s.hours = v;
          commit();
        }}
      />
      {s.hours ? (
        <Legend items={[["#F2CF5B", "6 hours or more"], ["#C9DC9A", "3 to 6 hours"], ["#8FA7A0", "Under 3 hours"]]} />
      ) : (
        <>
          <Stepper
            label="Time of day"
            value={s.time}
            min={5}
            max={21.5}
            step={0.5}
            format={clockText}
            onChange={(v) => {
              s.time = v;
              commit();
            }}
          />
          <Readout>
            <P>{sunText(s.plot, month.day, s.time)}</P>
          </Readout>
        </>
      )}
    </View>
  );
}

function PlantsPanel() {
  const s = S;
  const beds = s.items.filter((i) => i.kind === "bed" || i.kind === "raised");
  if (!beds.length)
    return (
      <View>
        <Readout>
          <P>Add a planting bed or raised bed in Layout, then choose plants for it here.</P>
        </Readout>
        <Btn
          label="Go to layout"
          alt
          onPress={() => {
            s.dmode = "layout";
            commit();
          }}
        />
      </View>
    );
  const it = beds.find((i) => i.id === s.sel);
  const list = (
    <Chips>
      {beds.map((b, n) => (
        <Chip
          key={b.id}
          label={`${b.label || `${KINDS[b.kind].label} ${n + 1}`}, ${SUN_LABEL[bedSun(s.plot, s.items, b).cls].toLowerCase()}`}
          pressed={it?.id === b.id}
          onPress={() => {
            s.sel = b.id;
            commit();
          }}
        />
      ))}
    </Chips>
  );
  if (!it)
    return (
      <View>
        <Lead>Plants are matched to how much sun each bed gets on an average day from spring to autumn.</Lead>
        {list}
        <Readout>
          <P>Tap a bed on the plan or in the list to choose its plants.</P>
        </Readout>
      </View>
    );
  const bs = bedSun(s.plot, s.items, it);
  const pool = plantPool(it);
  const good = pool.filter((p) => p.sun === bs.cls);
  const other = pool.filter((p) => p.sun !== bs.cls);
  const card = (p: Plant) => {
    const on = (it.plants ?? []).includes(p.id);
    return (
      <Chip
        key={p.id}
        wide
        round
        swatch={p.colour}
        swatchBorder="#2F3B2A"
        pressed={on}
        label={`${p.name}${on ? `, ${plantCount(it, p.id)} plants` : ""}`}
        sub={`${p.note}. ${SUN_LABEL[p.sun]}, ${Math.round(p.spacingM * 100)} cm apart`}
        onPress={() =>
          change(() => {
            const ids = it.plants ?? [];
            it.plants = ids.includes(p.id) ? ids.filter((x) => x !== p.id) : [...ids, p.id];
          })
        }
      />
    );
  };
  return (
    <View>
      {list}
      <View style={{ marginBottom: 10 }}>
        <Readout>
          <P bold>
            {itemName(it)}, {itemArea(it).toFixed(1)} m²
          </P>
          <P>
            Gets about {bs.hours.toFixed(1)} hours of direct sun a day: {SUN_LABEL[bs.cls].toLowerCase()}.
          </P>
        </Readout>
      </View>
      <Note style={{ marginBottom: 6 }}>Good for this spot</Note>
      <View style={{ gap: 8 }}>{good.length ? good.map(card) : <Note>Nothing in the library suits this spot well.</Note>}</View>
      <Note style={{ marginTop: 10, marginBottom: 6 }}>May struggle here</Note>
      <View style={{ gap: 8 }}>{other.map(card)}</View>
      <Note style={{ marginTop: 10 }}>Plant numbers fill the bed at each plant's recommended spacing, shared equally between the plants you pick.</Note>
    </View>
  );
}
