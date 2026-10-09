import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { deflateSync, inflateSync } from "node:zlib";

import { osgb36ToGrid, wgs84ToGrid } from "../src/bng.ts";
import { parseArcGrid, parseTiff, rasterAt } from "../src/raster.ts";

const dms = (d: number, m: number, s: number) => d + m / 60 + s / 3600;

test("National Grid: the Ordnance Survey's worked example", () => {
  // OS guide, "A guide to coordinate systems in Great Britain", Transverse Mercator example.
  const g = osgb36ToGrid(dms(52, 39, 27.2531), dms(1, 43, 4.5177));
  assert.ok(Math.abs(g.e - 651409.903) < 0.01, `E ${g.e}`);
  assert.ok(Math.abs(g.n - 313177.27) < 0.01, `N ${g.n}`);
});

test("National Grid: GPS positions land within a few metres", () => {
  // Trig pillars and landmarks with published WGS84 and National Grid positions (to a few metres).
  const cases = [
    { name: "Greenwich Observatory", lat: 51.47788, lng: -0.00147, e: 538874, n: 177344 },
    { name: "Ben Nevis summit", lat: 56.79685, lng: -5.00355, e: 216666, n: 771288 },
  ];
  for (const c of cases) {
    const g = wgs84ToGrid(c.lat, c.lng);
    const d = Math.hypot(g.e - c.e, g.n - c.n);
    // The reference positions are rounded and from different sources; the shift itself is ~100 m,
    // so this catches a wrong or missing datum shift, not the last few metres.
    assert.ok(d < 25, `${c.name}: ${d.toFixed(1)} m off`);
  }
});

test("ASCII grid", () => {
  const r = parseArcGrid(`ncols 3
nrows 2
xllcorner 500000
yllcorner 100000
cellsize 1
NODATA_value -9999
1 2 3
4 -9999 6
`);
  assert.equal(r.width, 3);
  assert.equal(r.height, 2);
  assert.deepEqual(r.origin, { x: 500000, y: 100002 });
  assert.equal(rasterAt(r, 500000.5, 100001.5), 1);
  assert.equal(rasterAt(r, 500002.5, 100000.5), 6);
  assert.ok(Number.isNaN(rasterAt(r, 500001.5, 100000.5)));
});

// ---- A tiny TIFF writer, to test the reader with the layouts a WCS may send. ----------------------

type TiffOpts = { compression: 1 | 8; predictor: 1 | 3; tile?: number; rowsPerStrip?: number; le?: boolean };

function makeTiff(w: number, h: number, vals: number[], o: TiffOpts): Uint8Array {
  const le = o.le ?? true;
  const chunkW = o.tile ?? w;
  const chunkH = o.tile ?? o.rowsPerStrip ?? h;
  const across = Math.ceil(w / chunkW);
  const down = Math.ceil(h / chunkH);
  const chunks: Uint8Array[] = [];
  for (let cy = 0; cy < down; cy++) {
    for (let cx = 0; cx < across; cx++) {
      const rows = o.tile ? chunkH : Math.min(chunkH, h - cy * chunkH);
      const buf = new Uint8Array(chunkW * rows * 4);
      const dv = new DataView(buf.buffer);
      for (let r = 0; r < rows; r++)
        for (let x = 0; x < chunkW; x++) {
          const X = cx * chunkW + x;
          const Y = cy * chunkH + r;
          dv.setFloat32((r * chunkW + x) * 4, X < w && Y < h ? vals[Y * w + X] : 0, le);
        }
      if (o.predictor === 3) {
        for (let r = 0; r < rows; r++) {
          const row = buf.subarray(r * chunkW * 4, (r + 1) * chunkW * 4);
          const planes = new Uint8Array(row.length);
          for (let x = 0; x < chunkW; x++) for (let b = 0; b < 4; b++) planes[b * chunkW + x] = row[x * 4 + (le ? 3 - b : b)];
          for (let k = planes.length - 1; k > 0; k--) planes[k] = (planes[k] - planes[k - 1]) & 0xff;
          row.set(planes);
        }
      }
      chunks.push(o.compression === 8 ? new Uint8Array(deflateSync(buf)) : buf);
    }
  }
  const entries: [number, number, number[]][] = [
    [256, 3, [w]],
    [257, 3, [h]],
    [258, 3, [32]],
    [259, 3, [o.compression]],
    [277, 3, [1]],
    [317, 3, [o.predictor]],
    [339, 3, [3]],
    [33550, 12, [1, 1, 0]],
    [33922, 12, [0, 0, 0, 600000, 200000, 0]],
    [42113, 2, [...Array.from("-9999").map((c) => c.charCodeAt(0)), 0]],
  ];
  if (o.tile) entries.push([322, 3, [o.tile]], [323, 3, [o.tile]], [324, 4, []], [325, 4, chunks.map((c) => c.length)]);
  else entries.push([278, 3, [chunkH]], [273, 4, []], [279, 4, chunks.map((c) => c.length)]);
  entries.sort((a, b) => a[0] - b[0]);

  const size = (t: number) => (t === 3 ? 2 : t === 4 ? 4 : t === 12 ? 8 : 1);
  const headerLen = 8 + 2 + entries.length * 12 + 4;
  // Lay out: header + IFD, then out-of-line tag data, then image chunks.
  let extra = headerLen;
  const extraAt = new Map<number, number>();
  for (const [id, t, v] of entries) {
    const count = id === 273 || id === 324 ? chunks.length : v.length;
    if (count * size(t) > 4) {
      extraAt.set(id, extra);
      extra += count * size(t);
    }
  }
  const dataStart = extra;
  const chunkAt: number[] = [];
  let pos = dataStart;
  for (const c of chunks) {
    chunkAt.push(pos);
    pos += c.length;
  }
  const out = new Uint8Array(pos);
  const dv = new DataView(out.buffer);
  out.set(le ? [0x49, 0x49] : [0x4d, 0x4d]);
  dv.setUint16(2, 42, le);
  dv.setUint32(4, 8, le);
  dv.setUint16(8, entries.length, le);
  const put = (o: number, t: number, v: number) =>
    t === 3 ? dv.setUint16(o, v, le) : t === 4 ? dv.setUint32(o, v, le) : t === 12 ? dv.setFloat64(o, v, le) : dv.setUint8(o, v);
  entries.forEach(([id, t, v], k) => {
    const vals2 = id === 273 || id === 324 ? chunkAt : v;
    const e = 10 + k * 12;
    dv.setUint16(e, id, le);
    dv.setUint16(e + 2, t, le);
    dv.setUint32(e + 4, vals2.length, le);
    const at = extraAt.get(id);
    if (at === undefined) vals2.forEach((x, i) => put(e + 8 + i * size(t), t, x));
    else {
      dv.setUint32(e + 8, at, le);
      vals2.forEach((x, i) => put(at + i * size(t), t, x));
    }
  });
  chunks.forEach((c, i) => out.set(c, chunkAt[i]));
  return out;
}

test("LZW: a TIFF written by libtiff (Pillow), with the code width growing to 12 bits", () => {
  const r = parseTiff(new Uint8Array(readFileSync(new URL("./fixtures/lzw.tif", import.meta.url))));
  assert.equal(r.width, 300);
  assert.equal(r.height, 40);
  for (let y = 0; y < r.height; y++)
    for (let x = 0; x < r.width; x++) {
      const want = Math.fround(12.25 + (x % 37) * 0.1 - y * 0.05);
      assert.ok(Math.abs(r.values[y * r.width + x] - want) < 1e-4, `pixel ${x},${y}`);
    }
});

test("GeoTIFF: strips and tiles, uncompressed and Deflate, floating-point predictor, both byte orders", () => {
  const w = 37;
  const h = 23;
  const vals = Array.from({ length: w * h }, (_, i) => 12.25 + (i % w) * 0.1 - Math.floor(i / w) * 0.05);
  vals[5] = -9999;
  const inflate = (d: Uint8Array) => new Uint8Array(inflateSync(d));
  const layouts: TiffOpts[] = [
    { compression: 1, predictor: 1 },
    { compression: 8, predictor: 3, rowsPerStrip: 4 },
    { compression: 1, predictor: 1, tile: 16 },
    { compression: 8, predictor: 3, tile: 16, le: false },
    { compression: 8, predictor: 3, rowsPerStrip: 5 },
  ];
  for (const o of layouts) {
    const r = parseTiff(makeTiff(w, h, vals, o), inflate);
    assert.equal(r.width, w);
    assert.equal(r.height, h);
    for (let i = 0; i < vals.length; i++) {
      if (i === 5) assert.ok(Number.isNaN(r.values[i]), "no-data");
      else assert.ok(Math.abs(r.values[i] - vals[i]) < 1e-4, `${JSON.stringify(o)} pixel ${i}: ${r.values[i]} vs ${vals[i]}`);
    }
    assert.deepEqual(r.origin, { x: 600000, y: 200000 });
    assert.equal(rasterAt(r, 600002.5, 199999.5), r.values[2]);
  }
});
