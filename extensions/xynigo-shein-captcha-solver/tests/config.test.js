'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

global.XynigoCaptchaConfig = require('../src/config.js');

const Config = global.XynigoCaptchaConfig;

test('normalizeConfig falls back to zhipu defaults on empty input', () => {
    const config = Config.normalizeConfig({});
    assert.equal(config.provider, 'zhipu');
    assert.equal(config.baseUrl, 'https://open.bigmodel.cn/api/paas/v4');
    assert.equal(config.model, 'glm-4v-flash');
    assert.equal(config.apiKey, '');
    assert.equal(config.autoSolve, true);
    assert.equal(config.maxRounds, 3);
    assert.equal(config.compareEnabled, false);
    assert.equal(config.collectSamples, true);
    assert.equal(config.maxSamples, 50);
});

test('normalizeConfig adopts preset baseUrl when the form leaves it empty', () => {
    const config = Config.normalizeConfig({ provider: 'doubao', model: 'doubao-seed-1.8', apiKey: 'k' });
    assert.equal(config.baseUrl, 'https://ark.cn-beijing.volces.com/api/v3');
    const custom = Config.normalizeConfig({ provider: 'custom', baseUrl: 'https://example.com/v1', model: 'm', apiKey: 'k' });
    assert.equal(custom.baseUrl, 'https://example.com/v1');
});

test('normalizeConfig rejects unknown providers and clamps numeric fields', () => {
    const config = Config.normalizeConfig({ provider: 'evil', maxRounds: 99, settleTimeoutMs: 1, maxSamples: 9999 });
    assert.equal(config.provider, 'zhipu');
    assert.equal(config.maxRounds, 5);
    assert.equal(config.settleTimeoutMs, 3000);
    assert.equal(config.maxSamples, 200);
});

test('boolean strings coerce and compare key falls back to the primary key', () => {
    const config = Config.normalizeConfig({
        compareEnabled: 'true',
        compareProvider: 'zhipu',
        compareModel: 'glm-4.6v-flash',
        apiKey: 'primary-key',
        autoSolve: 'false',
    });
    assert.equal(config.compareEnabled, true);
    assert.equal(config.autoSolve, false);
    const compare = Config.effectiveCompareConfig(config);
    assert.equal(compare.apiKey, 'primary-key');
    assert.equal(compare.model, 'glm-4.6v-flash');
});
