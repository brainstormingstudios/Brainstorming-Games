'use client';

import { useTranslations } from 'next-intl';
import { ShieldCheck } from 'lucide-react';
import { useCallback, useRef, useState, type ReactNode } from 'react';
import { Button, Dialog, useToast } from '@brainstorming/ui';
import { getRepo, RepoError } from '@/lib/data';
import type { CheckoutIntent } from '@/lib/data/billingTypes';
import { formatInr } from '@/lib/domain/premium';

interface RazorpayOptions {
  key: string;
  amount?: number;
  currency?: string;
  name: string;
  description: string;
  order_id?: string;
  subscription_id?: string;
  prefill?: { email?: string; name?: string };
  theme?: { color?: string };
  handler: (r: { razorpay_payment_id: string }) => void;
  modal?: { ondismiss?: () => void };
}
declare global {
  interface Window {
    Razorpay?: new (o: RazorpayOptions) => { open(): void };
  }
}

let razorpayLoading: Promise<void> | null = null;
function loadRazorpay(): Promise<void> {
  razorpayLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://checkout.razorpay.com/v1/checkout.js';
    s.onload = () => resolve();
    s.onerror = () => {
      razorpayLoading = null;
      reject(new Error('Razorpay could not load'));
    };
    document.head.appendChild(s);
  });
  return razorpayLoading;
}

/**
 * Takes a payment for a checkout intent. Razorpay intents open Razorpay Checkout (cards, UPI,
 * net banking, wallets) and then wait for the server's signed confirmation; the local build shows a
 * clearly marked test checkout instead, where no money moves.
 */
export function useCheckout(): { pay: (start: () => Promise<CheckoutIntent>) => Promise<boolean>; dialog: ReactNode } {
  const t = useTranslations('billing');
  const toast = useToast();
  const [test, setTest] = useState<Extract<CheckoutIntent, { mode: 'test' }> | null>(null);
  const [busy, setBusy] = useState(false);
  const resolver = useRef<((ok: boolean) => void) | null>(null);

  const finish = useCallback((ok: boolean) => {
    resolver.current?.(ok);
    resolver.current = null;
    setTest(null);
  }, []);

  const pay = useCallback(
    async (start: () => Promise<CheckoutIntent>) => {
      let intent: CheckoutIntent;
      try {
        intent = await start();
      } catch (err) {
        toast(err instanceof RepoError && err.message !== err.code ? err.message : t('startFailed'), { tone: 'error' });
        return false;
      }
      if (intent.mode === 'test') {
        setTest(intent);
        return new Promise<boolean>((resolve) => {
          resolver.current = resolve;
        });
      }
      try {
        await loadRazorpay();
      } catch {
        toast(t('startFailed'), { tone: 'error' });
        return false;
      }
      const reference = intent.subscriptionId ?? intent.orderId ?? '';
      const paid = await new Promise<boolean>((resolve) => {
        const rzp = new window.Razorpay!({
          key: intent.keyId,
          amount: intent.amount,
          currency: 'INR',
          name: 'Brainstorming Games',
          description: intent.description,
          subscription_id: intent.subscriptionId,
          order_id: intent.orderId,
          prefill: intent.prefill,
          theme: { color: '#00c0f0' },
          handler: () => resolve(true),
          modal: { ondismiss: () => resolve(false) },
        });
        rzp.open();
      });
      if (!paid) return false;
      toast(t('confirming'));
      const confirmed = await (await getRepo()).billing.confirmPayment(reference).catch(() => false);
      toast(confirmed ? t('paid') : t('pending'), confirmed ? { tone: 'success' } : undefined);
      return confirmed;
    },
    [t, toast],
  );

  const dialog = (
    <Dialog
      open={test != null}
      onClose={() => finish(false)}
      title={t('testTitle')}
      description={t('testIntro')}
      footer={
        <>
          <Button variant="ghost" onClick={() => finish(false)}>
            {t('cancel')}
          </Button>
          <Button
            loading={busy}
            data-testid="test-pay"
            onClick={() => {
              if (!test) return;
              setBusy(true);
              void getRepo()
                .then((repo) => repo.billing.completeTestPayment(test.intentId))
                .then(() => {
                  toast(t('paid'), { tone: 'success' });
                  finish(true);
                })
                .catch(() => {
                  toast(t('startFailed'), { tone: 'error' });
                  finish(false);
                })
                .finally(() => setBusy(false));
            }}
          >
            {test ? t('payTest', { amount: formatInr(test.amount) }) : ''}
          </Button>
        </>
      }
    >
      {test ? (
        <div className="flex flex-col gap-3 text-sm" data-testid="test-checkout">
          <p className="font-bold">{test.description}</p>
          <p className="font-display text-3xl font-extrabold">{formatInr(test.amount)}</p>
          <p className="flex items-start gap-2 rounded-control border border-border bg-surface-3 p-3 text-fg-muted">
            <ShieldCheck aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
            {t('testNote')}
          </p>
        </div>
      ) : null}
    </Dialog>
  );
  return { pay, dialog };
}
