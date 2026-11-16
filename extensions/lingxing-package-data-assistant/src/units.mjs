export const PACKAGE_FIELDS = ['length', 'width', 'height', 'weight'];
export const PACKAGE_UNITS = ['cm', 'cm', 'cm', 'g'];
const UNIT_FACTORS = {
  cm: ['length', '1'], mm: ['length', '0.1'], m: ['length', '100'],
  centimeter: ['length', '1'], centimeters: ['length', '1'], centimetre: ['length', '1'], centimetres: ['length', '1'],
  millimeter: ['length', '0.1'], millimeters: ['length', '0.1'], millimetre: ['length', '0.1'], millimetres: ['length', '0.1'],
  meter: ['length', '100'], meters: ['length', '100'], metre: ['length', '100'], metres: ['length', '100'],
  in: ['length', '2.54'], inch: ['length', '2.54'], inches: ['length', '2.54'],
  g: ['weight', '1'], gram: ['weight', '1'], grams: ['weight', '1'],
  kg: ['weight', '1000'], kilogram: ['weight', '1000'], kilograms: ['weight', '1000'],
  lb: ['weight', '453.59237'], lbs: ['weight', '453.59237'], pound: ['weight', '453.59237'], pounds: ['weight', '453.59237'],
  oz: ['weight', '28.349523125'], ounce: ['weight', '28.349523125'], ounces: ['weight', '28.349523125']
};
export function decimalParts(value, { allowZero = true } = {}) {
  const text = String(value ?? '').trim();
  if (!/^\d{1,12}(?:\.\d{1,12})?$/.test(text)) throw new Error('请输入有效的十进制数值');
  const [whole, fraction = ''] = text.split('.');
  const numerator = BigInt(whole + fraction), denominator = 10n ** BigInt(fraction.length);
  if (!allowZero && numerator === 0n) throw new Error('尺寸和重量必须大于 0');
  return { numerator, denominator };
}
function roundRatio(numerator, denominator, places) {
  const scale = 10n ** BigInt(places);
  const scaled = numerator * scale;
  const rounded = scaled / denominator + (scaled % denominator * 2n >= denominator ? 1n : 0n);
  const s = rounded.toString().padStart(places + 1, '0');
  return places ? s.slice(0, -places) + '.' + s.slice(-places) : s;
}
export function canonicalUnit(unit) { return String(unit ?? '').trim().toLowerCase().replace(/\.$/, ''); }
export function convertValue(value, unit, kind, places) {
  const source = decimalParts(value, { allowZero: false });
  const factor = UNIT_FACTORS[canonicalUnit(unit)];
  if (!factor || factor[0] !== kind) throw new Error('无法识别' + (kind === 'weight' ? '重量' : '尺寸') + '单位：' + String(unit || '空'));
  const f = decimalParts(factor[1]);
  const result = roundRatio(source.numerator * f.numerator, source.denominator * f.denominator, places);
  if (Number(result) <= 0 || Number(result) > 100000000) throw new Error('换算后的数值超出可维护范围');
  return result;
}
export function normalizePackage(raw, dimensionUnit, weightUnit) {
  if (!Array.isArray(raw) || raw.length !== 4) throw new Error('需要一组完整的包装三边和重量');
  const dimensions = raw.slice(0, 3).map(v => convertValue(v, dimensionUnit, 'length', 2));
  if (Number(dimensions[0]) < Number(dimensions[1]) || Number(dimensions[1]) < Number(dimensions[2])) throw new Error('报表的长边、中边、短边顺序不正确');
  return [...dimensions, convertValue(raw[3], weightUnit, 'weight', 4)];
}
export function compareDecimal(a, b) {
  const x = decimalParts(a), y = decimalParts(b), difference = x.numerator * y.denominator - y.numerator * x.denominator;
  return difference === 0n ? 0 : difference < 0n ? -1 : 1;
}
export function samePackage(a, b) {
  return Array.isArray(a) && Array.isArray(b) && a.length === 4 && b.length === 4 && a.every((v, i) => compareDecimal(v, b[i]) === 0);
}
export function emptyPackage(values) { return Array.isArray(values) && values.length === 4 && values.every(v => String(v ?? '').trim() === '' || /^0+(?:\.0+)?$/.test(String(v))); }
