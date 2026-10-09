// Reading single-band elevation rasters as the Environment Agency's LIDAR web service sends them:
// GeoTIFF (uncompressed, LZW or Deflate, with or without a predictor) or ESRI ASCII grid. No
// dependencies: Deflate needs an inflate function passed in (the app uses pako).

export type Raster = {
  width: number;
  height: number;
  /** Row by row from the top (north) edge; NaN where there is no data. */
  values: Float64Array;
  /** Grid position of the top-left corner of the top-left pixel, and the pixel size, if the file says. */
  origin?: { x: number; y: number };
  pixelSize?: { x: number; y: number };
};

export type Inflate = (data: Uint8Array) => Uint8Array;

// ---- ESRI ASCII grid ------------------------------------------------------------------------------

export function parseArcGrid(text: string): Raster {
  const lines = text.split(/\r?\n/);
  const head: Record<string, number> = {};
  let i = 0;
  for (; i < lines.length; i++) {
    const m = lines[i].trim().match(/^([a-zA-Z_]+)\s+(-?[\d.eE+-]+)$/);
    if (!m) break;
    head[m[1].toLowerCase()] = Number(m[2]);
  }
  const width = head.ncols;
  const height = head.nrows;
  if (!(width > 0 && height > 0)) throw new Error("Not an ASCII grid (no ncols/nrows).");
  const cell = head.cellsize;
  const noData = head.nodata_value;
  const nums = lines.slice(i).join(" ").trim().split(/\s+/).map(Number);
  if (nums.length < width * height) throw new Error("ASCII grid is incomplete.");
  const values = new Float64Array(width * height);
  for (let k = 0; k < width * height; k++) values[k] = nums[k] === noData ? NaN : nums[k];
  const left = head.xllcorner ?? head.xllcenter - cell / 2;
  const bottom = head.yllcorner ?? head.yllcenter - cell / 2;
  return { width, height, values, origin: { x: left, y: bottom + height * cell }, pixelSize: { x: cell, y: cell } };
}

// ---- TIFF -------------------------------------------------------------------------------------------

type Tag = { type: number; count: number; valueOffset: number };

export function parseTiff(bytes: Uint8Array, inflate?: Inflate): Raster {
  const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = String.fromCharCode(bytes[0], bytes[1]);
  if (order !== "II" && order !== "MM") throw new Error("Not a TIFF file.");
  const le = order === "II";
  const u16 = (o: number) => dv.getUint16(o, le);
  const u32 = (o: number) => dv.getUint32(o, le);
  if (u16(2) !== 42) throw new Error("Unsupported TIFF (BigTIFF or not a TIFF).");

  const ifd = u32(4);
  const n = u16(ifd);
  const tags = new Map<number, Tag>();
  for (let k = 0; k < n; k++) {
    const o = ifd + 2 + k * 12;
    tags.set(u16(o), { type: u16(o + 2), count: u32(o + 4), valueOffset: o + 8 });
  }
  const size = (type: number) => ({ 1: 1, 2: 1, 3: 2, 4: 4, 6: 1, 7: 1, 8: 2, 9: 4, 11: 4, 12: 8, 16: 8 })[type] ?? 1;
  const read = (id: number): number[] => {
    const t = tags.get(id);
    if (!t) return [];
    const sz = size(t.type);
    const at = sz * t.count <= 4 ? t.valueOffset : u32(t.valueOffset);
    const out: number[] = [];
    for (let k = 0; k < t.count; k++) {
      const o = at + k * sz;
      out.push(
        t.type === 3 ? u16(o) : t.type === 4 ? u32(o) : t.type === 12 ? dv.getFloat64(o, le) : t.type === 11 ? dv.getFloat32(o, le) : t.type === 16 ? Number(dv.getBigUint64(o, le)) : bytes[o],
      );
    }
    return out;
  };
  const one = (id: number, dflt: number) => read(id)[0] ?? dflt;
  const ascii = (id: number) => String.fromCharCode(...read(id)).replace(/\0+$/, "");

  const width = one(256, 0);
  const height = one(257, 0);
  const bits = one(258, 32);
  const compression = one(259, 1);
  const spp = one(277, 1);
  const predictor = one(317, 1);
  const format = one(339, 1); // 1 unsigned, 2 signed, 3 float
  if (spp !== 1) throw new Error(`TIFF has ${spp} samples per pixel; expected 1.`);
  const bpp = bits / 8;

  const tiled = tags.has(322);
  const tileW = tiled ? one(322, width) : width;
  const tileH = tiled ? one(323, height) : one(278, height);
  const offsets = tiled ? read(324) : read(273);
  const counts = tiled ? read(325) : read(279);
  const across = Math.ceil(width / tileW);

  const decode = (chunk: Uint8Array): Uint8Array => {
    if (compression === 1) return chunk;
    if (compression === 5) return lzwDecode(chunk);
    if (compression === 8 || compression === 32946) {
      if (!inflate) throw new Error("Deflate-compressed TIFF needs an inflate function.");
      return inflate(chunk);
    }
    throw new Error(`Unsupported TIFF compression ${compression}.`);
  };

  const sample = (view: DataView, o: number): number => {
    if (format === 3) return bits === 64 ? view.getFloat64(o, le) : view.getFloat32(o, le);
    if (format === 2) return bits === 8 ? view.getInt8(o) : bits === 16 ? view.getInt16(o, le) : view.getInt32(o, le);
    return bits === 8 ? view.getUint8(o) : bits === 16 ? view.getUint16(o, le) : view.getUint32(o, le);
  };

  const values = new Float64Array(width * height).fill(NaN);
  for (let c = 0; c < offsets.length; c++) {
    const raw = decode(bytes.subarray(offsets[c], offsets[c] + counts[c]));
    // Chunks hold whole rows of tileW pixels (the last strip or edge tiles may be partly unused).
    const rows = Math.floor(raw.length / (tileW * bpp));
    const data = new Uint8Array(rows * tileW * bpp);
    data.set(raw.subarray(0, data.length));
    unpredict(data, predictor, tileW, rows, bpp, le);
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    const x0 = tiled ? (c % across) * tileW : 0;
    const y0 = tiled ? Math.floor(c / across) * tileH : c * tileH;
    for (let r = 0; r < rows; r++) {
      const y = y0 + r;
      if (y >= height) break;
      for (let x = 0; x < tileW; x++) {
        if (x0 + x >= width) break;
        values[y * width + x0 + x] = sample(view, (r * tileW + x) * bpp);
      }
    }
  }

  const noDataText = ascii(42113).trim();
  if (noDataText) {
    const nd = Number(noDataText);
    for (let k = 0; k < values.length; k++) if (values[k] === nd || (Number.isNaN(nd) && Number.isNaN(values[k]))) values[k] = NaN;
  }
  // Values far outside anything on Earth are no-data markers the file did not declare.
  for (let k = 0; k < values.length; k++) if (Math.abs(values[k]) > 1e5) values[k] = NaN;

  const scale = read(33550);
  const tie = read(33922);
  const geo =
    scale.length >= 2 && tie.length >= 6
      ? { origin: { x: tie[3] - tie[0] * scale[0], y: tie[4] + tie[1] * scale[1] }, pixelSize: { x: scale[0], y: scale[1] } }
      : {};
  return { width, height, values, ...geo };
}

function unpredict(data: Uint8Array, predictor: number, w: number, rows: number, bpp: number, le: boolean): void {
  if (predictor === 2) {
    const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
    for (let r = 0; r < rows; r++) {
      for (let x = 1; x < w; x++) {
        const o = (r * w + x) * bpp;
        const p = o - bpp;
        if (bpp === 1) data[o] = (data[o] + data[p]) & 0xff;
        else if (bpp === 2) view.setUint16(o, (view.getUint16(o, le) + view.getUint16(p, le)) & 0xffff, le);
        else view.setUint32(o, (view.getUint32(o, le) + view.getUint32(p, le)) >>> 0, le);
      }
    }
  } else if (predictor === 3) {
    // Floating point: each row is stored byte-plane by byte-plane (most significant first), differenced.
    const rowBytes = w * bpp;
    const tmp = new Uint8Array(rowBytes);
    for (let r = 0; r < rows; r++) {
      const row = data.subarray(r * rowBytes, (r + 1) * rowBytes);
      for (let k = 1; k < rowBytes; k++) row[k] = (row[k] + row[k - 1]) & 0xff;
      for (let x = 0; x < w; x++) {
        for (let b = 0; b < bpp; b++) {
          // Plane b holds byte b counted from the most significant end.
          const v = row[b * w + x];
          tmp[x * bpp + (le ? bpp - 1 - b : b)] = v;
        }
      }
      row.set(tmp);
    }
  }
}

/** TIFF's LZW (most significant bit first, early code-width change). */
export function lzwDecode(input: Uint8Array): Uint8Array {
  const out: number[] = [];
  let dict: Uint8Array[] = [];
  const reset = () => {
    dict = [];
    for (let i = 0; i < 256; i++) dict.push(Uint8Array.of(i));
    dict.push(new Uint8Array(0), new Uint8Array(0)); // 256 clear, 257 end
  };
  reset();
  let width = 9;
  let bitPos = 0;
  const totalBits = input.length * 8;
  const next = (): number => {
    if (bitPos + width > totalBits) return 257;
    let v = 0;
    for (let i = 0; i < width; i++) {
      const bit = (input[(bitPos + i) >> 3] >> (7 - ((bitPos + i) & 7))) & 1;
      v = (v << 1) | bit;
    }
    bitPos += width;
    return v;
  };
  let prev: Uint8Array | null = null;
  for (;;) {
    const code = next();
    if (code === 257) break;
    if (code === 256) {
      reset();
      width = 9;
      prev = null;
      continue;
    }
    let entry: Uint8Array;
    if (code < dict.length) entry = dict[code];
    else if (prev) {
      entry = new Uint8Array(prev.length + 1);
      entry.set(prev);
      entry[prev.length] = prev[0];
    } else throw new Error("Bad LZW data.");
    for (const b of entry) out.push(b);
    if (prev) {
      const add = new Uint8Array(prev.length + 1);
      add.set(prev);
      add[prev.length] = entry[0];
      dict.push(add);
    }
    prev = entry;
    if (dict.length + 1 >= 1 << width && width < 12) width++;
  }
  return Uint8Array.from(out);
}

/** Height at a grid position (e.g. National Grid metres), nearest pixel; NaN outside or no data. */
export function rasterAt(r: Raster, x: number, y: number): number {
  if (!r.origin || !r.pixelSize) return NaN;
  const c = Math.floor((x - r.origin.x) / r.pixelSize.x);
  const row = Math.floor((r.origin.y - y) / r.pixelSize.y);
  if (c < 0 || row < 0 || c >= r.width || row >= r.height) return NaN;
  return r.values[row * r.width + c];
}
