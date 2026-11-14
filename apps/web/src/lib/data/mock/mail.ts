import { PLAY_ORIGIN } from '@/lib/config';
import type { MailTemplate } from '../../../../../../supabase/functions/_shared/mailTemplates';

/**
 * Sends an automated e-mail through the local services process, which renders the template, keeps
 * a copy in .local/mail and, when a Gmail app password is configured, really sends it from the
 * official address. Never blocks the action that triggered it.
 */
export function sendMail(to: string | null | undefined, template: MailTemplate, data: Record<string, unknown> = {}): void {
  if (!to || typeof window === 'undefined') return;
  void fetch(`${PLAY_ORIGIN}/__mock/mail`, {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({ to, template, data }),
    keepalive: true,
  }).catch(() => {});
}
