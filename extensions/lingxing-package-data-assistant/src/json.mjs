// Preserve identifiers which the ERP sometimes serializes as unquoted 64-bit integers.
export function parseERPJSON(text) {
  let output = '', quoted = false, escaped = false;
  for (let i = 0; i < text.length;) {
    const c = text[i];
    if (quoted) {
      output += c; i++;
      if (escaped) escaped = false;
      else if (c === '\\') escaped = true;
      else if (c === '"') quoted = false;
    } else if (c === '"') { quoted = true; output += c; i++; }
    else if (c === '-' || /\d/.test(c)) {
      const match = text.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/);
      if (!match) { output += c; i++; continue; }
      const token = match[0];
      output += /^-?\d+$/.test(token) && !Number.isSafeInteger(Number(token)) ? JSON.stringify(token) : token;
      i += token.length;
    } else { output += c; i++; }
  }
  return JSON.parse(output);
}
export function exactId(value, label = '编号') {
  if (typeof value === 'number' && !Number.isSafeInteger(value)) throw new Error(label + '已丢失精度，请重新读取');
  const id = String(value ?? '');
  if (!/^\d+$/.test(id) || /^0+$/.test(id)) throw new Error(label + '为空或无效');
  return id;
}
