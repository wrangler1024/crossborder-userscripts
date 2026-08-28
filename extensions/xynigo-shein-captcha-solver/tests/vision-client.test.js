'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');

global.XynigoCaptchaVision = require('../src/vision-client.js');

const Vision = global.XynigoCaptchaVision;

const CONFIG = { provider: 'zhipu', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', model: 'glm-4v-flash', apiKey: 'test-key' };
const IMAGE = 'data:image/jpeg;base64,QUJD';

test('chatCompletionsUrl joins the chat endpoint and keeps complete urls', () => {
    assert.equal(Vision.chatCompletionsUrl(CONFIG.baseUrl), 'https://open.bigmodel.cn/api/paas/v4/chat/completions');
    assert.equal(Vision.chatCompletionsUrl('https://ark.cn-beijing.volces.com/api/v3/'), 'https://ark.cn-beijing.volces.com/api/v3/chat/completions');
    assert.equal(Vision.chatCompletionsUrl('https://example.com/v1/chat/completions'), 'https://example.com/v1/chat/completions');
    assert.throws(() => Vision.chatCompletionsUrl(''));
});

test('buildChatBody keeps the numbered-puzzle contract and requires model and key', () => {
    const body = Vision.buildChatBody(CONFIG, IMAGE, 'PROMPT');
    assert.equal(body.model, 'glm-4v-flash');
    assert.equal(body.temperature, 0);
    const parts = body.messages[0].content;
    assert.equal(parts[1].type, 'image_url');
    assert.equal(parts[1].image_url.url, IMAGE);
    assert.throws(() => Vision.buildChatBody({ ...CONFIG, model: '' }, IMAGE, 'p'));
    assert.throws(() => Vision.buildChatBody({ ...CONFIG, apiKey: '' }, IMAGE, 'p'));
});

test('extractResponseText reads string content, part arrays and reasoning_content', () => {
    assert.equal(Vision.extractResponseText({ choices: [{ message: { content: '{"targets":[1]}' } }] }), '{"targets":[1]}');
    assert.equal(Vision.extractResponseText({ choices: [{ message: { content: [{ type: 'text', text: 'abc' }] } }] }), 'abc');
    assert.equal(Vision.extractResponseText({ choices: [{ message: { content: '', reasoning_content: 'think…{"targets":[2]}' } }] }), 'think…{"targets":[2]}');
    assert.equal(Vision.extractResponseText({}), '');
});

function fakeFetch(steps) {
    const calls = [];
    const fetchImpl = (url, options) => {
        calls.push({ url, options });
        const step = steps[Math.min(calls.length, steps.length) - 1];
        return Promise.resolve({
            ok: step.status >= 200 && step.status < 300,
            status: step.status,
            text: () => Promise.resolve(step.body),
        });
    };
    return { calls, fetchImpl };
}

test('callVisionModel returns parsed-free text on success', async () => {
    const { calls, fetchImpl } = fakeFetch([{ status: 200, body: '{"choices":[{"message":{"content":"{\\"targets\\":[1,2]}"}}]}' }]);
    const result = await Vision.callVisionModel(CONFIG, IMAGE, 'PROMPT', fetchImpl);
    assert.equal(result.ok, true);
    assert.equal(result.retryUsed, false);
    assert.match(result.text, /targets/);
    assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
    assert.match(calls[0].url, /\/chat\/completions$/);
});

test('callVisionModel retries with raw base64 when the provider rejects the data url', async () => {
    const { calls, fetchImpl } = fakeFetch([
        { status: 400, body: '{"error":{"code":"1210","message":"image format not supported"}}' },
        { status: 200, body: '{"choices":[{"message":{"content":"{\\"targets\\":[3]}"}}]}' },
    ]);
    const result = await Vision.callVisionModel(CONFIG, IMAGE, 'PROMPT', fetchImpl);
    assert.equal(result.ok, true);
    assert.equal(result.retryUsed, true);
    assert.equal(calls.length, 2);
    const secondBody = calls[1].options.body;
    assert.match(secondBody, /QUJD/);
    assert.doesNotMatch(secondBody, /data:image/); // 第二次请求剥离 data: 前缀。
});

test('callVisionModel surfaces non-image errors without retry', async () => {
    const { calls, fetchImpl } = fakeFetch([{ status: 401, body: '{"error":{"message":"invalid api key"}}' }]);
    const result = await Vision.callVisionModel(CONFIG, IMAGE, 'PROMPT', fetchImpl);
    assert.equal(result.ok, false);
    assert.equal(result.status, 401);
    assert.equal(result.retryUsed, false);
    assert.equal(calls.length, 1);
});
