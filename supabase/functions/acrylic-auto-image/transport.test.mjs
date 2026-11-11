import { test } from 'node:test';
import assert from 'node:assert/strict';
import { prepareResponses, installTransport } from './transport.mjs';
test('JSON mode has explicit input instruction and preserves payload', () => {
 const body = { model: 'test-model', instructions: 'Schema', store: false, text: { format: { type: 'json_object' } }, input: [{ role: 'user', content: [{ type: 'input_text', text: 'brief' }] }] };
 const result = JSON.parse(prepareResponses({ method: 'POST', body: JSON.stringify(body) }).body);
 assert.match(result.input[0].content[0].text, /JSON/);
 assert.deepEqual(result.input.slice(1), body.input);
 assert.equal(result.model, body.model); assert.equal(result.store, false);
});
test('non JSON requests unchanged', () => {
 const init = { body: JSON.stringify({ prompt: 'image' }) };
 assert.equal(prepareResponses(init), init);
});
test('image requests are not changed or repeated', async () => {
 let calls = 0; const init = { body: 'image-body' }; const target = {};
 installTransport(async (url, options) => { ++calls; assert.equal(options, init); return new Response('{}'); }, target);
 await target.fetch('https://api.openai.com/v1/images/generations', init);
 assert.equal(calls, 1);
});
test('Responses error preserves diagnostic without automatic retry', async () => {
 const target = {}; let calls = 0;
 installTransport(async () => { ++calls; return new Response(JSON.stringify({ error: { code: 'invalid', param: 'input', message: 'Missing JSON' } }), { status: 400 }); }, target);
 await assert.rejects(() => target.fetch('https://api.openai.com/v1/responses', { body: '{}' }), /OPENAI_TEXT_400: invalid input Missing JSON/);
 assert.equal(calls, 1);
});
