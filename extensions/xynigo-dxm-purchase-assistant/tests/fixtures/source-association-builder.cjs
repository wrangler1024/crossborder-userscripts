'use strict';
const Core = require('../../src/core.js');

function fixture() {
  const order = { storeName: '合成店-合成运营（一组）', platformOrderNo: 'GSHSYNTH9001',
    packageId: 'XMWUSYNTH9001', salesCurrency: 'MXN', salesAmount: 350,
    recipientName: 'Synthetic Recipient', recipientPhone: '5550100000', addressLine1: '100 Example Road',
    city: 'Example City', stateProvince: 'Example State', postalCode: '00000' };
  const sales = [
    { sku: 'SYNTH-A', variant: 'Black-M', quantity: 1, unitPrice: 150, image: 'https://img.ltwebstatic.com/test/a.jpg' },
    { sku: 'SYNTH-B', variant: 'White-L', quantity: 2, unitPrice: 100, image: 'https://img.ltwebstatic.com/test/b.jpg' },
  ];
  const products = Core.attachSalesSources(Core.extractProductRows(sales.map((row) => {
    const text = `${row.sku} x ${row.quantity} MXN ${row.unitPrice} YDB--87654321-181：${row.variant}`;
    return { rowText: text, cellTexts: [text], productImageUrl: row.image };
  })), order);
  const purchase = (product, sku) => ({ ...product, sourceRef: { ...product.sourceRef }, mainSpec: 'Multicolor', subSpec: 'Set',
    guidePrice: 10, purchaseCurrency: 'MXN',
    purchaseLink: `https://www.shein.com.mx/x-p-76543210.html?goods_id=76543210&skucode=${sku}#xv=1&p=Multicolor&s=Set&gp=10&c=MXN` });
  const a = purchase(products[0], 'BUY-A'), b = purchase(products[1], 'BUY-B');
  const split = { ...purchase(products[0], 'BUY-SPLIT'), sellerSku: '手工明细-1', source: 'manual-added', purchaseQty: 3, sourceAmountOwner: false };
  const extra = { ...purchase(products[0], 'BUY-EXTRA'), sellerSku: '手工明细-2', source: 'manual-added' };
  const items = [b, a, split, extra];
  Core.setSalesSource(items, extra, null, order, 'extra');
  const draft = Core.createValidatedPurchaseDraft(order, items, '2026-09-09T10:00:00.000Z');
  const remark = Core.createXyp2Remark(draft);
  if (!remark.ok) throw new Error(remark.reason);
  return { order, sales, products, draft, remark: remark.text };
}
module.exports = fixture;
if (require.main === module) process.stdout.write(JSON.stringify(fixture(), null, 2) + '\n');
