const { run } = require('../db');

const base = () => (process.env.N8N_WEBHOOK_BASE || '').replace(/\/$/, '');
const appBase = () => (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`).replace(/\/$/, '');

async function finishRun(id, status, error = null) {
  await run(
    `UPDATE automation_runs SET status=?, error=?, finished_at=NOW(3),
       duration_ms=TIMESTAMPDIFF(MICROSECOND, started_at, NOW(3))/1000 WHERE id=? AND status='running'`,
    [status, error, id]
  );
}

/**
 * Fire an n8n webhook and record the run.
 * - n8n configured  -> POST to {N8N_WEBHOOK_BASE}/{path}; the workflow ends by calling /api/automation/runs/:id/finish
 * - n8n missing     -> run `fallback(runId)` locally if given (keeps the demo alive), otherwise mark the run skipped
 */
async function trigger(workflow, path, payload, { entityType = null, entityId = null, fallback = null } = {}) {
  const mode = base() ? 'n8n' : fallback ? 'local' : 'skipped';
  const r = await run(
    `INSERT INTO automation_runs (workflow, trigger_type, entity_type, entity_id, status, payload) VALUES (?,?,?,?, 'running', ?)`,
    [workflow, 'webhook', entityType, entityId, JSON.stringify({ mode })]
  );
  const runId = r.insertId;

  if (mode === 'n8n') {
    fetch(`${base()}/${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-automation-secret': process.env.AUTOMATION_SECRET || 'dev-secret' },
      body: JSON.stringify({ run_id: runId, api_base: appBase(), ...payload }),
      signal: AbortSignal.timeout(10000),
    })
      .then((res) => (res.ok ? null : finishRun(runId, 'failed', `n8n answered HTTP ${res.status} for /${path}`)))
      .catch((e) => finishRun(runId, 'failed', `Could not reach n8n: ${e.message}`));
  } else if (mode === 'local') {
    setTimeout(() => {
      fallback(runId)
        .then(() => finishRun(runId, 'success'))
        .catch((e) => finishRun(runId, 'failed', e.message));
    }, 1200);
  } else {
    await finishRun(runId, 'skipped', 'N8N_WEBHOOK_BASE is not set');
  }
  return { runId, mode };
}

module.exports = { trigger, finishRun, appBase };
