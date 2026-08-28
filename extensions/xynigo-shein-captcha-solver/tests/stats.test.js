'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

global.XynigoCaptchaStats = require('../src/stats.js');

const Stats = global.XynigoCaptchaStats;

function record(overrides) {
    return Object.assign({
        ts: 1, puzzleId: 'p1', role: 'primary', provider: 'zhipu', model: 'glm-4v-flash',
        latencyMs: 100, answer: [1], outcome: 'pass', error: '',
    }, overrides);
}

test('appendTrim keeps the newest records within the cap', () => {
    const list = [];
    for (let index = 1; index <= 5; index += 1) {
        const next = Stats.appendTrim(list, { index }, 3);
        list.length = 0;
        list.push.apply(list, next);
    }
    assert.deepEqual(list.map((item) => item.index), [3, 4, 5]);
});

test('aggregateSolves reports pass rate and latency per model, ignoring shadow records', () => {
    const rows = Stats.aggregateSolves([
        record({ latencyMs: 1000, outcome: 'pass' }),
        record({ latencyMs: 2000, outcome: 'pass' }),
        record({ outcome: 'fail' }),
        record({ outcome: 'error' }),
        record({ role: 'shadow', model: 'glm-4.6v-flash', outcome: 'pass' }),
    ]);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].model, 'zhipu/glm-4v-flash');
    assert.equal(rows[0].attempts, 4);
    assert.equal(rows[0].pass, 2);
    assert.equal(rows[0].fail, 1);
    assert.equal(rows[0].error, 1);
    assert.equal(rows[0].passRate, 50);
    assert.equal(rows[0].avgLatencyMs, 1500);
});

test('pairCompare measures answer agreement between primary and shadow models', () => {
    const pair = Stats.pairCompare([
        record({ puzzleId: 'a', answer: [1, 2], outcome: 'pass' }),
        record({ puzzleId: 'a', role: 'shadow', model: 'm2', answer: [1, 2] }),
        record({ puzzleId: 'b', answer: [3], outcome: 'fail' }),
        record({ puzzleId: 'b', role: 'shadow', model: 'm2', answer: [3, 4] }),
    ]);
    assert.equal(pair.pairs, 2);
    assert.equal(pair.agree, 1);
    assert.equal(pair.disagree, 1);
    assert.equal(pair.agreeRate, 50);
    assert.equal(pair.primaryPassRate, 50);
    assert.equal(Stats.pairCompare([]).pairs, 0);
});

test('scoreReplay scores stored samples against ground truth', () => {
    Stats.setScoreAnswer(require('../src/puzzle.js').scoreAnswer);
    const summary = Stats.scoreReplay([
        { sample: { id: 's1', groundTruth: [1, 2] }, result: { ok: true, answer: [1, 2], latencyMs: 900 } },
        { sample: { id: 's2', groundTruth: [3] }, result: { ok: true, answer: [3, 4], latencyMs: 1100 } },
        { sample: { id: 's3', groundTruth: [5] }, result: { ok: false, answer: [], latencyMs: 0, error: 'HTTP 401' } },
    ]);
    assert.equal(summary.n, 3);
    assert.equal(summary.exactCount, 1);
    assert.equal(summary.exactRate, 33.3);
    assert.equal(summary.rows[2].ok, false);
    assert.equal(summary.avgLatencyMs, 1000);
});
