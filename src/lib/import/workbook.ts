import { unzipSync, strFromU8 } from 'fflate';
import { SheetGrid } from './types';

/**
 * Reads .xlsx and .csv into plain grids.
 *
 * An .xlsx is a zip of XML, so this unzips it and walks the sheet XML directly rather than
 * pulling in a full spreadsheet library — the exports this reads carry only strings and numbers,
 * and the parser stays small enough to hold in your head.
 */

const MAIN = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const PKG_REL = 'http://schemas.openxmlformats.org/package/2006/relationships';
const DOC_REL = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';

/** "BQ" -> 68. Column letters are base-26 with no zero. */
export function columnIndex(ref: string): number {
  const letters = /^([A-Z]+)/.exec(ref)?.[1] ?? 'A';
  let n = 0;
  for (const ch of letters) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

const parseXml = (xml: string) => new DOMParser().parseFromString(xml, 'application/xml');

/**
 * Namespace handling differs between XML parsers, so every lookup tries the namespaced form and
 * falls back to the plain tag name. Without this the sheet list comes back empty on some engines
 * and the whole workbook reads as zero sheets.
 */
function tags(parent: Element | Document, ns: string, tag: string): Element[] {
  const found = parent.getElementsByTagNameNS(ns, tag);
  if (found.length > 0) return Array.from(found);
  return Array.from(parent.getElementsByTagName(tag));
}

const kids = (parent: Element | Document, tag: string) => tags(parent, MAIN, tag);

/** Same tolerance for a prefixed attribute such as r:id. */
const attrNS = (el: Element, ns: string, prefix: string, name: string) =>
  el.getAttributeNS(ns, name) ?? el.getAttribute(`${prefix}:${name}`) ?? el.getAttribute(name);

function sharedStrings(files: Record<string, Uint8Array>): string[] {
  const raw = files['xl/sharedStrings.xml'];
  if (!raw) return [];
  const doc = parseXml(strFromU8(raw));
  return kids(doc, 'si').map((si) =>
    kids(si, 't')
      .map((t) => t.textContent ?? '')
      .join(''),
  );
}

function sheetPaths(files: Record<string, Uint8Array>): { name: string; path: string }[] {
  const wb = parseXml(strFromU8(files['xl/workbook.xml']));
  const rels = parseXml(strFromU8(files['xl/_rels/workbook.xml.rels']));

  const targets = new Map<string, string>();
  for (const rel of tags(rels, PKG_REL, 'Relationship')) {
    targets.set(rel.getAttribute('Id') ?? '', rel.getAttribute('Target') ?? '');
  }

  return kids(wb, 'sheet').map((sheet, i) => {
    const id = attrNS(sheet, DOC_REL, 'r', 'id') ?? '';
    let path = targets.get(id) ?? '';
    // Some writers omit the relationship entirely; sheets are then positional.
    if (!path) path = `worksheets/sheet${i + 1}.xml`;
    if (!path.startsWith('xl/')) path = `xl/${path.replace(/^\/+/, '')}`;
    return { name: sheet.getAttribute('name') ?? `Sheet${i + 1}`, path };
  });
}

function readSheet(xml: string, strings: string[]): SheetGrid['rows'] {
  const doc = parseXml(xml);
  return kids(doc, 'row').map((row) => {
    const cells: SheetGrid['rows'][number] = [];
    for (const c of kids(row, 'c')) {
      const ref = c.getAttribute('r') ?? 'A1';
      const type = c.getAttribute('t');
      const v = kids(c, 'v')[0]?.textContent ?? null;

      let value: string | number | null = null;
      if (type === 's' && v !== null) {
        value = strings[Number(v)] ?? '';
      } else if (type === 'inlineStr') {
        value = kids(c, 't')
          .map((t) => t.textContent ?? '')
          .join('');
      } else if (v !== null) {
        const n = Number(v);
        value = Number.isFinite(n) && v.trim() !== '' ? n : v;
      }

      if (value !== null && value !== '') cells[columnIndex(ref)] = value;
    }
    return cells;
  });
}

/** Handles quoted fields, embedded commas and embedded newlines. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
      continue;
    }
    if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') cell += ch;
  }
  if (cell || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

export async function readWorkbook(file: File): Promise<SheetGrid[]> {
  if (/\.csv$/i.test(file.name)) {
    return [{ name: file.name, rows: parseCsv(await file.text()) }];
  }

  const files = unzipSync(new Uint8Array(await file.arrayBuffer()));
  if (!files['xl/workbook.xml']) {
    throw new Error('That does not look like an .xlsx workbook.');
  }

  const strings = sharedStrings(files);
  return sheetPaths(files)
    .filter(({ path }) => files[path])
    .map(({ name, path }) => ({ name, rows: readSheet(strFromU8(files[path]), strings) }));
}
