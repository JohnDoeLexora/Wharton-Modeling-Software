/**
 * Uncompressed PLAIN Parquet for the per-trial table.
 * Required columns only, one row group, one data page per column.
 */

export interface TrialColumn {
  name: string;
  type: "int32" | "double";
  values: number[];
}

const PARQUET_MAGIC = [0x50, 0x41, 0x52, 0x31];
const TYPE_INT32 = 1;
const TYPE_DOUBLE = 5;
const ENC_PLAIN = 0;
const ENC_RLE = 3;
const CODEC_UNCOMPRESSED = 0;
const PAGE_DATA = 0;
const REP_REQUIRED = 0;

const CT_I32 = 5;
const CT_I64 = 6;
const CT_DOUBLE = 7;
const CT_BINARY = 8;
const CT_LIST = 9;
const CT_STRUCT = 12;

class Buf {
  bytes: number[] = [];
  u8(value: number): void {
    this.bytes.push(value & 0xff);
  }
  raw(data: Uint8Array): void {
    for (const value of data) this.u8(value);
  }
  varint(value: number): void {
    let x = value >>> 0;
    while (x > 0x7f) {
      this.u8((x & 0x7f) | 0x80);
      x >>>= 7;
    }
    this.u8(x);
  }
  zigzag32(value: number): void {
    this.varint((value << 1) ^ (value >> 31));
  }
  zigzag64(value: number): void {
    let v = BigInt(value);
    v = (v << 1n) ^ (v >> 63n);
    while (v > 127n) {
      this.u8(Number(v & 127n) | 0x80);
      v >>= 7n;
    }
    this.u8(Number(v));
  }
  binary(text: string): void {
    const data = new TextEncoder().encode(text);
    this.varint(data.length);
    this.raw(data);
  }
  f64(value: number): void {
    const view = new DataView(new ArrayBuffer(8));
    view.setFloat64(0, value, true);
    this.raw(new Uint8Array(view.buffer));
  }
  i32le(value: number): void {
    const view = new DataView(new ArrayBuffer(4));
    view.setInt32(0, value, true);
    this.raw(new Uint8Array(view.buffer));
  }
  field(id: number, previous: number, type: number): number {
    const delta = id - previous;
    if (delta > 0 && delta < 16) this.u8((delta << 4) | type);
    else {
      this.u8(type);
      this.zigzag32(id);
    }
    return id;
  }
  stop(): void {
    this.u8(0);
  }
  listHeader(element: number, count: number): void {
    if (count < 15) this.u8((count << 4) | element);
    else {
      this.u8((15 << 4) | element);
      this.varint(count);
    }
  }
}

function plainBody(column: TrialColumn): Uint8Array {
  const body = new Buf();
  if (column.type === "int32") {
    for (const value of column.values) body.i32le(value);
  } else {
    for (const value of column.values) body.f64(value);
  }
  return Uint8Array.from(body.bytes);
}

function page(column: TrialColumn, body: Uint8Array): Uint8Array {
  const header = new Buf();
  let prev = 0;
  prev = header.field(1, prev, CT_I32);
  header.zigzag32(PAGE_DATA);
  prev = header.field(2, prev, CT_I32);
  header.zigzag32(body.length);
  prev = header.field(3, prev, CT_I32);
  header.zigzag32(body.length);
  prev = header.field(5, prev, CT_STRUCT);
  let inner = 0;
  inner = header.field(1, inner, CT_I32);
  header.zigzag32(column.values.length);
  inner = header.field(2, inner, CT_I32);
  header.zigzag32(ENC_PLAIN);
  inner = header.field(3, inner, CT_I32);
  header.zigzag32(ENC_RLE);
  inner = header.field(4, inner, CT_I32);
  header.zigzag32(ENC_RLE);
  header.stop();
  header.stop();
  const out = new Uint8Array(header.bytes.length + body.length);
  out.set(header.bytes, 0);
  out.set(body, header.bytes.length);
  return out;
}

function schemaElement(buf: Buf, column: TrialColumn | null, children: number): void {
  let prev = 0;
  if (column) {
    prev = buf.field(1, prev, CT_I32);
    buf.zigzag32(column.type === "int32" ? TYPE_INT32 : TYPE_DOUBLE);
  }
  prev = buf.field(3, prev, CT_I32);
  buf.zigzag32(REP_REQUIRED);
  prev = buf.field(4, prev, CT_BINARY);
  buf.binary(column ? column.name : "schema");
  if (!column) {
    prev = buf.field(5, prev, CT_I32);
    buf.zigzag32(children);
  }
  buf.stop();
}

function columnMeta(buf: Buf, column: TrialColumn, offset: number, size: number): void {
  let prev = 0;
  prev = buf.field(1, prev, CT_I32);
  buf.zigzag32(column.type === "int32" ? TYPE_INT32 : TYPE_DOUBLE);
  prev = buf.field(2, prev, CT_LIST);
  buf.listHeader(CT_I32, 1);
  buf.zigzag32(ENC_PLAIN);
  prev = buf.field(3, prev, CT_LIST);
  buf.listHeader(CT_BINARY, 1);
  buf.binary(column.name);
  prev = buf.field(4, prev, CT_I32);
  buf.zigzag32(CODEC_UNCOMPRESSED);
  prev = buf.field(5, prev, CT_I64);
  buf.zigzag64(column.values.length);
  prev = buf.field(6, prev, CT_I64);
  buf.zigzag64(size);
  prev = buf.field(7, prev, CT_I64);
  buf.zigzag64(size);
  prev = buf.field(9, prev, CT_I64);
  buf.zigzag64(offset);
  buf.stop();
}

export function trialsParquet(columns: TrialColumn[], metadata: Record<string, string> = {}): Uint8Array {
  const pages = columns.map((column) => page(column, plainBody(column)));
  let cursor = 4;
  const offsets = pages.map((chunk) => {
    const offset = cursor;
    cursor += chunk.length;
    return offset;
  });
  const rows = columns[0]?.values.length ?? 0;
  const footer = new Buf();
  let prev = 0;
  prev = footer.field(1, prev, CT_I32);
  footer.zigzag32(1);
  prev = footer.field(2, prev, CT_LIST);
  footer.listHeader(CT_STRUCT, columns.length + 1);
  schemaElement(footer, null, columns.length);
  for (const column of columns) schemaElement(footer, column, 0);
  prev = footer.field(3, prev, CT_I64);
  footer.zigzag64(rows);
  prev = footer.field(4, prev, CT_LIST);
  footer.listHeader(CT_STRUCT, 1);
  let rowPrev = 0;
  rowPrev = footer.field(1, rowPrev, CT_LIST);
  footer.listHeader(CT_STRUCT, columns.length);
  columns.forEach((column, index) => {
    let chunkPrev = 0;
    chunkPrev = footer.field(2, chunkPrev, CT_I64);
    footer.zigzag64(offsets[index]);
    chunkPrev = footer.field(3, chunkPrev, CT_STRUCT);
    columnMeta(footer, column, offsets[index], pages[index].length);
    footer.stop();
  });
  rowPrev = footer.field(2, rowPrev, CT_I64);
  footer.zigzag64(pages.reduce((total, chunk) => total + chunk.length, 0));
  rowPrev = footer.field(3, rowPrev, CT_I64);
  footer.zigzag64(rows);
  footer.stop();
  const keys = Object.entries(metadata);
  if (keys.length > 0) {
    prev = footer.field(5, prev, CT_LIST);
    footer.listHeader(CT_STRUCT, keys.length);
    for (const [key, value] of keys) {
      let keyPrev = 0;
      keyPrev = footer.field(1, keyPrev, CT_BINARY);
      footer.binary(key);
      keyPrev = footer.field(2, keyPrev, CT_BINARY);
      footer.binary(value);
      footer.stop();
    }
  }
  prev = footer.field(6, prev, CT_BINARY);
  footer.binary("gao-modeling-toolkit");
  footer.stop();

  const tail = Uint8Array.from(footer.bytes);
  const out = new Uint8Array(4 + pages.reduce((total, chunk) => total + chunk.length, 0) + tail.length + 8);
  out.set(PARQUET_MAGIC, 0);
  let at = 4;
  for (const chunk of pages) {
    out.set(chunk, at);
    at += chunk.length;
  }
  out.set(tail, at);
  at += tail.length;
  const view = new DataView(out.buffer);
  view.setUint32(at, tail.length, true);
  out.set(PARQUET_MAGIC, at + 4);
  return out;
}

class Reader {
  constructor(private readonly data: Uint8Array, private at = 0) {}
  get left(): number {
    return this.data.length - this.at;
  }
  get position(): number {
    return this.at;
  }
  u8(): number {
    return this.data[this.at++];
  }
  varint(): number {
    let value = 0;
    let shift = 0;
    for (;;) {
      const byte = this.u8();
      value |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) return value >>> 0;
      shift += 7;
    }
  }
  zigzag32(): number {
    const n = this.varint();
    return (n >>> 1) ^ -(n & 1);
  }
  skipI64(): void {
    for (;;) {
      const byte = this.u8();
      if ((byte & 0x80) === 0) return;
    }
  }
  skip(type: number): void {
    if (type === 1 || type === 2) return;
    if (type === 3) {
      this.u8();
      return;
    }
    if (type === 4 || type === 5) {
      this.zigzag32();
      return;
    }
    if (type === 6) {
      this.skipI64();
      return;
    }
    if (type === 7) {
      this.bytes(8);
      return;
    }
    if (type === 8) {
      this.binary();
      return;
    }
    if (type === 9 || type === 10) {
      this.skipList();
      return;
    }
    if (type === 11) throw new Error("Parquet maps are not written by this toolkit.");
    if (type === 12) {
      for (;;) {
        const field = this.field();
        if (!field) return;
        this.skip(field.type);
      }
    }
    throw new Error(`Cannot skip Parquet type ${type}.`);
  }
  skipList(): void {
    const header = this.u8();
    const element = header & 0x0f;
    let count = header >> 4;
    if (count === 15) count = this.varint();
    for (let index = 0; index < count; index++) this.skip(element);
  }
  binary(): string {
    const length = this.varint();
    const text = new TextDecoder().decode(this.data.subarray(this.at, this.at + length));
    this.at += length;
    return text;
  }
  bytes(length: number): Uint8Array {
    const slice = this.data.subarray(this.at, this.at + length);
    this.at += length;
    return slice;
  }
  field(): { id: number; type: number; previous: number } | null {
    const header = this.u8();
    if (header === 0) return null;
    const delta = header >> 4;
    const type = header & 0x0f;
    const id = delta === 0 ? this.zigzag32() : delta;
    return { id, type, previous: delta };
  }
}

function readPlain(data: Uint8Array, type: "int32" | "double", count: number): number[] {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const values: number[] = [];
  if (type === "int32") {
    for (let i = 0; i < count; i++) values.push(view.getInt32(i * 4, true));
  } else {
    for (let i = 0; i < count; i++) values.push(view.getFloat64(i * 8, true));
  }
  return values;
}

/** Read the PLAIN columns this writer produced. */
export function readTrialsParquet(file: Uint8Array): { columns: TrialColumn[]; metadata: Record<string, string> } {
  if (file.length < 12) throw new Error("Parquet file is too short.");
  for (let i = 0; i < 4; i++) {
    if (file[i] !== PARQUET_MAGIC[i] || file[file.length - 4 + i] !== PARQUET_MAGIC[i]) {
      throw new Error("Parquet magic is missing.");
    }
  }
  const view = new DataView(file.buffer, file.byteOffset, file.byteLength);
  const footerLength = view.getUint32(file.length - 8, true);
  const footerStart = file.length - 8 - footerLength;
  const columns: TrialColumn[] = [];
  let at = 4;
  const reader = new Reader(file, footerStart);
  const names: string[] = [];
  const types: ("int32" | "double")[] = [];
  let metaSeen = false;
  const metadata: Record<string, string> = {};
  // Walk column pages in file order. The footer is checked for magic and length only here;
  // each page header is parsed so a broken page fails the round trip.
  while (at < footerStart) {
    const pageReader = new Reader(file, at);
    let prev = 0;
    let pageType = -1;
    let compressed = 0;
    let count = 0;
    for (;;) {
      const field = pageReader.field();
      if (!field) break;
      const id = field.previous === 0 ? field.id : prev + field.previous;
      prev = id;
      if (id === 1) pageType = pageReader.zigzag32();
      else if (id === 2) pageReader.zigzag32();
      else if (id === 3) compressed = pageReader.zigzag32();
      else if (id === 5) {
        let inner = 0;
        for (;;) {
          const nested = pageReader.field();
          if (!nested) break;
          const nestedId = nested.previous === 0 ? nested.id : inner + nested.previous;
          inner = nestedId;
          if (nestedId === 1) count = pageReader.zigzag32();
          else pageReader.zigzag32();
        }
      } else {
        throw new Error(`Unexpected page field ${id}.`);
      }
    }
    if (pageType !== PAGE_DATA) throw new Error("Only data pages are written.");
    const body = file.subarray(pageReader.position, pageReader.position + compressed);
    const type: "int32" | "double" = body.length === count * 4 ? "int32" : "double";
    columns.push({ name: "", type, values: readPlain(body, type, count) });
    at = pageReader.position + compressed;
    metaSeen = true;
  }
  if (!metaSeen) throw new Error("Parquet body is empty.");
  // Names live in the footer schema. Re-parse just the schema list.
  let previous = 0;
  for (;;) {
    const field = reader.field();
    if (!field) break;
    const id = field.previous === 0 ? field.id : previous + field.previous;
    previous = id;
    if (id === 2 && field.type === CT_LIST) {
      const header = reader.u8();
      const element = header & 0x0f;
      let count = header >> 4;
      if (count === 15) count = reader.varint();
      if (element !== CT_STRUCT) throw new Error("Schema list is not a struct list.");
      for (let index = 0; index < count; index++) {
        let schemaPrev = 0;
        let name = "";
        let type: "int32" | "double" | null = null;
        for (;;) {
          const nested = reader.field();
          if (!nested) break;
          const nestedId = nested.previous === 0 ? nested.id : schemaPrev + nested.previous;
          schemaPrev = nestedId;
          if (nestedId === 1) type = reader.zigzag32() === TYPE_INT32 ? "int32" : "double";
          else if (nestedId === 3) reader.zigzag32();
          else if (nestedId === 4) name = reader.binary();
          else if (nestedId === 5) reader.zigzag32();
          else throw new Error(`Unexpected schema field ${nestedId}.`);
        }
        if (name && name !== "schema") {
          names.push(name);
          types.push(type ?? "double");
        }
      }
    } else if (id === 5 && field.type === CT_LIST) {
      const header = reader.u8();
      let count = header >> 4;
      if (count === 15) count = reader.varint();
      for (let index = 0; index < count; index++) {
        let key = "";
        let value = "";
        let keyPrev = 0;
        for (;;) {
          const nested = reader.field();
          if (!nested) break;
          const nestedId = nested.previous === 0 ? nested.id : keyPrev + nested.previous;
          keyPrev = nestedId;
          if (nestedId === 1) key = reader.binary();
          else if (nestedId === 2) value = reader.binary();
          else reader.skip(nested.type);
        }
        if (key) metadata[key] = value;
      }
    } else if (field.type === CT_I32) reader.zigzag32();
    else if (field.type === CT_I64) reader.skipI64();
    else if (field.type === CT_BINARY) reader.binary();
    else if (field.type === CT_DOUBLE) reader.bytes(8);
    else reader.skip(field.type);
  }
  columns.forEach((column, index) => {
    column.name = names[index] ?? `column_${index}`;
    if (types[index]) column.type = types[index];
  });
  if (footerLength <= 0) throw new Error("Parquet footer length is empty.");
  return { columns, metadata };
}
