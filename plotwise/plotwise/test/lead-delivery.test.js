const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const calls = [];
require.cache[require.resolve('../src/db')] = { exports: { one: async () => null, run: async (sql, params) => { calls.push({ sql, params }); return {}; } } };
require.cache[require.resolve('../src/automation/n8n')] = { exports: { trigger: async () => {}, finishRun: async () => {} } };
const { applyLeadScore, localLeadAutomation } = require('../src/services/leads');
beforeEach(() => { calls.length = 0; });
const input = { score: 80, label: 'hot', reason: 'test', channel: 'email', reply_subject: 'Test', reply_body: 'Draft' };
function message() { return calls.find(c => c.sql.includes('INSERT INTO messages')); }
function contacted() { return calls.some(c => c.sql.includes('last_contacted_at')); }
test('local fallback prepares a template without claiming contact or delivery', async () => {
  await localLeadAutomation({ id: 1, name: 'Demo', email: 'demo@example.com', message: 'visit tomorrow' }, { title: 'Demo home', price: 100 }, 1);
  assert.equal(contacted(), false);
  assert.equal(message().params[4], 'template');
  assert.equal(message().params[5], 'queued');
  assert.match(message().sql, /IF\(\?='sent', NOW\(\), NULL\)/);
  assert.equal(calls.some(c => c.params?.includes('ai_reply_sent')), false);
});
test('missing delivery status defaults to queued', async () => {
  await applyLeadScore(1, input);
  assert.equal(message().params[5], 'queued');
  assert.equal(contacted(), false);
});
test('explicit delivery confirmation advances contact and logs reply', async () => {
  await applyLeadScore(1, { ...input, message_status: 'sent' });
  assert.equal(contacted(), true);
  assert.equal(message().params[5], 'sent');
  assert.ok(calls.some(c => c.params?.includes('ai_reply_sent')));
});
test('failed delivery stays failed and does not advance followups', async () => {
  await applyLeadScore(1, { ...input, message_status: 'failed' });
  assert.equal(contacted(), false);
  assert.equal(message().params[5], 'failed');
});
