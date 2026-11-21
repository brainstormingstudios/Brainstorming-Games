// POST /functions/v1/pre-qa-report { versionId, report } with header x-pre-qa-secret.
// Called by the pre-QA GitHub Actions run. Stores the report through set_pre_qa_report(), which
// also auto-publishes clean minor updates of live games.
import { adminClient, json, sameSecret } from '../_shared/http.ts';

const MAX_REPORT_BYTES = 600_000;

Deno.serve(async (req) => {
  if (req.method !== 'POST') return json(req, 405, { error: 'method' });
  const secret = Deno.env.get('PRE_QA_CALLBACK_SECRET');
  if (!sameSecret(req.headers.get('x-pre-qa-secret'), secret)) return json(req, 401, { error: 'unauthorised' });
  const text = await req.text();
  if (text.length > MAX_REPORT_BYTES) return json(req, 413, { error: 'report too large' });
  const { versionId, report } = JSON.parse(text) as { versionId?: string; report?: { status?: string; checks?: unknown[] } };
  if (!versionId || !report || !['pass', 'warn', 'fail'].includes(String(report.status)) || !Array.isArray(report.checks)) {
    return json(req, 400, { error: 'invalid' });
  }
  const { data, error } = await adminClient().rpc('set_pre_qa_report', { p_version_id: versionId, p_report: report });
  if (error) return json(req, 400, { error: error.message });
  return json(req, 200, { status: data });
});
