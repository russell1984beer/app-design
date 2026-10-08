// Small building blocks matching the prototype's panel styles.

import type { ReactNode } from "react";
import { Pressable, StyleSheet, Text, TextInput, View, type StyleProp, type ViewStyle } from "react-native";

import { C } from "./theme";

export function H2({ children, small }: { children: ReactNode; small?: boolean }) {
  return <Text style={[s.h2, small && { fontSize: 16, marginTop: 6 }]}>{children}</Text>;
}

export function Lead({ children }: { children: ReactNode }) {
  return <Text style={s.lead}>{children}</Text>;
}

export function Note({ children, style }: { children: ReactNode; style?: object }) {
  return <Text style={[s.note, style]}>{children}</Text>;
}

export function Btn({
  label,
  onPress,
  alt,
  disabled,
  danger,
  style,
}: {
  label: string;
  onPress: () => void;
  alt?: boolean;
  disabled?: boolean;
  danger?: boolean;
  style?: StyleProp<ViewStyle>;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ disabled }}
      onPress={onPress}
      disabled={disabled}
      style={[s.btn, alt && s.btnAlt, danger && { backgroundColor: C.stop }, disabled && { opacity: 0.4 }, style]}
    >
      <Text style={[s.btnText, alt && { color: C.ink }]}>{label}</Text>
    </Pressable>
  );
}

export function Row({ children }: { children: ReactNode }) {
  return <View style={s.row}>{children}</View>;
}

export function Seg<T extends string>({ options, value, onChange }: { options: [T, string][]; value: T; onChange: (v: T) => void }) {
  return (
    <View style={s.seg} accessibilityRole="radiogroup">
      {options.map(([k, label]) => (
        <Pressable
          key={k}
          accessibilityRole="radio"
          accessibilityState={{ selected: value === k }}
          onPress={() => onChange(k)}
          style={[s.segBtn, value === k && s.segOn]}
        >
          <Text style={[s.segText, value === k && { fontWeight: "700" }]}>{label}</Text>
        </Pressable>
      ))}
    </View>
  );
}

export function Check({
  checked,
  onChange,
  title,
  detail,
  disabled,
}: {
  checked: boolean;
  onChange?: (v: boolean) => void;
  title: string;
  detail?: string;
  disabled?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityState={{ checked, disabled }}
      disabled={disabled || !onChange}
      onPress={() => onChange?.(!checked)}
      style={s.check}
    >
      <View style={[s.box, checked && { backgroundColor: C.leaf, borderColor: C.leaf }, disabled && { opacity: 0.5 }]}>
        {checked && <Text style={s.tick}>✓</Text>}
      </View>
      <View style={{ flex: 1 }}>
        <Text style={s.checkText}>{title}</Text>
        {detail ? <Text style={s.checkSmall}>{detail}</Text> : null}
      </View>
    </Pressable>
  );
}

/** A check that the app works out itself: pass, warning or stop. */
export function Status({ status, text }: { status: "pass" | "warn" | "block"; text: string }) {
  const colour = status === "pass" ? C.ok : status === "warn" ? C.warn : C.stop;
  const mark = status === "pass" ? "✓" : status === "warn" ? "!" : "✕";
  return (
    <View style={s.check}>
      <View style={[s.box, { backgroundColor: colour, borderColor: colour }]}>
        <Text style={s.tick}>{mark}</Text>
      </View>
      <Text style={[s.checkText, { flex: 1 }]}>{text}</Text>
    </View>
  );
}

export function Stats({ items }: { items: [string, string][] }) {
  return (
    <View style={s.stats}>
      {items.map(([big, small], i) => (
        <View key={i} style={s.stat}>
          <Text style={s.statBig}>{big}</Text>
          <Text style={s.statSmall}>{small}</Text>
        </View>
      ))}
    </View>
  );
}

export function Stepper({
  label,
  value,
  onChange,
  min,
  max,
  step,
  format,
}: {
  label: string;
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step: number;
  format: (v: number) => string;
}) {
  const set = (v: number) => onChange(Math.round(Math.min(max, Math.max(min, v)) * 100) / 100);
  return (
    <View style={s.step}>
      <Text style={s.stepLabel}>{label}</Text>
      <View style={s.stepCtl}>
        <Pressable accessibilityRole="button" accessibilityLabel={`Less ${label}`} onPress={() => set(value - step)} disabled={value <= min} style={[s.stepBtn, value <= min && { opacity: 0.4 }]}>
          <Text style={s.stepBtnText}>−</Text>
        </Pressable>
        <Text style={s.stepValue}>{format(value)}</Text>
        <Pressable accessibilityRole="button" accessibilityLabel={`More ${label}`} onPress={() => set(value + step)} disabled={value >= max} style={[s.stepBtn, value >= max && { opacity: 0.4 }]}>
          <Text style={s.stepBtnText}>+</Text>
        </Pressable>
      </View>
    </View>
  );
}

export function Bar({ fraction }: { fraction: number }) {
  return (
    <View style={s.bar}>
      <View style={[s.barFill, { width: `${Math.max(0, Math.min(1, fraction)) * 100}%` }]} />
    </View>
  );
}

export function Readout({ children }: { children: ReactNode }) {
  return <View style={s.readout}>{children}</View>;
}

export function Big({ children }: { children: ReactNode }) {
  return <Text style={s.big}>{children}</Text>;
}

export function P({ children, bold }: { children: ReactNode; bold?: boolean }) {
  return <Text style={[s.p, bold && { fontWeight: "700" }]}>{children}</Text>;
}

export function Chips({ children }: { children: ReactNode }) {
  return <View style={s.chips}>{children}</View>;
}

export function Chip({
  label,
  pressed,
  onPress,
  swatch,
  swatchBorder,
  round,
  wide,
  sub,
  dashed,
}: {
  label: string;
  pressed?: boolean;
  onPress: () => void;
  swatch?: string;
  swatchBorder?: string;
  round?: boolean;
  wide?: boolean;
  sub?: string;
  dashed?: boolean;
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: !!pressed }}
      onPress={onPress}
      style={[s.chip, pressed && s.chipOn, wide && s.chipWide]}
    >
      {swatch !== undefined && (
        <View
          style={[
            s.swatch,
            { backgroundColor: swatch, borderColor: swatchBorder ?? C.line },
            round && { borderRadius: 9 },
            dashed && { borderStyle: "dashed", borderColor: C.ink, borderWidth: 1.5 },
          ]}
        />
      )}
      <View style={{ flexShrink: 1 }}>
        <Text style={[s.chipText, wide && { fontWeight: "700" }]}>{label}</Text>
        {sub ? <Text style={s.chipSub}>{sub}</Text> : null}
      </View>
    </Pressable>
  );
}

export function Card({ children }: { children: ReactNode }) {
  return <View style={s.card}>{children}</View>;
}

export function Line({ k, v, first }: { k: string; v: string; first?: boolean }) {
  return (
    <View style={[s.line, first && { borderTopWidth: 0 }]}>
      <Text style={s.lineK}>{k}</Text>
      <Text style={s.lineV}>{v}</Text>
    </View>
  );
}

export function Field({
  label,
  value,
  onCommit,
  numeric,
  placeholder,
}: {
  label: string;
  value: string;
  onCommit: (v: string) => void;
  numeric?: boolean;
  placeholder?: string;
}) {
  return (
    <View style={s.fi}>
      <Text style={s.fiLabel}>{label}</Text>
      <TextInput
        key={value}
        defaultValue={value}
        placeholder={placeholder}
        keyboardType={numeric ? "decimal-pad" : "default"}
        onEndEditing={(e) => onCommit(e.nativeEvent.text)}
        style={s.fiInput}
        accessibilityLabel={label}
      />
    </View>
  );
}

export function Legend({ items }: { items: [string, string][] }) {
  return (
    <View style={s.legend}>
      {items.map(([colour, label]) => (
        <View key={label} style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
          <View style={{ width: 12, height: 12, borderRadius: 3, backgroundColor: colour }} />
          <Text style={s.legendText}>{label}</Text>
        </View>
      ))}
    </View>
  );
}

export const s = StyleSheet.create({
  h2: { fontSize: 19, fontWeight: "800", color: C.ink, marginBottom: 4 },
  lead: { color: C.muted, fontSize: 14, lineHeight: 20, marginBottom: 14 },
  note: { fontSize: 12, color: C.muted, lineHeight: 17 },
  p: { fontSize: 14, color: C.ink, lineHeight: 21 },
  btn: { borderRadius: 12, backgroundColor: C.ink, paddingVertical: 13, paddingHorizontal: 16, marginTop: 12 },
  btnAlt: { backgroundColor: C.white, borderWidth: 1.5, borderColor: C.ink },
  btnText: { color: C.white, fontWeight: "700", fontSize: 15, textAlign: "center" },
  row: { flexDirection: "row", gap: 8, flexWrap: "wrap" },
  seg: { flexDirection: "row", backgroundColor: C.segBg, borderRadius: 999, padding: 3, marginBottom: 10 },
  segBtn: { flex: 1, borderRadius: 999, paddingVertical: 7, paddingHorizontal: 4 },
  segOn: { backgroundColor: C.white, elevation: 1 },
  segText: { fontSize: 13, textAlign: "center", color: C.ink },
  check: { flexDirection: "row", gap: 10, alignItems: "flex-start", paddingVertical: 6 },
  box: { width: 20, height: 20, borderRadius: 4, borderWidth: 1.5, borderColor: C.muted, alignItems: "center", justifyContent: "center", marginTop: 1 },
  tick: { color: C.white, fontWeight: "800", fontSize: 13, lineHeight: 15 },
  checkText: { fontSize: 14, color: C.ink, lineHeight: 19 },
  checkSmall: { fontSize: 12.5, color: C.muted, lineHeight: 17 },
  stats: { flexDirection: "row", flexWrap: "wrap", borderWidth: 1, borderColor: C.line, borderRadius: 12, overflow: "hidden", marginVertical: 14, backgroundColor: C.line, gap: 1 },
  stat: { backgroundColor: C.white, paddingVertical: 9, paddingHorizontal: 12, flexGrow: 1, flexBasis: "45%" },
  statBig: { fontSize: 20, fontWeight: "800", color: C.ink, fontVariant: ["tabular-nums"] },
  statSmall: { fontSize: 12, color: C.muted },
  step: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", paddingVertical: 5 },
  stepLabel: { fontSize: 14, color: C.ink, flex: 1 },
  stepCtl: { flexDirection: "row", alignItems: "center", gap: 6 },
  stepBtn: { width: 38, height: 38, borderRadius: 10, borderWidth: 1.5, borderColor: C.line, backgroundColor: C.white, alignItems: "center", justifyContent: "center" },
  stepBtnText: { fontSize: 20, color: C.ink },
  stepValue: { minWidth: 64, textAlign: "center", fontWeight: "700", color: C.ink, fontVariant: ["tabular-nums"] },
  bar: { height: 8, backgroundColor: C.segBg, borderRadius: 99, overflow: "hidden", marginVertical: 10 },
  barFill: { height: "100%", backgroundColor: C.ink },
  readout: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, gap: 2 },
  big: { fontSize: 26, fontWeight: "800", color: C.ink, fontVariant: ["tabular-nums"] },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginBottom: 12 },
  chip: { borderWidth: 1.5, borderColor: C.line, backgroundColor: C.white, borderRadius: 999, paddingVertical: 7, paddingLeft: 9, paddingRight: 12, flexDirection: "row", gap: 7, alignItems: "center" },
  chipOn: { borderColor: C.ink, backgroundColor: C.hivis },
  chipWide: { width: "100%", borderRadius: 12, marginBottom: -2 },
  chipText: { fontSize: 13, color: C.ink },
  chipSub: { fontSize: 12, color: C.muted },
  swatch: { width: 14, height: 14, borderRadius: 4, borderWidth: 1 },
  card: { backgroundColor: C.white, borderWidth: 1, borderColor: C.line, borderRadius: 12, padding: 12, marginBottom: 10 },
  line: { flexDirection: "row", justifyContent: "space-between", gap: 12, paddingVertical: 3, borderTopWidth: 1, borderStyle: "dashed", borderColor: "#E1E7DD" },
  lineK: { fontSize: 13.5, color: C.ink, flexShrink: 1 },
  lineV: { fontSize: 13.5, color: C.ink, fontWeight: "700", textAlign: "right", flexShrink: 1 },
  fi: { gap: 3, marginBottom: 8, flex: 1 },
  fiLabel: { fontSize: 12, color: C.muted },
  fiInput: { fontSize: 16, color: C.ink, paddingVertical: 8, paddingHorizontal: 10, borderWidth: 1.5, borderColor: C.line, borderRadius: 8, backgroundColor: C.white },
  legend: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginVertical: 8 },
  legendText: { fontSize: 12, color: C.muted },
});
