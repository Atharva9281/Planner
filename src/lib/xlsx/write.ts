import { strToU8, zipSync } from 'fflate';

/**
 * A very small .xlsx writer.
 *
 * An .xlsx is a zip of XML, and fflate already zips, so this builds the handful of parts Excel
 * insists on rather than pulling in a spreadsheet library for one download. It writes exactly what
 * this app needs: text, numbers, and three number formats.
 *
 * Strings are written inline rather than through a shared-string table. That costs a few bytes on
 * a file of this size and removes a whole part, plus the index bookkeeping that goes with it.
 */

/** The formats a cell can carry. `text` is also the fallback for anything non-numeric. */
export type CellFormat = 'text' | 'number' | 'money' | 'percent' | 'header';

export interface Cell {
  value: string | number | null | undefined;
  format?: CellFormat;
}

export interface SheetSpec {
  name: string;
  /** Column widths in characters. Excel needs these up front or everything is 8.43 wide. */
  columns?: number[];
  rows: Cell[][];
}

/** Style indexes, in the same order they are written into cellXfs below. */
const STYLE: Record<CellFormat, number> = {
  text: 0,
  header: 1,
  money: 2,
  number: 3,
  percent: 4,
};

const esc = (s: string) =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    // Excel rejects control characters outright, so they never reach the file. Tab, newline
    // and carriage return are the three XML 1.0 allows, and those are left alone.
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, '');

/** 0 -> "A", 26 -> "AA". */
export function columnName(index: number): string {
  let n = index + 1;
  let out = '';
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

/** Sheet names cannot carry : \ / ? * [ ] and cap at 31 characters. */
export function safeSheetName(name: string): string {
  const cleaned = name.replace(/[:\\/?*[\]]/g, ' ').trim();
  return (cleaned || 'Sheet1').slice(0, 31);
}

function cellXml(cell: Cell, ref: string): string {
  const style = STYLE[cell.format ?? 'text'];
  const s = style ? ` s="${style}"` : '';

  if (cell.value === null || cell.value === undefined || cell.value === '') {
    // An empty cell still has to exist when it carries a style, or the row loses its shape.
    return style ? `<c r="${ref}"${s}/>` : '';
  }

  if (typeof cell.value === 'number' && Number.isFinite(cell.value)) {
    return `<c r="${ref}"${s}><v>${cell.value}</v></c>`;
  }

  return `<c r="${ref}"${s} t="inlineStr"><is><t xml:space="preserve">${esc(
    String(cell.value),
  )}</t></is></c>`;
}

function sheetXml(sheet: SheetSpec): string {
  const cols = sheet.columns?.length
    ? `<cols>${sheet.columns
        .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`)
        .join('')}</cols>`
    : '';

  const rows = sheet.rows
    .map((row, r) => {
      const cells = row.map((c, i) => cellXml(c, `${columnName(i)}${r + 1}`)).join('');
      return `<row r="${r + 1}">${cells}</row>`;
    })
    .join('');

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${cols}<sheetData>${rows}</sheetData></worksheet>`;
}

/* The custom formats. 166 keeps a percentage as the number it reads as — 6.751 stays 6.751 and
   simply displays a % sign — so the column still sorts and sums like a number. */
const STYLES_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3">
<numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/>
<numFmt numFmtId="165" formatCode="#,##0"/>
<numFmt numFmtId="166" formatCode="0.000&quot;%&quot;"/>
</numFmts>
<fonts count="2">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>
</fonts>
<fills count="3">
<fill><patternFill patternType="none"/></fill>
<fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FF1F2E52"/><bgColor indexed="64"/></patternFill></fill>
</fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="5">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
<dxfs count="0"/>
<tableStyles count="0" defaultTableStyle="TableStyleMedium2" defaultPivotStyle="PivotStyleLight16"/>
</styleSheet>`;

/** Builds the whole workbook as bytes, ready to hand to a download. */
export function buildXlsx(sheets: SheetSpec[]): Uint8Array {
  const names = sheets.map((s) => safeSheetName(s.name));

  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${sheets
  .map(
    (_, i) =>
      `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`,
  )
  .join('\n')}
</Types>`;

  const rootRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets>${names
    .map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
    .join('')}</sheets>
</workbook>`;

  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
${sheets
  .map(
    (_, i) =>
      `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`,
  )
  .join('\n')}
<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
</Relationships>`;

  const files: Record<string, Uint8Array> = {
    '[Content_Types].xml': strToU8(contentTypes),
    '_rels/.rels': strToU8(rootRels),
    'xl/workbook.xml': strToU8(workbook),
    'xl/_rels/workbook.xml.rels': strToU8(workbookRels),
    'xl/styles.xml': strToU8(STYLES_XML),
  };
  sheets.forEach((s, i) => {
    files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s));
  });

  return zipSync(files, { level: 6 });
}
