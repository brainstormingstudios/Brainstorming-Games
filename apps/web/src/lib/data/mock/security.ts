import { emitTopic } from '../bus';
import { mutateTable, newId, nowIso, readTable } from './db';
import { sendMail } from './mail';

/** Mirror of app.raise_alert: records an alert and e-mails every admin about warnings. */
export function raiseAlert(kind: string, severity: 'info' | 'warn' | 'high', title: string, detail: Record<string, unknown> = {}): void {
  mutateTable('securityAlerts', (rows) => {
    rows.push({ id: newId(), kind, severity, title, detail, createdAt: nowIso(), resolvedAt: null });
  });
  if (severity !== 'info') {
    for (const u of readTable('users')) if (u.role === 'admin' && !u.bannedAt) sendMail(u.email, 'security_alert', { title, severity, kind });
  }
  emitTopic('admin');
}
