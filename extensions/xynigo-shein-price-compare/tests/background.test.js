'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

test('toolbar action sends only the open-details command to the clicked tab and tolerates unsupported pages', async () => {
    let clicked;
    const messages = [];
    const chrome = {
        action: { onClicked: { addListener: (callback) => { clicked = callback; } } },
        tabs: { sendMessage: async (tabId, message) => { messages.push([tabId, message.type]); throw new Error('No receiver'); } },
    };
    vm.runInNewContext(fs.readFileSync(path.join(__dirname, '../background.js'), 'utf8'), { chrome });
    clicked({ id: 42 }); clicked({});
    await new Promise(setImmediate);
    assert.deepEqual(messages, [[42, 'XYNIGO_PRICE_COMPARE_OPEN_DETAILS']]);
    const manifest = JSON.parse(fs.readFileSync(path.join(__dirname, '../manifest.json'), 'utf8'));
    assert.equal(manifest.background.service_worker, 'background.js');
    assert.equal(manifest.action.default_popup, undefined);
    assert.equal(manifest.permissions, undefined);
});
