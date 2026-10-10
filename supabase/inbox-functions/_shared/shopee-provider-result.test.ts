import assert from 'node:assert/strict';
import {test} from 'node:test';
import {providerResult} from './shopee-provider-result.ts';
test('API error inside HTTP 200 is a failure',()=>assert.equal(providerResult(200,{error:'permission_denied'}).status,'failed'));
test('success without provider message ID stays unknown',()=>assert.equal(providerResult(200,{ok:true}).status,'unknown'));
test('HTTP 500 does not permit blind retries',()=>assert.equal(providerResult(500,{}).status,'unknown'));
test('timeout-like HTTP result cannot count as sent',()=>assert.equal(providerResult(408,{}).status,'failed'));
test('confirmed nested provider ID counts as sent',()=>assert.deepEqual(providerResult(200,{response:{message_id:'msg-123'}}),{status:'sent',id:'msg-123',error:null}));
test('false success cannot override a supplied ID',()=>assert.equal(providerResult(200,{success:false,message_id:'msg-123'}).status,'failed'));
