import { normalizePackage } from './units.mjs';
export const REPORT_SOURCE = '亚马逊费用预估';
export const MAX_REPORT_ROWS = 500;
const REQUIRED = ['sku', 'asin', 'longest-side', 'median-side', 'shortest-side', 'unit-of-dimension', 'unit-of-weight'];
export function parseDelimited(text, delimiter) {
  const rows = []; let row = [], field = '', quoted = false, closed = false, line = 1, startLine = 1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (c === '"') { quoted = false; closed = true; }
      else { field += c; if (c === '\n') line++; }
    } else if (c === '"') {
      if (field || closed) throw new Error('第 ' + line + ' 行引号位置不正确');
      quoted = true;
    } else if (c === delimiter) { row.push(field); field = ''; closed = false; }
    else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field); rows.push({ cells: row, line: startLine }); row = []; field = ''; closed = false; line++; startLine = line;
    } else if (closed && !/\s/.test(c)) throw new Error('第 ' + line + ' 行引号后存在多余字符');
    else if (!closed) field += c;
  }
  if (quoted) throw new Error('第 ' + startLine + ' 行引号未闭合');
  if (field || row.length || closed) { row.push(field); rows.push({ cells: row, line: startLine }); }
  return rows.filter(r => r.cells.some(v => String(v).trim() !== ''));
}
export function detectDelimiter(text) {
  const first = text.replace(/^\uFEFF/, '').split(/\r?\n/)[0];
  return ['\t', ',', ';'].map(d => ({ d, n: first.split(d).map(s => s.trim().replace(/^"|"$/g, '').toLowerCase()).filter(h => REQUIRED.includes(h)).length })).sort((a, b) => b.n - a.n)[0].d;
}
function normalizedHeader(value) { return String(value).replace(/^\uFEFF/, '').trim().toLowerCase(); }
export function reportFromRows(input, metadata = {}) {
  if (input.length < 2) throw new Error('报表缺少表头或商品行');
  const headers = input[0].cells.map(normalizedHeader);
  const nonempty = headers.filter(Boolean);
  if (new Set(nonempty).size !== nonempty.length) throw new Error('报表存在重复表头，请使用亚马逊原始报告');
  const missing = REQUIRED.filter(h => !headers.includes(h));
  const weightFields = ['item-package-weight', 'item-weight'].filter(h => headers.includes(h));
  if (!weightFields.length) missing.push('item-package-weight / item-weight');
  if (missing.length) throw new Error('缺少报表字段：' + missing.join('、'));
  if (input.length - 1 > MAX_REPORT_ROWS) throw new Error('首版每批最多 ' + MAX_REPORT_ROWS + ' 条，请分批导入');
  const index = Object.fromEntries(headers.map((h, i) => [h, i]));
  const records = input.slice(1).map(row => {
    const get = key => String(row.cells[index[key]] ?? '');
    const record = { key: 'line-' + row.line, line: row.line, msku: get('sku'), asin: get('asin'), fnsku: get('fnsku'), market: get('amazon-store'), title: get('product-name'), raw: [get('longest-side'), get('median-side'), get('shortest-side'), get(weightFields[0])], dimensionUnit: get('unit-of-dimension'), weightUnit: get('unit-of-weight'), values: null, errors: [] };
    if (row.cells.length !== headers.length) record.errors.push('列数与表头不一致');
    if (!record.msku || record.msku !== record.msku.trim() || /^[+-]?\d+(?:\.\d+)?e[+-]?\d+$/i.test(record.msku)) record.errors.push('MSKU 为空、存在首尾空格或疑似被科学计数法改写');
    if (row.numericIdentity) record.errors.push('SKU / ASIN / FNSKU 被保存为数字，请改用亚马逊原始 TXT / CSV');
    if (!/^[A-Z0-9]{10}$/.test(record.asin)) record.errors.push('ASIN 为空或格式无效');
    if (record.fnsku && !/^[A-Z0-9]{10}$/.test(record.fnsku)) record.errors.push('FNSKU 格式无效');
    try {
      record.values = normalizePackage(record.raw, record.dimensionUnit, record.weightUnit);
      if (weightFields.length === 2 && get(weightFields[1]) !== get(weightFields[0])) record.errors.push('两列重量字段数值不同，请核对来源');
    } catch (error) { record.errors.push(error.message); }
    return record;
  });
  return { source: REPORT_SOURCE, headers, weightField: weightFields[0], ...metadata, rows: records };
}
export function parseReportText(text, metadata = {}) {
  if (typeof text !== 'string' || text.includes('\uFFFD')) throw new Error('报告编码无法识别，请使用 UTF-8 原始文件');
  text = text.replace(/^\uFEFF/, '');
  // Some CSV exports replace the original BOM with a literal question mark.
  // Remove only that marker before an exact, quoted SKU header, never SKU data.
  const headerPrefixRemoved = /^\?(?="sku"[,;\t])/i.test(text);
  if (headerPrefixRemoved) text = text.slice(1);
  const delimiter = detectDelimiter(text);
  return reportFromRows(parseDelimited(text, delimiter), { ...metadata, delimiter, headerPrefixRemoved });
}
export function parseReportBytes(bytes, metadata = {}) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  const bomEncoding = b[0] === 0xff && b[1] === 0xfe ? 'utf-16le' : b[0] === 0xfe && b[1] === 0xff ? 'utf-16be' : b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf ? 'utf-8' : null;
  let encoding = bomEncoding || 'utf-8', text;
  try { text = new TextDecoder(encoding, { fatal: true }).decode(b); }
  catch {
    // An explicit Unicode BOM must not be ignored to hide a damaged file.
    if (bomEncoding) throw new Error('文件编码损坏，请重新导出原始报告或另存为 UTF-8 CSV');
    encoding = 'windows-1252';
    text = new TextDecoder(encoding, { fatal: true }).decode(b);
  }
  if (/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/.test(text)) throw new Error('文件编码无法识别，请另存为 UTF-8 CSV 后导入');
  const report = parseReportText(text, { ...metadata, encoding });
  // Legacy encodings can be ambiguous. Never guess non-ASCII matching keys.
  if (encoding === 'windows-1252' && report.rows.some(row => [row.msku, row.asin, row.fnsku].some(value => /[^\x20-\x7e]/.test(value)))) throw new Error('非 UTF-8 文件的 SKU / ASIN / FNSKU 含特殊字符，请另存为 UTF-8 CSV 后导入');
  return report;
}
export function parseReportWorkbook(XLSX, bytes, metadata = {}) {
  const book = XLSX.read(bytes, { type: 'array', cellFormula: true, raw: true });
  if (book.SheetNames.length !== 1) throw new Error('报表应只有一个数据工作表，请改用原始 TXT / CSV');
  const sheet = book.Sheets[book.SheetNames[0]], range = XLSX.utils.decode_range(sheet['!ref'] || 'A1');
  if (range.e.r > MAX_REPORT_ROWS + 1 || range.e.c > 200) throw new Error('报表行列数超出范围');
  const headers = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '', raw: true });
  const identityColumns = (headers[0] || []).flatMap((h, i) => ['sku', 'asin', 'fnsku'].includes(normalizedHeader(h)) ? [i] : []);
  const input = headers.map((cells, i) => ({ cells: Array.from({ length: headers[0].length }, (_, j) => cells[j] ?? ''), line: i + 1, numericIdentity: i > 0 && identityColumns.some(c => sheet[XLSX.utils.encode_cell({ r: i, c })]?.t === 'n') }));
  for (const key of Object.keys(sheet)) if (!key.startsWith('!') && sheet[key]?.f) throw new Error('报表包含公式，请改用亚马逊原始 TXT / CSV');
  return reportFromRows(input.filter(r => r.cells.some(v => String(v).trim())), metadata);
}
