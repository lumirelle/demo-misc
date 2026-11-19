/**
 * sqlite-ish — a toy, single-file re-implementation of the ideas behind SQLite.
 *
 * It is deliberately *not* a drop-in replacement for SQLite. It exists to make
 * the moving parts visible in one place:
 *
 *   §1  values and storage classes        §6  SQL tokens
 *   §2  varints (base-128, 1..9 bytes)    §7  the AST
 *   §3  record format (header + body)     §8  the recursive-descent parser
 *   §4  pages, the pager, the file header §9  the expression evaluator
 *   §5  table b-tree pages and cursors    §10 the engine (catalog + executor)
 *
 * What is real here: the on-disk encodings (varints, records, page headers,
 * cell pointer arrays, table b-tree interior/leaf pages) and the SQL front end
 * (tokenizer, parser, three-valued logic, evaluator).
 *
 * What is simplified: query execution reads from an in-memory row store rather
 * than from the b-tree; the b-tree is written through on every mutation
 * (`Database.readStorage` proves the encoded image is readable). Rewrites leak
 * pages because there is no free-list. There are no indexes, no multi-threaded
 * pager, no write-ahead log, and no B-tree balancing on delete.
 */

import { pathToFileURL } from 'node:url';

// ===========================================================================
// §1. Values and storage classes
// ===========================================================================

/** The five SQLite storage classes, as a TypeScript union. */
export type SqlValue = null | bigint | number | string | Uint8Array;

export type StorageClass = 'null' | 'integer' | 'real' | 'text' | 'blob';

/** Column affinity, following SQLite's five-affinity model (simplified BLOB). */
export type ColumnType = 'INTEGER' | 'REAL' | 'TEXT' | 'BLOB' | 'NUMERIC';

const CLASS_RANK: Record<StorageClass, number> = {
  null: 0,
  integer: 1,
  real: 2,
  text: 3,
  blob: 4,
};

const UTF8_ENCODER = new TextEncoder();
const UTF8_DECODER = new TextDecoder();

/** Which storage class a runtime value belongs to. */
export function storageClassOf(value: SqlValue): StorageClass {
  if (value === null) return 'null';
  if (typeof value === 'bigint') return 'integer';
  if (typeof value === 'number') return 'real';
  if (typeof value === 'string') return 'text';
  return 'blob';
}

/**
 * SQLite's cross-class ordering: NULL < numbers < text < blobs, with numbers
 * compared numerically and text compared by code point. No collation support.
 */
export function compareValues(left: SqlValue, right: SqlValue): number {
  const leftClass = storageClassOf(left);
  const rightClass = storageClassOf(right);
  if (leftClass === 'null' || rightClass === 'null') {
    return CLASS_RANK[leftClass] - CLASS_RANK[rightClass];
  }
  if (isNumeric(left) && isNumeric(right)) {
    return compareNumbers(left, right);
  }
  if (leftClass !== rightClass) {
    return CLASS_RANK[leftClass] - CLASS_RANK[rightClass];
  }
  if (typeof left === 'string' && typeof right === 'string') {
    return compareText(left, right);
  }
  if (left instanceof Uint8Array && right instanceof Uint8Array) {
    return compareBlobs(left, right);
  }
  return 0;
}

function isNumeric(value: SqlValue): value is bigint | number {
  return typeof value === 'bigint' || typeof value === 'number';
}

function compareNumbers(left: bigint | number, right: bigint | number): number {
  if (typeof left === 'bigint' && typeof right === 'bigint') {
    return left < right ? -1 : left > right ? 1 : 0;
  }
  const a = Number(left);
  const b = Number(right);
  if (Number.isNaN(a) || Number.isNaN(b)) {
    return Number.isNaN(a) ? (Number.isNaN(b) ? 0 : -1) : 1;
  }
  return a < b ? -1 : a > b ? 1 : 0;
}

function compareText(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareBlobs(left: Uint8Array, right: Uint8Array): number {
  const shared = Math.min(left.length, right.length);
  for (let index = 0; index < shared; index += 1) {
    const a = left[index] ?? 0;
    const b = right[index] ?? 0;
    if (a !== b) return a - b;
  }
  return left.length - right.length;
}

/** SQLite truthiness: NULL is false, 0 is false, text is numeric or false. */
export function isTruthy(value: SqlValue): boolean {
  if (value === null) return false;
  if (typeof value === 'bigint') return value !== 0n;
  if (typeof value === 'number') return value !== 0 && !Number.isNaN(value);
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed !== 0 : false;
  }
  return value.length > 0;
}

/** Coerce a value to a JS number for arithmetic. */
export function toNumericValue(value: SqlValue): number {
  if (value === null) return 0;
  if (typeof value === 'bigint') return Number(value);
  if (typeof value === 'number') return value;
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
}

/** Coerce a value to an integer, clamping non-numeric input to 0. */
export function toInteger(value: SqlValue): bigint {
  if (value === null) return 0n;
  if (typeof value === 'bigint') return value;
  if (typeof value === 'number') {
    return Number.isFinite(value) ? BigInt(Math.trunc(value)) : 0n;
  }
  if (typeof value === 'string') {
    const parsed = Number(value.trim());
    return Number.isFinite(parsed) ? BigInt(Math.trunc(parsed)) : 0n;
  }
  return 0n;
}

/** Render a value the way SQLite would in a text context. */
export function toSqlString(value: SqlValue): string {
  if (value === null) return 'NULL';
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'number') return formatReal(value);
  if (typeof value === 'string') return value;
  let hex = '';
  for (const byte of value) hex += byte.toString(16).padStart(2, '0').toUpperCase();
  return `x'${hex}'`;
}

function formatReal(value: number): string {
  if (Number.isNaN(value)) return '';
  if (Number.isFinite(value) && Number.isInteger(value)) return value.toFixed(1);
  return String(value);
}

/** Apply column affinity when a value enters a table. */
export function coerceToColumnType(value: SqlValue, type: ColumnType): SqlValue {
  if (value === null) return null;
  switch (type) {
    case 'INTEGER': {
      if (typeof value === 'bigint') return value;
      if (typeof value === 'number') {
        return Number.isFinite(value) ? BigInt(Math.trunc(value)) : null;
      }
      if (typeof value === 'string') {
        const parsed = Number(value.trim());
        return Number.isFinite(parsed) ? BigInt(Math.trunc(parsed)) : 0n;
      }
      return null;
    }
    case 'REAL': {
      if (typeof value === 'number') return value;
      if (typeof value === 'bigint') return Number(value);
      if (typeof value === 'string') {
        const parsed = Number(value.trim());
        return Number.isFinite(parsed) ? parsed : 0;
      }
      return null;
    }
    case 'TEXT': {
      if (typeof value === 'string') return value;
      if (typeof value === 'bigint' || typeof value === 'number') return toSqlString(value);
      return UTF8_DECODER.decode(value);
    }
    case 'BLOB': {
      if (typeof value === 'string') return UTF8_ENCODER.encode(value);
      return value;
    }
    default:
      return value;
  }
}

// ===========================================================================
// §2. Varints
// ===========================================================================

export interface DecodedVarint {
  value: bigint;
  length: number;
}

/**
 * Encode an integer as SQLite does: big-endian base-128 where every byte but
 * the last sets the high bit. Small values take one byte; the 9-byte form
 * carries 8 bits in its final byte so the full 64 bits fit.
 */
export function encodeVarint(input: bigint | number): Uint8Array {
  let value = BigInt(input);
  if (value < 0n) value = BigInt.asUintN(64, value);
  if (value > 0xffffffffffffffffn) {
    throw new RangeError('varint value does not fit in 64 bits');
  }
  if (value <= 0x7fn) return Uint8Array.from([Number(value)]);

  if (value > 0x00ffffffffffffffn) {
    const bytes = new Array<number>(9);
    bytes[8] = Number(value & 0xffn);
    let rest = value >> 8n;
    for (let index = 7; index >= 0; index -= 1) {
      bytes[index] = Number(rest & 0x7fn) | 0x80;
      rest >>= 7n;
    }
    return Uint8Array.from(bytes);
  }

  const bytes: number[] = [];
  let rest = value;
  do {
    bytes.unshift(Number(rest & 0x7fn));
    rest >>= 7n;
  } while (rest > 0n);
  for (let index = 0; index < bytes.length - 1; index += 1) {
    bytes[index] = (bytes[index] ?? 0) | 0x80;
  }
  return Uint8Array.from(bytes);
}

/** Decode a varint starting at `offset`; returns the raw unsigned 64-bit value. */
export function decodeVarint(buffer: Uint8Array, offset = 0): DecodedVarint {
  let value = 0n;
  for (let index = 0; index < 8; index += 1) {
    const byte = buffer[offset + index];
    if (byte === undefined) throw new RangeError('truncated varint');
    value = (value << 7n) | BigInt(byte & 0x7f);
    if ((byte & 0x80) === 0) return { value, length: index + 1 };
  }
  const ninth = buffer[offset + 8];
  if (ninth === undefined) throw new RangeError('truncated varint');
  return { value: (value << 8n) | BigInt(ninth), length: 9 };
}

// ===========================================================================
// §3. Record format
// ===========================================================================

// Serial types: 0 = NULL, 1..6 = integers of 1/2/3/4/6/8 bytes, 7 = float64,
// 8 = the integer 0, 9 = the integer 1, 10/11 reserved, 12+2n = blob of n
// bytes, 13+2n = text of n bytes.

const WIDTH_BY_SERIAL: Record<number, number> = { 1: 1, 2: 2, 3: 3, 4: 4, 5: 6, 6: 8 };

function minimalIntegerWidth(value: bigint): 1 | 2 | 3 | 4 | 6 | 8 {
  for (const width of [1, 2, 3, 4, 6] as const) {
    const bits = BigInt(width * 8 - 1);
    if (value >= -(1n << bits) && value <= (1n << bits) - 1n) return width;
  }
  return 8;
}

/** The serial type SQLite would store `value` as. */
export function serialTypeOf(value: SqlValue): bigint {
  if (value === null) return 0n;
  if (typeof value === 'bigint') {
    if (value === 0n) return 8n;
    if (value === 1n) return 9n;
    switch (minimalIntegerWidth(value)) {
      case 1:
        return 1n;
      case 2:
        return 2n;
      case 3:
        return 3n;
      case 4:
        return 4n;
      case 6:
        return 5n;
      default:
        return 6n;
    }
  }
  if (typeof value === 'number') return 7n;
  if (typeof value === 'string') return BigInt(13 + 2 * UTF8_ENCODER.encode(value).length);
  return BigInt(12 + 2 * value.length);
}

function encodeIntegerBody(value: bigint, width: number): Uint8Array {
  const out = new Uint8Array(width);
  let remaining = BigInt.asUintN(64, value);
  for (let index = width - 1; index >= 0; index -= 1) {
    out[index] = Number(remaining & 0xffn);
    remaining >>= 8n;
  }
  return out;
}

function readSignedInteger(buffer: Uint8Array, offset: number, width: number): bigint {
  let value = 0n;
  for (let index = 0; index < width; index += 1) {
    value = (value << 8n) | BigInt(buffer[offset + index] ?? 0);
  }
  const bits = BigInt(width * 8);
  const signBit = 1n << (bits - 1n);
  return (value & signBit) !== 0n ? value - (1n << bits) : value;
}

function encodeValueBody(value: SqlValue): Uint8Array {
  if (value === null) return new Uint8Array(0);
  if (typeof value === 'bigint') {
    if (value === 0n || value === 1n) return new Uint8Array(0);
    return encodeIntegerBody(value, minimalIntegerWidth(value));
  }
  if (typeof value === 'number') {
    const out = new Uint8Array(8);
    new DataView(out.buffer).setFloat64(0, value, false);
    return out;
  }
  if (typeof value === 'string') return UTF8_ENCODER.encode(value);
  return value.slice();
}

/**
 * A record is `varint(header size) || serial types || column values`. The header
 * size counts itself, which is why it has to be solved as a fixed point.
 */
export function encodeRecord(values: readonly SqlValue[]): Uint8Array {
  const serials = values.map(serialTypeOf);
  const bodies: Uint8Array[] = [];
  let bodyLength = 0;
  for (const value of values) {
    const body = encodeValueBody(value);
    bodies.push(body);
    bodyLength += body.length;
  }

  let serialBytes = 0;
  for (const serial of serials) serialBytes += encodeVarint(serial).length;

  let headerSizeVarint = 1;
  while (headerSizeVarint < 10) {
    if (encodeVarint(headerSizeVarint + serialBytes).length === headerSizeVarint) break;
    headerSizeVarint += 1;
  }

  const headerSize = headerSizeVarint + serialBytes;
  const out = new Uint8Array(headerSize + bodyLength);
  out.set(encodeVarint(headerSize), 0);
  let cursor = headerSizeVarint;
  for (const serial of serials) {
    const bytes = encodeVarint(serial);
    out.set(bytes, cursor);
    cursor += bytes.length;
  }
  for (const body of bodies) {
    out.set(body, cursor);
    cursor += body.length;
  }
  return out;
}

function decodeSerialValue(
  serial: bigint,
  payload: Uint8Array,
  offset: number,
): { value: SqlValue; next: number } {
  if (serial === 0n) return { value: null, next: offset };
  if (serial === 8n) return { value: 0n, next: offset };
  if (serial === 9n) return { value: 1n, next: offset };
  if (serial >= 1n && serial <= 6n) {
    const width = WIDTH_BY_SERIAL[Number(serial)] ?? 0;
    return { value: readSignedInteger(payload, offset, width), next: offset + width };
  }
  if (serial === 7n) {
    if (offset + 8 > payload.length) throw new RangeError('truncated float in record');
    const view = new DataView(payload.buffer, payload.byteOffset + offset, 8);
    return { value: view.getFloat64(0, false), next: offset + 8 };
  }
  if (serial >= 12n) {
    const numeric = Number(serial);
    if (numeric % 2 === 0) {
      const length = (numeric - 12) / 2;
      return { value: payload.slice(offset, offset + length), next: offset + length };
    }
    const length = (numeric - 13) / 2;
    return {
      value: UTF8_DECODER.decode(payload.subarray(offset, offset + length)),
      next: offset + length,
    };
  }
  throw new RangeError(`reserved serial type ${serial}`);
}

/** Decode a record into its values. */
export function decodeRecord(payload: Uint8Array): SqlValue[] {
  const header = decodeVarint(payload, 0);
  const headerSize = Number(header.value);
  if (headerSize > payload.length) throw new RangeError('record header runs past the payload');

  const serials: bigint[] = [];
  let cursor = header.length;
  while (cursor < headerSize) {
    const serial = decodeVarint(payload, cursor);
    serials.push(serial.value);
    cursor += serial.length;
  }

  let body = headerSize;
  const values: SqlValue[] = [];
  for (const serial of serials) {
    const decoded = decodeSerialValue(serial, payload, body);
    values.push(decoded.value);
    body = decoded.next;
  }
  return values;
}

// ===========================================================================
// §4. Pages, the pager, and the database header
// ===========================================================================

export const DEFAULT_PAGE_SIZE = 4096;
const MAGIC = 'SQLite format 3\u0000';

export class SqlError extends Error {
  readonly position: number;

  constructor(message: string, position = -1) {
    super(message);
    this.name = 'SqlError';
    this.position = position;
  }
}

export function readUint16(buffer: Uint8Array, offset: number): number {
  return (((buffer[offset] ?? 0) << 8) | (buffer[offset + 1] ?? 0)) & 0xffff;
}

export function writeUint16(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = (value >>> 8) & 0xff;
  buffer[offset + 1] = value & 0xff;
}

export function readUint32(buffer: Uint8Array, offset: number): number {
  return (
    (((buffer[offset] ?? 0) << 24) |
      ((buffer[offset + 1] ?? 0) << 16) |
      ((buffer[offset + 2] ?? 0) << 8) |
      (buffer[offset + 3] ?? 0)) >>>
    0
  );
}

export function writeUint32(buffer: Uint8Array, offset: number, value: number): void {
  buffer[offset] = (value >>> 24) & 0xff;
  buffer[offset + 1] = (value >>> 16) & 0xff;
  buffer[offset + 2] = (value >>> 8) & 0xff;
  buffer[offset + 3] = value & 0xff;
}

/** The storage layer the pager talks to. Page numbers are 1-based. */
export interface PageStore {
  readonly pageSize: number;
  readonly pageCount: number;
  readPage(pageNumber: number): Uint8Array;
  writePage(pageNumber: number, page: Uint8Array): void;
  allocatePage(): number;
  truncate(pageCount: number): void;
}

/** An in-memory stand-in for a database file. */
export class MemoryPageStore implements PageStore {
  readonly pageSize: number;
  private readonly pages: Uint8Array[] = [];

  constructor(pageSize: number = DEFAULT_PAGE_SIZE) {
    this.pageSize = pageSize;
  }

  get pageCount(): number {
    return this.pages.length;
  }

  readPage(pageNumber: number): Uint8Array {
    const page = this.pages[pageNumber - 1];
    if (page === undefined) throw new RangeError(`page ${pageNumber} is out of range`);
    return page.slice();
  }

  writePage(pageNumber: number, page: Uint8Array): void {
    if (page.length !== this.pageSize) {
      throw new RangeError(`page ${pageNumber} is ${page.length} bytes, expected ${this.pageSize}`);
    }
    this.pages[pageNumber - 1] = page.slice();
  }

  allocatePage(): number {
    this.pages.push(new Uint8Array(this.pageSize));
    return this.pages.length;
  }

  truncate(pageCount: number): void {
    this.pages.length = Math.max(0, pageCount);
  }
}

/** A one-page-at-a-time cache in front of a PageStore. */
export class Pager {
  private readonly store: PageStore;
  private readonly cache = new Map<number, Uint8Array>();

  constructor(store: PageStore) {
    this.store = store;
  }

  get pageSize(): number {
    return this.store.pageSize;
  }

  get pageCount(): number {
    return this.store.pageCount;
  }

  read(pageNumber: number): Uint8Array {
    const cached = this.cache.get(pageNumber);
    if (cached !== undefined) return cached;
    const page = this.store.readPage(pageNumber);
    this.cache.set(pageNumber, page);
    return page;
  }

  write(pageNumber: number, page: Uint8Array): void {
    this.store.writePage(pageNumber, page);
    this.cache.set(pageNumber, page.slice());
  }

  allocate(): number {
    const pageNumber = this.store.allocatePage();
    const page = new Uint8Array(this.pageSize);
    this.store.writePage(pageNumber, page);
    this.cache.set(pageNumber, page);
    return pageNumber;
  }

  flush(): void {
    this.cache.clear();
  }
}

/** The 100-byte header that lives at the start of page 1. */
export interface DatabaseHeader {
  pageSize: number;
  writeVersion: number;
  readVersion: number;
  reservedBytes: number;
  pageCount: number;
  schemaCookie: number;
  textEncoding: number;
  userVersion: number;
  applicationId: number;
}

export function readDatabaseHeader(page: Uint8Array): DatabaseHeader {
  let magic = '';
  for (let index = 0; index < MAGIC.length; index += 1) {
    magic += String.fromCharCode(page[index] ?? 0);
  }
  if (magic !== MAGIC) throw new SqlError('file is not a database');
  const rawPageSize = readUint16(page, 16);
  return {
    pageSize: rawPageSize === 1 ? 65536 : rawPageSize,
    writeVersion: page[18] ?? 0,
    readVersion: page[19] ?? 0,
    reservedBytes: page[20] ?? 0,
    pageCount: readUint32(page, 28),
    schemaCookie: readUint32(page, 40),
    textEncoding: readUint32(page, 56),
    userVersion: readUint32(page, 60),
    applicationId: readUint32(page, 68),
  };
}

/** Lay down a fresh header page for an empty database file. */
export function initializeDatabase(store: PageStore): DatabaseHeader {
  const page = new Uint8Array(store.pageSize);
  for (let index = 0; index < MAGIC.length; index += 1) {
    page[index] = MAGIC.charCodeAt(index);
  }
  writeUint16(page, 16, store.pageSize === 65536 ? 1 : store.pageSize);
  page[18] = 1; // write version: legacy (rollback journal)
  page[19] = 1; // read version: legacy
  page[20] = 0; // reserved bytes per page
  writeUint32(page, 24, 1); // file change counter
  writeUint32(page, 28, 1); // database size in pages
  writeUint32(page, 40, 0); // schema cookie
  writeUint32(page, 44, 4); // schema format number
  writeUint32(page, 48, 0); // default page cache size
  writeUint32(page, 56, 1); // text encoding: UTF-8
  writeUint32(page, 60, 0); // user version
  writeUint32(page, 68, 0); // application id
  writeUint32(page, 92, 1); // version-valid-for
  writeUint32(page, 96, 3_050_000); // "SQLite version" that wrote the file
  store.writePage(1, page);
  return readDatabaseHeader(page);
}

// ===========================================================================
// §5. Table b-tree pages and cursors
// ===========================================================================

export const PAGE_TYPE_INDEX_INTERIOR = 0x02;
export const PAGE_TYPE_TABLE_INTERIOR = 0x05;
export const PAGE_TYPE_INDEX_LEAF = 0x0a;
export const PAGE_TYPE_TABLE_LEAF = 0x0d;

export type PageType =
  | typeof PAGE_TYPE_INDEX_INTERIOR
  | typeof PAGE_TYPE_TABLE_INTERIOR
  | typeof PAGE_TYPE_INDEX_LEAF
  | typeof PAGE_TYPE_TABLE_LEAF;

function isPageType(value: number): value is PageType {
  return (
    value === PAGE_TYPE_INDEX_INTERIOR ||
    value === PAGE_TYPE_TABLE_INTERIOR ||
    value === PAGE_TYPE_INDEX_LEAF ||
    value === PAGE_TYPE_TABLE_LEAF
  );
}

export interface BtreeNode {
  pageNumber: number;
  type: PageType;
  cellCount: number;
  /** Byte offset of each cell within the page. */
  cellPointers: number[];
  /** Right-most child, interior pages only. */
  rightMostPage: number | undefined;
  /** Offset where the cell content area begins. */
  contentStart: number;
  freeblockOffset: number;
  fragmentedFreeBytes: number;
}

/** Parse a page header and its cell pointer array. */
export function decodeBtreeNode(page: Uint8Array, pageNumber: number): BtreeNode {
  const type = page[0] ?? 0;
  if (!isPageType(type)) throw new SqlError(`page ${pageNumber} is not a b-tree page (type ${type})`);
  const interior = type === PAGE_TYPE_INDEX_INTERIOR || type === PAGE_TYPE_TABLE_INTERIOR;
  const headerSize = interior ? 12 : 8;
  const cellCount = readUint16(page, 3);
  const cellPointers: number[] = [];
  for (let index = 0; index < cellCount; index += 1) {
    cellPointers.push(readUint16(page, headerSize + index * 2));
  }
  return {
    pageNumber,
    type,
    cellCount,
    cellPointers,
    rightMostPage: interior ? readUint32(page, 8) : undefined,
    contentStart: readUint16(page, 5) || page.length,
    freeblockOffset: readUint16(page, 1),
    fragmentedFreeBytes: page[7] ?? 0,
  };
}

export interface TableLeafCell {
  rowid: bigint;
  payload: Uint8Array;
  payloadLength: bigint;
  nextOffset: number;
}

/** A table leaf cell is `varint(payload size) || varint(rowid) || payload`. */
export function decodeTableLeafCell(page: Uint8Array, offset: number): TableLeafCell {
  const payloadLength = decodeVarint(page, offset);
  const rowid = decodeVarint(page, offset + payloadLength.length);
  const payloadStart = offset + payloadLength.length + rowid.length;
  const length = Number(payloadLength.value);
  return {
    rowid: rowid.value,
    payloadLength: payloadLength.value,
    payload: page.slice(payloadStart, payloadStart + length),
    nextOffset: payloadStart + length,
  };
}

export function encodeTableLeafCell(rowid: bigint, payload: Uint8Array): Uint8Array {
  const lengthBytes = encodeVarint(payload.length);
  const rowidBytes = encodeVarint(rowid);
  const cell = new Uint8Array(lengthBytes.length + rowidBytes.length + payload.length);
  cell.set(lengthBytes, 0);
  cell.set(rowidBytes, lengthBytes.length);
  cell.set(payload, lengthBytes.length + rowidBytes.length);
  return cell;
}

/** An interior table cell is `uint32(child page) || varint(max rowid of child)`. */
export function decodeTableInteriorCell(
  page: Uint8Array,
  offset: number,
): { childPage: number; key: bigint; nextOffset: number } {
  const childPage = readUint32(page, offset);
  const key = decodeVarint(page, offset + 4);
  return { childPage, key: key.value, nextOffset: offset + 4 + key.length };
}

export function encodeTableInteriorCell(childPage: number, key: bigint): Uint8Array {
  const keyBytes = encodeVarint(key);
  const cell = new Uint8Array(4 + keyBytes.length);
  writeUint32(cell, 0, childPage);
  cell.set(keyBytes, 4);
  return cell;
}

/**
 * An in-order walk over a table b-tree. The stack holds one frame per interior
 * page on the current path; each frame remembers which cell it is descending
 * into, which is what makes this an explicit-stack recursion.
 */
export class TableBtreeCursor {
  private readonly pager: Pager;
  private readonly rootPage: number;

  constructor(pager: Pager, rootPage: number) {
    this.pager = pager;
    this.rootPage = rootPage;
  }

  *entries(): Generator<TableLeafCell> {
    interface Frame {
      page: Uint8Array;
      node: BtreeNode;
      index: number;
    }

    const stack: Frame[] = [];
    const descend = (pageNumber: number): void => {
      const page = this.pager.read(pageNumber);
      stack.push({ page, node: decodeBtreeNode(page, pageNumber), index: 0 });
    };

    descend(this.rootPage);
    while (stack.length > 0) {
      const frame = stack[stack.length - 1];
      if (frame === undefined) break;
      const { node } = frame;

      if (node.type === PAGE_TYPE_TABLE_LEAF) {
        if (frame.index < node.cellPointers.length) {
          const offset = node.cellPointers[frame.index] ?? 0;
          frame.index += 1;
          yield decodeTableLeafCell(frame.page, offset);
        } else {
          stack.pop();
        }
        continue;
      }

      if (node.type !== PAGE_TYPE_TABLE_INTERIOR) {
        throw new SqlError(`page ${node.pageNumber} is not a table b-tree page`);
      }
      if (frame.index < node.cellPointers.length) {
        const offset = node.cellPointers[frame.index] ?? 0;
        frame.index += 1;
        descend(readUint32(frame.page, offset));
      } else {
        const rightMost = node.rightMostPage ?? 0;
        stack.pop();
        if (rightMost !== 0) descend(rightMost);
      }
    }
  }
}

export interface BtreeEntry {
  rowid: bigint;
  payload: Uint8Array;
}

/**
 * Packs encoded records into leaf pages and, when more than one leaf is needed,
 * builds a single interior root over them. This is the "bulk load" half of a
 * b-tree; incremental insert/delete balancing is deliberately left out.
 */
export class BtreeBuilder {
  private readonly pager: Pager;

  constructor(pager: Pager) {
    this.pager = pager;
  }

  build(entries: readonly BtreeEntry[]): number {
    const capacity = this.pager.pageSize;
    const leaves: { pageNumber: number; maxRowid: bigint }[] = [];

    let cells: Uint8Array[] = [];
    let used = 8; // the leaf page header
    let chunkMaxRowid = 0n;

    const flush = (): void => {
      if (cells.length === 0) return;
      const pageNumber = this.pager.allocate();
      this.writeLeafPage(pageNumber, cells);
      leaves.push({ pageNumber, maxRowid: chunkMaxRowid });
      cells = [];
      used = 8;
      chunkMaxRowid = 0n;
    };

    for (const entry of entries) {
      const cell = encodeTableLeafCell(entry.rowid, entry.payload);
      if (cell.length + 8 + 2 > capacity) {
        throw new SqlError(`row ${entry.rowid} does not fit on a ${capacity}-byte page`);
      }
      if (cells.length > 0 && used + 2 + cell.length > capacity) flush();
      cells.push(cell);
      used += 2 + cell.length;
      chunkMaxRowid = entry.rowid;
    }
    flush();

    if (leaves.length === 0) {
      const pageNumber = this.pager.allocate();
      this.writeLeafPage(pageNumber, []);
      return pageNumber;
    }
    if (leaves.length === 1) {
      const only = leaves[0];
      return only === undefined ? 0 : only.pageNumber;
    }

    const rightMost = leaves[leaves.length - 1];
    if (rightMost === undefined) throw new SqlError('unreachable: no right-most leaf');
    const interiorCells: Uint8Array[] = [];
    for (const leaf of leaves.slice(0, -1)) {
      interiorCells.push(encodeTableInteriorCell(leaf.pageNumber, leaf.maxRowid));
    }
    const rootPage = this.pager.allocate();
    this.writeInteriorPage(rootPage, interiorCells, rightMost.pageNumber);
    return rootPage;
  }

  private writeLeafPage(pageNumber: number, cells: readonly Uint8Array[]): void {
    const page = new Uint8Array(this.pager.pageSize);
    let content = page.length;
    const pointers: number[] = [];
    for (const cell of cells) {
      content -= cell.length;
      page.set(cell, content);
      pointers.push(content);
    }
    page[0] = PAGE_TYPE_TABLE_LEAF;
    writeUint16(page, 1, 0); // no freeblocks
    writeUint16(page, 3, cells.length);
    writeUint16(page, 5, content >= page.length ? 0 : content);
    page[7] = 0;
    pointers.forEach((pointer, index) => writeUint16(page, 8 + index * 2, pointer));
    this.pager.write(pageNumber, page);
  }

  private writeInteriorPage(
    pageNumber: number,
    cells: readonly Uint8Array[],
    rightMost: number,
  ): void {
    const page = new Uint8Array(this.pager.pageSize);
    let content = page.length;
    const pointers: number[] = [];
    for (const cell of cells) {
      content -= cell.length;
      page.set(cell, content);
      pointers.push(content);
    }
    page[0] = PAGE_TYPE_TABLE_INTERIOR;
    writeUint16(page, 1, 0);
    writeUint16(page, 3, cells.length);
    writeUint16(page, 5, content >= page.length ? 0 : content);
    page[7] = 0;
    writeUint32(page, 8, rightMost);
    pointers.forEach((pointer, index) => writeUint16(page, 12 + index * 2, pointer));
    this.pager.write(pageNumber, page);
  }
}

// ===========================================================================
// §6. SQL tokens
// ===========================================================================

export type TokenKind = 'keyword' | 'identifier' | 'number' | 'string' | 'blob' | 'punct' | 'eof';

export interface Token {
  kind: TokenKind;
  text: string;
  value: SqlValue;
  start: number;
  end: number;
}

const KEYWORDS = new Set([
  'ADD',
  'ALL',
  'ALWAYS',
  'AND',
  'AS',
  'ASC',
  'AUTOINCREMENT',
  'BETWEEN',
  'BLOB',
  'BY',
  'CASE',
  'CAST',
  'CHECK',
  'COLLATE',
  'CONSTRAINT',
  'CREATE',
  'DEFAULT',
  'DEFERRABLE',
  'DELETE',
  'DESC',
  'DISTINCT',
  'DROP',
  'ELSE',
  'END',
  'EXISTS',
  'FALSE',
  'FOREIGN',
  'FROM',
  'GENERATED',
  'GROUP',
  'HAVING',
  'IF',
  'IN',
  'INDEX',
  'INSERT',
  'INTEGER',
  'INTO',
  'IS',
  'JOIN',
  'KEY',
  'LEFT',
  'LIKE',
  'LIMIT',
  'NOT',
  'NULL',
  'NUMERIC',
  'OFFSET',
  'ON',
  'OR',
  'ORDER',
  'PRIMARY',
  'REAL',
  'REFERENCES',
  'REPLACE',
  'SELECT',
  'SET',
  'TABLE',
  'TEXT',
  'THEN',
  'TRUE',
  'UNION',
  'UNIQUE',
  'UPDATE',
  'VALUES',
  'WHEN',
  'WHERE',
  'WITH',
]);

const TWO_CHAR_PUNCTUATION = ['<=', '>=', '!=', '<>', '=='];
const ONE_CHAR_PUNCTUATION = new Set(['(', ')', ',', ';', '.', '*', '+', '-', '/', '%', '=', '<', '>']);

function isDigit(character: string | undefined): boolean {
  return character !== undefined && character >= '0' && character <= '9';
}

function isHexDigit(character: string | undefined): boolean {
  return character !== undefined && /[0-9a-fA-F]/.test(character);
}

function isIdentifierStart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z_\u0080-￿]/.test(character);
}

function isIdentifierPart(character: string | undefined): boolean {
  return character !== undefined && /[A-Za-z0-9_$\u0080-￿]/.test(character);
}

/** Split SQL text into tokens. Throws on unterminated literals. */
export function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;

  while (index < sql.length) {
    const character = sql[index] ?? '';

    if (/\s/.test(character)) {
      index += 1;
      continue;
    }

    if (character === '-' && sql[index + 1] === '-') {
      while (index < sql.length && sql[index] !== '\n') index += 1;
      continue;
    }

    if (character === '/' && sql[index + 1] === '*') {
      const close = sql.indexOf('*/', index + 2);
      index = close === -1 ? sql.length : close + 2;
      continue;
    }

    if (character === "'") {
      const start = index;
      index += 1;
      let text = '';
      for (;;) {
        if (index >= sql.length) throw new SqlError('unterminated string literal', start);
        const inner = sql[index] ?? '';
        if (inner === "'") {
          if (sql[index + 1] === "'") {
            text += "'";
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        text += inner;
        index += 1;
      }
      tokens.push({ kind: 'string', text: sql.slice(start, index), value: text, start, end: index });
      continue;
    }

    if (character === '"' || character === '`' || character === '[') {
      const start = index;
      const closing = character === '[' ? ']' : character;
      index += 1;
      let text = '';
      for (;;) {
        if (index >= sql.length) throw new SqlError('unterminated quoted identifier', start);
        const inner = sql[index] ?? '';
        if (inner === closing) {
          if (character !== '[' && sql[index + 1] === closing) {
            text += closing;
            index += 2;
            continue;
          }
          index += 1;
          break;
        }
        text += inner;
        index += 1;
      }
      tokens.push({ kind: 'identifier', text, value: null, start, end: index });
      continue;
    }

    if ((character === 'x' || character === 'X') && sql[index + 1] === "'") {
      const start = index;
      index += 2;
      let hex = '';
      for (;;) {
        if (index >= sql.length) throw new SqlError('unterminated blob literal', start);
        const inner = sql[index] ?? '';
        if (inner === "'") {
          index += 1;
          break;
        }
        if (!isHexDigit(inner)) throw new SqlError('invalid hex digit in blob literal', index);
        hex += inner;
        index += 1;
      }
      if (hex.length % 2 !== 0) {
        throw new SqlError('blob literal has an odd number of hex digits', start);
      }
      const bytes = new Uint8Array(hex.length / 2);
      for (let cursor = 0; cursor < bytes.length; cursor += 1) {
        bytes[cursor] = Number.parseInt(hex.slice(cursor * 2, cursor * 2 + 2), 16);
      }
      tokens.push({ kind: 'blob', text: sql.slice(start, index), value: bytes, start, end: index });
      continue;
    }

    if (isDigit(character) || (character === '.' && isDigit(sql[index + 1]))) {
      const start = index;
      if (character === '0' && (sql[index + 1] === 'x' || sql[index + 1] === 'X')) {
        index += 2;
        while (isHexDigit(sql[index])) index += 1;
        const digits = sql.slice(start + 2, index);
        tokens.push({
          kind: 'number',
          text: sql.slice(start, index),
          value: digits === '' ? 0n : BigInt(`0x${digits}`),
          start,
          end: index,
        });
        continue;
      }
      while (isDigit(sql[index])) index += 1;
      let isReal = false;
      if (sql[index] === '.') {
        isReal = true;
        index += 1;
        while (isDigit(sql[index])) index += 1;
      }
      if (sql[index] === 'e' || sql[index] === 'E') {
        isReal = true;
        index += 1;
        if (sql[index] === '+' || sql[index] === '-') index += 1;
        while (isDigit(sql[index])) index += 1;
      }
      const text = sql.slice(start, index);
      tokens.push({
        kind: 'number',
        text,
        value: isReal ? Number(text) : BigInt(text),
        start,
        end: index,
      });
      continue;
    }

    if (isIdentifierStart(character)) {
      const start = index;
      while (isIdentifierPart(sql[index])) index += 1;
      const text = sql.slice(start, index);
      const upper = text.toUpperCase();
      tokens.push({
        kind: KEYWORDS.has(upper) ? 'keyword' : 'identifier',
        text,
        value: null,
        start,
        end: index,
      });
      continue;
    }

    const two = sql.slice(index, index + 2);
    if (TWO_CHAR_PUNCTUATION.includes(two)) {
      tokens.push({ kind: 'punct', text: two, value: null, start: index, end: index + 2 });
      index += 2;
      continue;
    }

    if (ONE_CHAR_PUNCTUATION.has(character)) {
      tokens.push({ kind: 'punct', text: character, value: null, start: index, end: index + 1 });
      index += 1;
      continue;
    }

    throw new SqlError(`unexpected character "${character}"`, index);
  }

  tokens.push({ kind: 'eof', text: '', value: null, start: sql.length, end: sql.length });
  return tokens;
}

// ===========================================================================
// §7. The AST
// ===========================================================================

export type Expr =
  | { kind: 'literal'; value: SqlValue }
  | { kind: 'column'; table: string | undefined; name: string }
  | { kind: 'unary'; op: '-' | 'NOT'; operand: Expr }
  | { kind: 'binary'; op: string; left: Expr; right: Expr }
  | { kind: 'call'; name: string; args: Expr[] }
  | { kind: 'star'; table: string | undefined };

export type SelectItem =
  | { kind: 'star'; table: string | undefined }
  | { kind: 'expr'; expression: Expr; alias: string | undefined };

export interface OrderTerm {
  expression: Expr;
  descending: boolean;
}

export interface ColumnSchema {
  name: string;
  type: ColumnType;
  notNull: boolean;
  primaryKey: boolean;
  defaultValue: Expr | null;
}

export interface CreateTableStatement {
  kind: 'create-table';
  name: string;
  ifNotExists: boolean;
  columns: ColumnSchema[];
}

export interface InsertStatement {
  kind: 'insert';
  table: string;
  columns: string[] | undefined;
  rows: Expr[][];
}

export interface SelectStatement {
  kind: 'select';
  projections: SelectItem[];
  table: string;
  where: Expr | undefined;
  orderBy: OrderTerm[];
  limit: Expr | undefined;
  offset: Expr | undefined;
}

export interface DeleteStatement {
  kind: 'delete';
  table: string;
  where: Expr | undefined;
}

export interface UpdateStatement {
  kind: 'update';
  table: string;
  assignments: { column: string; value: Expr }[];
  where: Expr | undefined;
}

export interface DropTableStatement {
  kind: 'drop-table';
  name: string;
  ifExists: boolean;
}

export type Statement =
  | CreateTableStatement
  | InsertStatement
  | SelectStatement
  | DeleteStatement
  | UpdateStatement
  | DropTableStatement;

// ===========================================================================
// §8. The parser
// ===========================================================================

const COLUMN_CONSTRAINT_KEYWORDS = new Set([
  'PRIMARY',
  'NOT',
  'NULL',
  'DEFAULT',
  'UNIQUE',
  'CHECK',
  'REFERENCES',
  'COLLATE',
  'GENERATED',
  'AS',
  'CONSTRAINT',
  'ON',
  'DEFERRABLE',
  'ASC',
  'DESC',
  'AUTOINCREMENT',
]);

/** SQLite's affinity rules, compressed into a couple of substring tests. */
function mapColumnType(word: string): ColumnType {
  const upper = word.toUpperCase();
  if (upper.includes('INT')) return 'INTEGER';
  if (upper.includes('CHAR') || upper.includes('CLOB') || upper.includes('TEXT')) return 'TEXT';
  if (upper.includes('BLOB')) return 'BLOB';
  if (upper.includes('REAL') || upper.includes('FLOA') || upper.includes('DOUB')) return 'REAL';
  return 'NUMERIC';
}

/** Parse a whole SQL script into statements. */
export function parseSql(sql: string): Statement[] {
  return new SqlParser(sql).parseScript();
}

class SqlParser {
  private readonly tokens: Token[];
  private position = 0;

  constructor(sql: string) {
    this.tokens = tokenize(sql);
  }

  parseScript(): Statement[] {
    const statements: Statement[] = [];
    for (;;) {
      while (this.matchPunct(';')) {
        // stray separators are harmless
      }
      if (this.peek().kind === 'eof') break;
      statements.push(this.parseStatement());
      if (!this.isPunct(';') && this.peek().kind !== 'eof') {
        this.fail('expected ";" or end of input');
      }
    }
    return statements;
  }

  // -- token helpers --------------------------------------------------------

  private peek(offset = 0): Token {
    const index = Math.min(this.position + offset, this.tokens.length - 1);
    return this.tokens[index] ?? { kind: 'eof', text: '', value: null, start: 0, end: 0 };
  }

  private advance(): Token {
    const token = this.peek();
    if (token.kind !== 'eof') this.position += 1;
    return token;
  }

  private isKeyword(word: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'keyword' && token.text.toUpperCase() === word;
  }

  private matchKeyword(word: string): boolean {
    if (!this.isKeyword(word)) return false;
    this.advance();
    return true;
  }

  private expectKeyword(word: string): void {
    if (!this.matchKeyword(word)) this.fail(`expected ${word}`);
  }

  private isPunct(text: string, offset = 0): boolean {
    const token = this.peek(offset);
    return token.kind === 'punct' && token.text === text;
  }

  private matchPunct(text: string): boolean {
    if (!this.isPunct(text)) return false;
    this.advance();
    return true;
  }

  private expectPunct(text: string): void {
    if (!this.matchPunct(text)) this.fail(`expected "${text}"`);
  }

  private expectIdentifier(): string {
    const token = this.peek();
    if (token.kind !== 'identifier') this.fail('expected an identifier');
    this.advance();
    return token.text;
  }

  /** Consume to the end of the parenthesised group we just entered. */
  private skipBalanced(): void {
    let depth = 1;
    for (;;) {
      const token = this.peek();
      if (token.kind === 'eof') this.fail('unterminated parenthesised expression');
      this.advance();
      if (token.kind !== 'punct') continue;
      if (token.text === '(') depth += 1;
      else if (token.text === ')') {
        depth -= 1;
        if (depth === 0) return;
      }
    }
  }

  /** Skip a table-level constraint, up to the next comma or the closing paren. */
  private skipConstraintTail(): void {
    let depth = 0;
    for (;;) {
      const token = this.peek();
      if (token.kind === 'eof') return;
      if (token.kind === 'punct') {
        if (token.text === '(') depth += 1;
        else if (token.text === ')') {
          if (depth === 0) return;
          depth -= 1;
        } else if (token.text === ',' && depth === 0) return;
      }
      this.advance();
    }
  }

  private fail(message: string): never {
    const token = this.peek();
    const found = token.kind === 'eof' ? 'end of input' : `"${token.text}"`;
    throw new SqlError(`${message}, found ${found} at offset ${token.start}`, token.start);
  }

  // -- statements -----------------------------------------------------------

  private parseStatement(): Statement {
    const token = this.peek();
    if (token.kind !== 'keyword') this.fail('expected a statement');
    switch (token.text.toUpperCase()) {
      case 'CREATE':
        return this.parseCreateTable();
      case 'INSERT':
        return this.parseInsert();
      case 'SELECT':
        return this.parseSelect();
      case 'DELETE':
        return this.parseDelete();
      case 'UPDATE':
        return this.parseUpdate();
      case 'DROP':
        return this.parseDrop();
      default:
        this.fail(`unsupported statement "${token.text}"`);
    }
  }

  private parseCreateTable(): CreateTableStatement {
    this.expectKeyword('CREATE');
    if (this.isKeyword('UNIQUE') || this.isKeyword('INDEX')) {
      this.fail('indexes are not supported by this toy');
    }
    this.expectKeyword('TABLE');
    const ifNotExists = this.parseIfNotExists();
    const name = this.parseQualifiedName();
    this.expectPunct('(');

    const columns: ColumnSchema[] = [];
    do {
      if (
        this.isKeyword('PRIMARY') ||
        this.isKeyword('UNIQUE') ||
        this.isKeyword('CHECK') ||
        this.isKeyword('FOREIGN') ||
        this.isKeyword('CONSTRAINT')
      ) {
        this.parseTableConstraint(columns);
        continue;
      }
      columns.push(this.parseColumnDefinition());
    } while (this.matchPunct(','));
    this.expectPunct(')');

    return { kind: 'create-table', name, ifNotExists, columns };
  }

  private parseTableConstraint(columns: ColumnSchema[]): void {
    if (this.matchKeyword('CONSTRAINT')) this.expectIdentifier();
    if (this.matchKeyword('PRIMARY')) {
      this.expectKeyword('KEY');
      this.expectPunct('(');
      const names: string[] = [];
      do {
        names.push(this.parseQualifiedName());
      } while (this.matchPunct(','));
      this.expectPunct(')');
      for (const name of names) {
        const column = columns.find(
          (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
        );
        if (column !== undefined) column.primaryKey = true;
      }
    }
    this.skipConstraintTail();
  }

  private parseColumnDefinition(): ColumnSchema {
    const name = this.expectIdentifier();
    let type: ColumnType = 'BLOB';

    const next = this.peek();
    const nextWord = next.text.toUpperCase();
    const looksLikeType =
      (next.kind === 'identifier' || next.kind === 'keyword') &&
      !COLUMN_CONSTRAINT_KEYWORDS.has(nextWord);
    if (looksLikeType) {
      this.advance();
      if (this.isPunct('(')) {
        this.expectPunct('(');
        this.skipBalanced();
      }
      type = mapColumnType(nextWord);
    }

    let notNull = false;
    let primaryKey = false;
    let defaultValue: Expr | null = null;

    for (;;) {
      if (this.matchKeyword('PRIMARY')) {
        this.expectKeyword('KEY');
        primaryKey = true;
        if (this.isKeyword('ASC') || this.isKeyword('DESC')) this.advance();
        this.matchKeyword('AUTOINCREMENT');
        continue;
      }
      if (this.matchKeyword('NOT')) {
        this.expectKeyword('NULL');
        notNull = true;
        continue;
      }
      if (this.matchKeyword('NULL')) continue;
      if (this.matchKeyword('UNIQUE')) {
        if (this.isPunct('(')) {
          this.expectPunct('(');
          this.skipBalanced();
        }
        continue;
      }
      if (this.matchKeyword('DEFAULT')) {
        defaultValue = this.parsePrimary();
        continue;
      }
      if (this.matchKeyword('CHECK')) {
        this.expectPunct('(');
        this.skipBalanced();
        continue;
      }
      if (this.matchKeyword('COLLATE')) {
        this.expectIdentifier();
        continue;
      }
      if (this.matchKeyword('REFERENCES')) {
        this.skipConstraintTail();
        continue;
      }
      if (this.matchKeyword('CONSTRAINT')) {
        this.expectIdentifier();
        continue;
      }
      break;
    }

    return { name, type, notNull, primaryKey, defaultValue };
  }

  private parseInsert(): InsertStatement {
    this.expectKeyword('INSERT');
    if (this.matchKeyword('OR')) this.advance(); // conflict action, ignored
    else this.matchKeyword('REPLACE');
    this.expectKeyword('INTO');
    const table = this.parseQualifiedName();

    let columns: string[] | undefined;
    if (this.isPunct('(')) {
      this.expectPunct('(');
      const names: string[] = [];
      do {
        names.push(this.expectIdentifier());
      } while (this.matchPunct(','));
      this.expectPunct(')');
      columns = names;
    }

    this.expectKeyword('VALUES');
    const rows: Expr[][] = [];
    do {
      this.expectPunct('(');
      const values: Expr[] = [];
      do {
        values.push(this.parseExpression());
      } while (this.matchPunct(','));
      this.expectPunct(')');
      rows.push(values);
    } while (this.matchPunct(','));

    return { kind: 'insert', table, columns, rows };
  }

  private parseSelect(): SelectStatement {
    this.expectKeyword('SELECT');
    this.matchKeyword('DISTINCT');

    const projections: SelectItem[] = [];
    do {
      projections.push(this.parseSelectItem());
    } while (this.matchPunct(','));

    let table = '';
    if (this.matchKeyword('FROM')) table = this.parseQualifiedName();

    let where: Expr | undefined;
    if (this.matchKeyword('WHERE')) where = this.parseExpression();

    const orderBy: OrderTerm[] = [];
    if (this.matchKeyword('ORDER')) {
      this.expectKeyword('BY');
      do {
        const expression = this.parseExpression();
        let descending = false;
        if (this.matchKeyword('DESC')) descending = true;
        else this.matchKeyword('ASC');
        orderBy.push({ expression, descending });
      } while (this.matchPunct(','));
    }

    let limit: Expr | undefined;
    let offset: Expr | undefined;
    if (this.matchKeyword('LIMIT')) {
      limit = this.parseExpression();
      if (this.matchKeyword('OFFSET')) offset = this.parseExpression();
    }

    return { kind: 'select', projections, table, where, orderBy, limit, offset };
  }

  private parseSelectItem(): SelectItem {
    if (this.isPunct('*')) {
      this.advance();
      return { kind: 'star', table: undefined };
    }
    if (this.peek().kind === 'identifier' && this.isPunct('.', 1) && this.isPunct('*', 2)) {
      const table = this.advance().text;
      this.advance();
      this.advance();
      return { kind: 'star', table };
    }

    const expression = this.parseExpression();
    let alias: string | undefined;
    if (this.matchKeyword('AS')) alias = this.expectIdentifier();
    else if (this.peek().kind === 'identifier') alias = this.advance().text;
    return { kind: 'expr', expression, alias };
  }

  private parseDelete(): DeleteStatement {
    this.expectKeyword('DELETE');
    this.expectKeyword('FROM');
    const table = this.parseQualifiedName();
    let where: Expr | undefined;
    if (this.matchKeyword('WHERE')) where = this.parseExpression();
    return { kind: 'delete', table, where };
  }

  private parseUpdate(): UpdateStatement {
    this.expectKeyword('UPDATE');
    const table = this.parseQualifiedName();
    this.expectKeyword('SET');
    const assignments: { column: string; value: Expr }[] = [];
    do {
      const column = this.expectIdentifier();
      this.expectPunct('=');
      assignments.push({ column, value: this.parseExpression() });
    } while (this.matchPunct(','));
    let where: Expr | undefined;
    if (this.matchKeyword('WHERE')) where = this.parseExpression();
    return { kind: 'update', table, assignments, where };
  }

  private parseDrop(): DropTableStatement {
    this.expectKeyword('DROP');
    this.expectKeyword('TABLE');
    let ifExists = false;
    if (this.matchKeyword('IF')) {
      this.expectKeyword('EXISTS');
      ifExists = true;
    }
    return { kind: 'drop-table', name: this.parseQualifiedName(), ifExists };
  }

  private parseIfNotExists(): boolean {
    if (!this.matchKeyword('IF')) return false;
    this.expectKeyword('NOT');
    this.expectKeyword('EXISTS');
    return true;
  }

  private parseQualifiedName(): string {
    let name = this.expectIdentifier();
    while (this.matchPunct('.')) name = this.expectIdentifier();
    return name;
  }

  // -- expressions ----------------------------------------------------------

  private parseExpression(minPrecedence = 0): Expr {
    let left = this.parseUnary();
    for (;;) {
      const operator = this.binaryOperator();
      if (operator === null || operator.precedence < minPrecedence) break;
      this.advance();

      if (operator.text === 'IS') {
        const negated = this.matchKeyword('NOT');
        const right: Expr = this.matchKeyword('NULL')
          ? { kind: 'literal', value: null }
          : this.parseExpression(operator.precedence + 1);
        left = { kind: 'binary', op: negated ? 'IS NOT' : 'IS', left, right };
        continue;
      }

      const right = this.parseExpression(operator.precedence + 1);
      left = { kind: 'binary', op: operator.text, left, right };
    }
    return left;
  }

  private binaryOperator(): { text: string; precedence: number } | null {
    const token = this.peek();
    if (token.kind === 'punct') {
      switch (token.text) {
        case '=':
        case '==':
          return { text: '=', precedence: 4 };
        case '!=':
        case '<>':
          return { text: '!=', precedence: 4 };
        case '<':
        case '<=':
        case '>':
        case '>=':
          return { text: token.text, precedence: 4 };
        case '+':
        case '-':
          return { text: token.text, precedence: 5 };
        case '*':
        case '/':
        case '%':
          return { text: token.text, precedence: 6 };
        default:
          return null;
      }
    }
    if (token.kind === 'keyword') {
      switch (token.text.toUpperCase()) {
        case 'OR':
          return { text: 'OR', precedence: 1 };
        case 'AND':
          return { text: 'AND', precedence: 2 };
        case 'IS':
          return { text: 'IS', precedence: 4 };
        case 'LIKE':
          return { text: 'LIKE', precedence: 4 };
        default:
          return null;
      }
    }
    return null;
  }

  private parseUnary(): Expr {
    if (this.isPunct('-')) {
      this.advance();
      return { kind: 'unary', op: '-', operand: this.parseUnary() };
    }
    if (this.isPunct('+')) {
      this.advance();
      return this.parseUnary();
    }
    if (this.matchKeyword('NOT')) {
      return { kind: 'unary', op: 'NOT', operand: this.parseUnary() };
    }
    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const token = this.peek();

    if (token.kind === 'number' || token.kind === 'string' || token.kind === 'blob') {
      this.advance();
      return { kind: 'literal', value: token.value };
    }

    if (token.kind === 'keyword') {
      const upper = token.text.toUpperCase();
      if (upper === 'NULL') {
        this.advance();
        return { kind: 'literal', value: null };
      }
      if (upper === 'TRUE') {
        this.advance();
        return { kind: 'literal', value: 1n };
      }
      if (upper === 'FALSE') {
        this.advance();
        return { kind: 'literal', value: 0n };
      }
      this.fail(`unexpected keyword "${token.text}"`);
    }

    if (this.isPunct('(')) {
      this.advance();
      const inner = this.parseExpression();
      this.expectPunct(')');
      return inner;
    }

    if (token.kind === 'identifier') {
      this.advance();
      if (this.isPunct('(')) {
        this.advance();
        const args: Expr[] = [];
        if (!this.isPunct(')')) {
          do {
            args.push(this.parseExpression());
          } while (this.matchPunct(','));
        }
        this.expectPunct(')');
        return { kind: 'call', name: token.text, args };
      }
      if (this.matchPunct('.')) {
        return { kind: 'column', table: token.text, name: this.expectIdentifier() };
      }
      return { kind: 'column', table: undefined, name: token.text };
    }

    this.fail('expected an expression');
  }
}

// ===========================================================================
// §9. The expression evaluator
// ===========================================================================

export interface RowScope {
  get(column: string): SqlValue;
}

const EMPTY_SCOPE: RowScope = { get: () => null };

const LIKE_CACHE = new Map<string, RegExp>();

function compileLike(pattern: string): RegExp {
  const cached = LIKE_CACHE.get(pattern);
  if (cached !== undefined) return cached;
  let source = '^';
  for (const character of pattern) {
    if (character === '%') source += '[\\s\\S]*';
    else if (character === '_') source += '[\\s\\S]';
    else source += character.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }
  source += '$';
  const regex = new RegExp(source, 'i');
  LIKE_CACHE.set(pattern, regex);
  return regex;
}

function likeMatch(left: SqlValue, right: SqlValue): SqlValue {
  if (left === null || right === null) return null;
  const text = toSqlString(left);
  const pattern = toSqlString(right);
  return compileLike(pattern).test(text) ? 1n : 0n;
}

function negate(value: SqlValue): SqlValue {
  if (value === null) return null;
  if (typeof value === 'bigint') return -value;
  if (typeof value === 'number') return -value;
  return -toNumericValue(value);
}

/** Integer arithmetic stays integral; anything else falls back to float64. */
export function arithmetic(operator: string, left: SqlValue, right: SqlValue): SqlValue {
  if (left === null || right === null) return null;
  if (typeof left === 'bigint' && typeof right === 'bigint') {
    switch (operator) {
      case '+':
        return left + right;
      case '-':
        return left - right;
      case '*':
        return left * right;
      case '/':
        return right === 0n ? null : left / right;
      case '%':
        return right === 0n ? null : left % right;
      default:
        return null;
    }
  }
  const a = toNumericValue(left);
  const b = toNumericValue(right);
  switch (operator) {
    case '+':
      return a + b;
    case '-':
      return a - b;
    case '*':
      return a * b;
    case '/':
      return b === 0 ? null : a / b;
    case '%':
      return b === 0 ? null : a % b;
    default:
      return null;
  }
}

function compareOperator(operator: string, left: SqlValue, right: SqlValue): SqlValue {
  if (left === null || right === null) return null;
  const comparison = compareValues(left, right);
  switch (operator) {
    case '=':
      return comparison === 0 ? 1n : 0n;
    case '!=':
      return comparison !== 0 ? 1n : 0n;
    case '<':
      return comparison < 0 ? 1n : 0n;
    case '<=':
      return comparison <= 0 ? 1n : 0n;
    case '>':
      return comparison > 0 ? 1n : 0n;
    case '>=':
      return comparison >= 0 ? 1n : 0n;
    default:
      return null;
  }
}

function evaluateCall(name: string, args: SqlValue[]): SqlValue {
  switch (name.toLowerCase()) {
    case 'abs': {
      const value = args[0] ?? null;
      if (value === null) return null;
      if (typeof value === 'bigint') return value < 0n ? -value : value;
      return Math.abs(toNumericValue(value));
    }
    case 'length': {
      const value = args[0] ?? null;
      if (value === null) return null;
      if (typeof value === 'string') return BigInt([...value].length);
      if (value instanceof Uint8Array) return BigInt(value.length);
      return BigInt(toSqlString(value).length);
    }
    case 'lower': {
      const value = args[0] ?? null;
      return value === null ? null : toSqlString(value).toLowerCase();
    }
    case 'upper': {
      const value = args[0] ?? null;
      return value === null ? null : toSqlString(value).toUpperCase();
    }
    case 'typeof':
      return storageClassOf(args[0] ?? null);
    case 'coalesce': {
      for (const value of args) if (value !== null) return value;
      return null;
    }
    case 'ifnull': {
      const value = args[0] ?? null;
      return value !== null ? value : (args[1] ?? null);
    }
    case 'min': {
      let best: SqlValue = args[0] ?? null;
      for (const value of args) if (compareValues(value, best) < 0) best = value;
      return best;
    }
    case 'max': {
      let best: SqlValue = args[0] ?? null;
      for (const value of args) if (compareValues(value, best) > 0) best = value;
      return best;
    }
    default:
      throw new SqlError(`no such function: ${name}`);
  }
}

/** Evaluate an expression against one row, using SQL's three-valued logic. */
export function evaluate(expr: Expr, scope: RowScope): SqlValue {
  switch (expr.kind) {
    case 'literal':
      return expr.value;
    case 'column':
      return scope.get(expr.name);
    case 'star':
      return null;
    case 'unary': {
      const operand = evaluate(expr.operand, scope);
      if (expr.op === 'NOT') {
        return operand === null ? null : isTruthy(operand) ? 0n : 1n;
      }
      return negate(operand);
    }
    case 'call':
      return evaluateCall(
        expr.name,
        expr.args.map((argument) => evaluate(argument, scope)),
      );
    case 'binary': {
      const left = evaluate(expr.left, scope);

      if (expr.op === 'AND') {
        if (left !== null && !isTruthy(left)) return 0n;
        const right = evaluate(expr.right, scope);
        if (right !== null && !isTruthy(right)) return 0n;
        return left === null || right === null ? null : 1n;
      }
      if (expr.op === 'OR') {
        if (left !== null && isTruthy(left)) return 1n;
        const right = evaluate(expr.right, scope);
        if (right !== null && isTruthy(right)) return 1n;
        return left === null || right === null ? null : 0n;
      }

      const right = evaluate(expr.right, scope);
      switch (expr.op) {
        case 'IS':
          return compareValues(left, right) === 0 ? 1n : 0n;
        case 'IS NOT':
          return compareValues(left, right) === 0 ? 0n : 1n;
        case 'LIKE':
          return likeMatch(left, right);
        case '+':
        case '-':
        case '*':
        case '/':
        case '%':
          return arithmetic(expr.op, left, right);
        default:
          return compareOperator(expr.op, left, right);
      }
    }
  }
}

/** A stable, human-readable rendering of an expression, used for column names. */
export function describeExpr(expr: Expr): string {
  switch (expr.kind) {
    case 'literal':
      return typeof expr.value === 'string' ? `'${expr.value}'` : toSqlString(expr.value);
    case 'column':
      return expr.table === undefined ? expr.name : `${expr.table}.${expr.name}`;
    case 'star':
      return '*';
    case 'unary':
      return `${expr.op} ${describeExpr(expr.operand)}`;
    case 'binary':
      return `${describeExpr(expr.left)} ${expr.op} ${describeExpr(expr.right)}`;
    case 'call':
      return `${expr.name}(${expr.args.map(describeExpr).join(', ')})`;
  }
}

// ===========================================================================
// §10. The engine
// ===========================================================================

export interface TableSchema {
  name: string;
  columns: ColumnSchema[];
  /** Page number of the root of this table's b-tree. */
  rootPage: number;
}

export interface StoredRow {
  rowid: bigint;
  values: SqlValue[];
}

export interface QueryResult {
  columns: string[];
  rows: SqlValue[][];
  rowsAffected: number;
}

function emptyResult(): QueryResult {
  return { columns: [], rows: [], rowsAffected: 0 };
}

/** Binds a row's values to its table's column names. */
export class TableRowScope implements RowScope {
  private readonly table: TableSchema;
  private readonly row: StoredRow;

  constructor(table: TableSchema, row: StoredRow) {
    this.table = table;
    this.row = row;
  }

  get(column: string): SqlValue {
    const index = this.table.columns.findIndex(
      (candidate) => candidate.name.toLowerCase() === column.toLowerCase(),
    );
    if (index < 0) throw new SqlError(`no such column: ${column}`);
    return this.row.values[index] ?? null;
  }
}

/** Read a whole table back out of its b-tree image. */
export function scanTableStorage(
  pager: Pager,
  rootPage: number,
): { rowid: bigint; values: SqlValue[] }[] {
  const cursor = new TableBtreeCursor(pager, rootPage);
  const rows: { rowid: bigint; values: SqlValue[] }[] = [];
  for (const entry of cursor.entries()) {
    rows.push({ rowid: entry.rowid, values: decodeRecord(entry.payload) });
  }
  return rows;
}

export class Database {
  readonly pager: Pager;
  readonly header: DatabaseHeader;

  private readonly tables = new Map<string, TableSchema>();
  private readonly rowsByTable = new Map<string, StoredRow[]>();

  private constructor(store: PageStore) {
    const pager = new Pager(store);
    this.pager = pager;
    this.header = readDatabaseHeader(pager.read(1));
  }

  /** Open a database over a page store, creating a header page if needed. */
  static open(store: PageStore = new MemoryPageStore()): Database {
    if (store.pageCount === 0) initializeDatabase(store);
    return new Database(store);
  }

  /** Run a script and return one result per statement. */
  exec(sql: string): QueryResult[] {
    return parseSql(sql).map((statement) => this.execute(statement));
  }

  /** Run a script and return the first result, if any. */
  query(sql: string): QueryResult {
    const results = this.exec(sql);
    return results[0] ?? emptyResult();
  }

  /** The catalog, keyed by lowercase table name. */
  get catalog(): Map<string, TableSchema> {
    return this.tables;
  }

  /** Decode a table straight out of its b-tree pages. */
  readStorage(tableName: string): { rowid: bigint; values: SqlValue[] }[] {
    return scanTableStorage(this.pager, this.requireTable(tableName).rootPage);
  }

  // -- dispatch -------------------------------------------------------------

  private execute(statement: Statement): QueryResult {
    switch (statement.kind) {
      case 'create-table':
        return this.executeCreateTable(statement);
      case 'insert':
        return this.executeInsert(statement);
      case 'select':
        return this.executeSelect(statement);
      case 'delete':
        return this.executeDelete(statement);
      case 'update':
        return this.executeUpdate(statement);
      case 'drop-table':
        return this.executeDropTable(statement);
    }
  }

  // -- catalog helpers ------------------------------------------------------

  private requireTable(name: string): TableSchema {
    const table = this.tables.get(name.toLowerCase());
    if (table === undefined) throw new SqlError(`no such table: ${name}`);
    return table;
  }

  private requireRows(name: string): StoredRow[] {
    const rows = this.rowsByTable.get(name.toLowerCase());
    if (rows === undefined) throw new SqlError(`no such table: ${name}`);
    return rows;
  }

  private columnIndex(table: TableSchema, name: string): number {
    const index = table.columns.findIndex(
      (candidate) => candidate.name.toLowerCase() === name.toLowerCase(),
    );
    if (index < 0) throw new SqlError(`table ${table.name} has no column named ${name}`);
    return index;
  }

  private nextRowid(rows: readonly StoredRow[]): bigint {
    let maximum = 0n;
    for (const row of rows) if (row.rowid > maximum) maximum = row.rowid;
    return maximum + 1n;
  }

  /** Re-encode a table's rows into a fresh b-tree image. */
  private persist(table: TableSchema): void {
    const rows = this.requireRows(table.name);
    const entries: BtreeEntry[] = rows.map((row) => ({
      rowid: row.rowid,
      payload: encodeRecord(row.values),
    }));
    table.rootPage = new BtreeBuilder(this.pager).build(entries);
  }

  // -- statements -----------------------------------------------------------

  private executeCreateTable(statement: CreateTableStatement): QueryResult {
    const key = statement.name.toLowerCase();
    if (this.tables.has(key)) {
      if (statement.ifNotExists) return emptyResult();
      throw new SqlError(`table ${statement.name} already exists`);
    }
    if (statement.columns.length === 0) {
      throw new SqlError('a table needs at least one column');
    }
    for (const column of statement.columns) {
      const duplicates = statement.columns.filter(
        (candidate) => candidate.name.toLowerCase() === column.name.toLowerCase(),
      );
      if (duplicates.length > 1) throw new SqlError(`duplicate column name: ${column.name}`);
    }

    const rootPage = this.pager.allocate();
    const empty = new Uint8Array(this.pager.pageSize);
    empty[0] = PAGE_TYPE_TABLE_LEAF;
    this.pager.write(rootPage, empty);

    this.tables.set(key, { name: statement.name, columns: statement.columns, rootPage });
    this.rowsByTable.set(key, []);
    return emptyResult();
  }

  private executeInsert(statement: InsertStatement): QueryResult {
    const table = this.requireTable(statement.table);
    const rows = this.requireRows(statement.table);
    const columnNames = statement.columns ?? table.columns.map((column) => column.name);

    const indices: number[] = [];
    for (const name of columnNames) {
      const index = this.columnIndex(table, name);
      if (indices.includes(index)) throw new SqlError(`column ${name} specified more than once`);
      indices.push(index);
    }

    const primaryKeyIndex = table.columns.findIndex(
      (column) => column.primaryKey && column.type === 'INTEGER',
    );

    let inserted = 0;
    for (const expressionRow of statement.rows) {
      if (expressionRow.length !== indices.length) {
        throw new SqlError(
          `${indices.length} columns were named but ${expressionRow.length} values were supplied`,
        );
      }

      const values: SqlValue[] = table.columns.map((column, index) => {
        const position = indices.indexOf(index);
        if (position >= 0) {
          const expression = expressionRow[position];
          return coerceToColumnType(
            expression === undefined ? null : evaluate(expression, EMPTY_SCOPE),
            column.type,
          );
        }
        if (column.defaultValue !== null) {
          return coerceToColumnType(evaluate(column.defaultValue, EMPTY_SCOPE), column.type);
        }
        return null;
      });

      table.columns.forEach((column, index) => {
        if (column.notNull && values[index] === null) {
          throw new SqlError(`NOT NULL constraint failed: ${table.name}.${column.name}`);
        }
      });

      let rowid: bigint;
      if (primaryKeyIndex >= 0) {
        const provided = values[primaryKeyIndex] ?? null;
        if (typeof provided === 'bigint') {
          rowid = provided;
        } else {
          rowid = this.nextRowid(rows);
          values[primaryKeyIndex] = rowid;
        }
        if (rows.some((row) => row.rowid === rowid)) {
          throw new SqlError(`UNIQUE constraint failed: ${table.name} (rowid ${rowid})`);
        }
      } else {
        rowid = this.nextRowid(rows);
      }

      rows.push({ rowid, values });
      inserted += 1;
    }

    this.persist(table);
    return { columns: [], rows: [], rowsAffected: inserted };
  }

  private executeSelect(statement: SelectStatement): QueryResult {
    const table = this.requireTable(statement.table);
    const rows = this.requireRows(statement.table);

    const candidates: { scope: RowScope; sortKeys: SqlValue[] }[] = [];
    for (const row of rows) {
      const scope = new TableRowScope(table, row);
      if (statement.where !== undefined && !isTruthy(evaluate(statement.where, scope))) continue;
      candidates.push({
        scope,
        sortKeys: statement.orderBy.map((term) => evaluate(term.expression, scope)),
      });
    }

    if (statement.orderBy.length > 0) {
      candidates.sort((left, right) => {
        for (let index = 0; index < statement.orderBy.length; index += 1) {
          const term = statement.orderBy[index];
          if (term === undefined) continue;
          const comparison = compareValues(
            left.sortKeys[index] ?? null,
            right.sortKeys[index] ?? null,
          );
          if (comparison !== 0) return term.descending ? -comparison : comparison;
        }
        return 0;
      });
    }

    let window = candidates;
    if (statement.offset !== undefined) {
      const offset = Math.max(0, Number(toInteger(evaluate(statement.offset, EMPTY_SCOPE))));
      window = window.slice(offset);
    }
    if (statement.limit !== undefined) {
      const limit = Math.max(0, Number(toInteger(evaluate(statement.limit, EMPTY_SCOPE))));
      window = window.slice(0, limit);
    }

    const columns: string[] = [];
    for (const item of statement.projections) {
      if (item.kind === 'star') {
        for (const column of table.columns) columns.push(column.name);
      } else {
        columns.push(item.alias ?? describeExpr(item.expression));
      }
    }

    const projected: SqlValue[][] = [];
    for (const candidate of window) {
      const values: SqlValue[] = [];
      for (const item of statement.projections) {
        if (item.kind === 'star') {
          for (const column of table.columns) values.push(candidate.scope.get(column.name));
        } else {
          values.push(evaluate(item.expression, candidate.scope));
        }
      }
      projected.push(values);
    }

    return { columns, rows: projected, rowsAffected: 0 };
  }

  private executeDelete(statement: DeleteStatement): QueryResult {
    const table = this.requireTable(statement.table);
    const rows = this.requireRows(statement.table);
    let removed = 0;
    for (let index = rows.length - 1; index >= 0; index -= 1) {
      const row = rows[index];
      if (row === undefined) continue;
      const scope = new TableRowScope(table, row);
      if (statement.where === undefined || isTruthy(evaluate(statement.where, scope))) {
        rows.splice(index, 1);
        removed += 1;
      }
    }
    this.persist(table);
    return { columns: [], rows: [], rowsAffected: removed };
  }

  private executeUpdate(statement: UpdateStatement): QueryResult {
    const table = this.requireTable(statement.table);
    const rows = this.requireRows(statement.table);
    const targets = statement.assignments.map((assignment) => ({
      index: this.columnIndex(table, assignment.column),
      value: assignment.value,
    }));

    let updated = 0;
    for (const row of rows) {
      const scope = new TableRowScope(table, row);
      if (statement.where !== undefined && !isTruthy(evaluate(statement.where, scope))) continue;
      for (const target of targets) {
        const column = table.columns[target.index];
        if (column === undefined) continue;
        const value = coerceToColumnType(evaluate(target.value, scope), column.type);
        if (column.notNull && value === null) {
          throw new SqlError(`NOT NULL constraint failed: ${table.name}.${column.name}`);
        }
        row.values[target.index] = value;
      }
      updated += 1;
    }

    this.persist(table);
    return { columns: [], rows: [], rowsAffected: updated };
  }

  private executeDropTable(statement: DropTableStatement): QueryResult {
    const key = statement.name.toLowerCase();
    if (!this.tables.has(key)) {
      if (statement.ifExists) return emptyResult();
      throw new SqlError(`no such table: ${statement.name}`);
    }
    this.tables.delete(key);
    this.rowsByTable.delete(key);
    return emptyResult();
  }
}

// ===========================================================================
// Demo
// ===========================================================================

function assert(condition: boolean, message: string): void {
  if (!condition) throw new Error(`assertion failed: ${message}`);
}

function pad(text: string, width: number): string {
  return text.length >= width ? text : text + ' '.repeat(width - text.length);
}

/** Exercise the encodings and a few statements end to end. */
export function runDemo(): void {
  console.log('— varints —');
  for (const sample of [0n, 1n, 127n, 128n, 16383n, 16384n, 2n ** 40n, 2n ** 63n, -1n]) {
    const encoded = encodeVarint(sample);
    const decoded = decodeVarint(encoded, 0);
    assert(decoded.value === BigInt.asUintN(64, sample), `varint round-trip for ${sample}`);
    assert(decoded.length === encoded.length, `varint length for ${sample}`);
    console.log(`  ${pad(sample.toString(), 22)} -> ${encoded.length} byte(s)`);
  }

  console.log('\n— records —');
  const record = encodeRecord([42n, 'hello', 3.5, null, new Uint8Array([0xde, 0xad])]);
  const decodedRecord = decodeRecord(record);
  assert(decodedRecord.length === 5, 'record column count');
  assert(compareValues(decodedRecord[0] ?? null, 42n) === 0, 'record integer');
  assert(compareValues(decodedRecord[1] ?? null, 'hello') === 0, 'record text');
  console.log(`  5 columns encoded into ${record.length} bytes`);

  console.log('\n— sql —');
  const database = Database.open();
  database.exec(`
    CREATE TABLE users (
      id    INTEGER PRIMARY KEY,
      name  TEXT NOT NULL,
      score REAL
    );
    INSERT INTO users (id, name, score) VALUES
      (1, 'Ada',   9.5),
      (2, 'Grace', 10.0),
      (3, 'Linus', NULL);
  `);

  const result = database.query(`
    SELECT id, name, score
    FROM users
    WHERE score >= 9.5
    ORDER BY name DESC
    LIMIT 10
  `);
  console.log(`  ${result.columns.map((column) => pad(column, 8)).join('')}`);
  for (const row of result.rows) {
    console.log(`  ${row.map((value) => pad(toSqlString(value), 8)).join('')}`);
  }

  database.exec("UPDATE users SET score = 9.9 WHERE name = 'Linus'");
  database.exec('DELETE FROM users WHERE id = 1');

  console.log('\n— storage image —');
  console.log(`  root page ${database.catalog.get('users')?.rootPage ?? '?'}`);
  for (const row of database.readStorage('users')) {
    console.log(`  rowid ${row.rowid}: ${row.values.map(toSqlString).join(' | ')}`);
  }
  console.log(`  header page size: ${database.header.pageSize}`);
}

const invokedDirectly =
  typeof process !== 'undefined' &&
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(process.argv[1]).href;

if (invokedDirectly) runDemo();
