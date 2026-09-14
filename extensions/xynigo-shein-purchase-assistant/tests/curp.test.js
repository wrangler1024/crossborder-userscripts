'use strict';
const assert = require('node:assert/strict');
const test = require('node:test');
const core = require('../src/core.js');
const valid='TESTCURP0000000001'; // Deliberately synthetic, never a real person's identifier.
const mx={recipientName:'Lucia Prueba',recipientPhone:'+52 477 000 0001',postalCode:'36000',stateProvince:'Guanajuato',city:'Guanajuato',addressLine1:'Calle Prueba 100'};
test('CURP normalizes case and outer whitespace without inventing an identity',()=>{
 const data={...mx,curp:'  testcurp0000000001  ',curpStatus:'provided'};
 const result=core.validateRecipient(data,'MX');
 assert.equal(result.ok,true);assert.equal(result.curp.ok,true);assert.equal(result.values.curp,valid);
 assert.equal(data.curp,'  testcurp0000000001  ');
});
test('missing, unsupported, invalid and conflicting CURP leave address validation usable',()=>{
 for(const [extra,status] of [[{},'unsupported'],[{curp:'',curpStatus:'missing_column'},'missing_column'],[{curp:''},'empty'],[{curp:'BAD'},'invalid'],[{curp:valid,curpStatus:'conflict'},'conflict'],[{curp:'TEST CURP0000000001'},'invalid']]){
  const r=core.validateRecipient({...mx,...extra},'MX');assert.equal(r.ok,true);assert.equal(r.curp.ok,false);assert.equal(r.curp.status,status);assert.equal(r.values.curp,'');assert.ok(!r.curp.error.includes(valid));
 }
});
test('US ignores CURP completely and retains five-digit Postcode',()=>{
 const r=core.validateRecipient({...mx,recipientName:'Amy Smith',recipientPhone:'+1 202 555 0100',postalCode:'02108-1234',stateProvince:'MA',city:'Boston',curp:'BAD',curpStatus:'conflict'},'US');
 assert.equal(r.ok,true);assert.equal(r.values.postalCode,'02108');assert.equal('curp' in r,false);assert.equal('curp' in r.values,false);
});
