import {parseRows,HEADERS,MODEL_VERSION} from './model.mjs';
import {finalPreviewPlans} from './preview.mjs';
export const MAX_FILE_BYTES=5*1024*1024;
export function readWorkbook(XLSX,bytes,name='input.xlsx') {
  if(!/\.xlsx$/i.test(name))throw new Error('请使用.xlsx文件；其他格式请在Excel中另存为.xlsx');
  if(bytes.byteLength>MAX_FILE_BYTES)throw new Error('文件超过5MB，请拆分后导入');
  const book=XLSX.read(bytes,{type:'array',cellFormula:true,sheetRows:505,dense:false});
  if(!book.SheetNames.length)throw new Error('没有可读取的工作表');
  return book;
}
export function readSheet(XLSX,book,sheetName) {
  const sheet=book.Sheets[sheetName];if(!sheet)throw new Error('工作表不存在');
  const declared=sheet['!fullref']||sheet['!ref'];
  if(declared&&XLSX.utils.decode_range(declared).e.r>=505)throw new Error('工作表超过500款，请分批或清理多余格式行');
  const formulas=new Set();
  for(const [address,cell] of Object.entries(sheet))if(!address.startsWith('!')&&cell.f){const p=XLSX.utils.decode_cell(address);formulas.add(`${p.r}:${p.c}`)}
  const matrix=XLSX.utils.sheet_to_json(sheet,{header:1,raw:false,defval:'',blankrows:true});
  return parseRows(matrix,{sheet:sheetName,formulaCells:formulas});
}
export function templateWorkbook(XLSX) {
  const book=XLSX.utils.book_new();const sheet=XLSX.utils.aoa_to_sheet([HEADERS]);
  sheet['!cols']=[{wch:24},{wch:28},{wch:16},{wch:42},{wch:26}];
  XLSX.utils.book_append_sheet(book,sheet,'待校验商品');return book;
}
export function csvCell(v){let value=String(v??'');if(/^[=+\-@\t\r]/.test(value))value="'"+value;return '"'+value.replaceAll('"','""')+'"'}
export function previewCsv(plans){
  const rows=[['店铺','站点','MSKU','ASIN','可售库存','活动名','广告组名','币种','活动日预算','组默认价','投放类型','目标','建议下限','原始计算值','预览竞价','计价依据','来源说明','读取时间']];
  for(const p of plans)for(const c of p.campaigns)for(const g of c.groups)for(const t of g.targets)rows.push([p.shop,p.country,p.product.msku,p.product.asin,p.product.stock,c.name,g.name,c.currency,c.budget,g.defaultBid,t.type,t.value||t.label,t.lower,t.raw,t.bid,t.rule,t.note||t.source,t.quotedAt||p.fetchedAt]);
  return '\uFEFF'+rows.map(r=>r.map(csvCell).join(',')).join('\r\n');
}
export function previewDocument(records){
  return {previewOnly:true,selectionSource:'current-preview',model:MODEL_VERSION,plans:finalPreviewPlans(records),excluded:records.filter(r=>r.status==='skipped').map(r=>({row:r.row,msku:r.msku,reason:'当前预览未选择任何投放渠道'})),issues:records.filter(r=>!['ready','skipped'].includes(r.status)).map(r=>({row:r.row,sheet:r.sheet,msku:r.msku,status:r.status,issues:[...(r.issues||[]),r.error].filter(Boolean),channels:r.plan?.channels?.filter(c=>c.status==='blocked')||Object.entries(r.channelIssues||{}).filter(([,issues])=>issues.length).map(([key,issues])=>({key,status:'blocked',reason:issues.join('；')}))}))};
}
