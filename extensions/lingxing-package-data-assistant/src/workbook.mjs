export const UPDATE_COLUMNS = ['*SKU', '单品毛重', '单品毛重单位', '包装规格长', '包装规格宽', '包装规格高', '包装规格单位'];
export const UPDATE_GROUPS = ['cg_product_gross_weight', 'cg_package'];
export const TEMPLATE_SHEET = '产品';
// Headers checked against the native SKU update template. No company dictionary or example data is bundled.
export function updateWorkbook(XLSX, intents) {
  if (!Array.isArray(intents) || !intents.length || intents.length > 500) throw new Error('请选择 1–500 个商品');
  const seen = new Set();
  const data = intents.map(row => {
    if (!row.localSku || seen.has(row.localSku)) throw new Error('更新商品中存在空白或重复的本地 SKU');
    if (!row.boxId || !Array.isArray(row.values) || row.values.length !== 4 || row.values.some(v => !/^\d+(?:\.\d+)?$/.test(String(v)) || Number(v) <= 0)) throw new Error('更新数据不完整');
    seen.add(row.localSku);
    const [length, width, height, weight] = row.values.map(Number);
    return [row.localSku, weight, 'g', length, width, height, 'cm'];
  });
  const book = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([UPDATE_COLUMNS, ...data]);
  for (let r = 1; r <= data.length; r++) sheet['A' + (r + 1)] = { t: 's', v: data[r - 1][0] };
  sheet['!cols'] = [{ wch: 34 }, { wch: 16 }, { wch: 17 }, { wch: 17 }, { wch: 17 }, { wch: 17 }, { wch: 17 }];
  XLSX.utils.book_append_sheet(book, sheet, TEMPLATE_SHEET);
  book.Props = { Title: '销售包装资料更新', Comments: '仅维护默认箱规的包装三边与单品毛重' };
  return XLSX.write(book, { type: 'array', bookType: 'xlsx', compression: true });
}
export function csvText(rows) {
  const cell = value => {
    let s = String(value ?? '');
    if (/^[=+@-]/.test(s) && !/^-?\d+(?:\.\d+)?$/.test(s)) s = "'" + s;
    return '"' + s.replaceAll('"', '""') + '"';
  };
  return '\uFEFF' + rows.map(row => row.map(cell).join(',')).join('\r\n');
}
export function saveBlob(win, content, filename, mime) {
  const blob = content instanceof win.Blob ? content : new win.Blob([content], { type: mime });
  const url = win.URL.createObjectURL(blob), anchor = win.document.createElement('a');
  anchor.href = url; anchor.download = filename; anchor.click();
  win.setTimeout(() => win.URL.revokeObjectURL(url), 1000);
}
