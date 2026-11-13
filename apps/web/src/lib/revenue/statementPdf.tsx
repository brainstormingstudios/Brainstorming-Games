'use client';

import { Document, Page, StyleSheet, Text, View, pdf } from '@react-pdf/renderer';
import type { RevenueMonthRow } from '@/lib/data/repo';
import { SHARES, THRESHOLD_MINOR } from '@/lib/domain/revenue';
import { SITE_NAME, STUDIO_NAME } from '@/lib/config';

/**
 * A self-billing statement for one studio and month, rendered to PDF in the browser with
 * @react-pdf/renderer (loaded only when someone downloads a statement).
 * Amounts use the ISO code (INR, USD): the built-in PDF fonts have no rupee sign.
 */
const s = StyleSheet.create({
  page: { padding: 40, fontSize: 10, fontFamily: 'Helvetica', color: '#000c30' },
  title: { fontSize: 18, fontFamily: 'Helvetica-Bold', marginBottom: 4 },
  muted: { color: '#36456b' },
  band: { marginTop: 14, marginBottom: 8, paddingVertical: 6, paddingHorizontal: 8, backgroundColor: '#dce6f2' },
  row: { flexDirection: 'row', borderBottomWidth: 0.5, borderBottomColor: '#b4c4dc', paddingVertical: 4 },
  head: { fontFamily: 'Helvetica-Bold' },
  c1: { flex: 3 },
  c2: { flex: 1.2, textAlign: 'right' },
  total: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  bold: { fontFamily: 'Helvetica-Bold' },
  note: { marginTop: 16, fontSize: 8, color: '#36456b', lineHeight: 1.4 },
});

const money = (minor: number, currency: string) =>
  `${currency} ${(minor / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function Statement({ st }: { st: RevenueMonthRow }) {
  const threshold = THRESHOLD_MINOR[st.currency];
  return (
    <Document title={`${SITE_NAME} statement ${st.month} – ${st.studioName}`} author={STUDIO_NAME}>
      <Page size="A4" style={s.page}>
        <Text style={s.title}>Self-billing statement</Text>
        <Text style={s.muted}>
          Issued by {STUDIO_NAME} ({SITE_NAME}) on behalf of {st.studioName} · Period {st.month} · Currency {st.currency}
        </Text>
        <Text style={s.muted}>Status: {st.status === 'paid' ? 'Paid' : st.status === 'rolled_over' ? 'Rolled over (below the payout threshold)' : 'Due'}</Text>

        <Text style={s.band}>Games</Text>
        <View style={[s.row, s.head]}>
          <Text style={s.c1}>Game</Text>
          <Text style={s.c2}>Impressions</Text>
          <Text style={s.c2}>Net revenue</Text>
          <Text style={s.c2}>Share</Text>
          <Text style={s.c2}>Earned</Text>
        </View>
        {st.games.map((g) => (
          <View key={g.gameId} style={s.row}>
            <Text style={s.c1}>{g.title}</Text>
            <Text style={s.c2}>{g.impressions.toLocaleString('en-IN')}</Text>
            <Text style={s.c2}>{money(g.net, st.currency)}</Text>
            <Text style={s.c2}>{(g.share * 100).toFixed(1)}%</Text>
            <Text style={s.c2}>{money(g.earned, st.currency)}</Text>
          </View>
        ))}

        <Text style={s.band}>Summary</Text>
        {[
          ['Gross attributed revenue', st.gross],
          ['Net revenue (after refunds and invalid traffic)', st.net],
          [`Your earnings (${st.sharePct.toFixed(2)}% of net)`, st.earned],
          ['Carried over from earlier months', st.carryIn],
        ].map(([label, value]) => (
          <View key={String(label)} style={s.total}>
            <Text>{label}</Text>
            <Text>{money(Number(value), st.currency)}</Text>
          </View>
        ))}
        <View style={[s.total, { marginTop: 8 }]}>
          <Text style={s.bold}>Payout due</Text>
          <Text style={s.bold}>{money(st.payoutDue, st.currency)}</Text>
        </View>

        <Text style={s.note}>
          Shares: {SHARES.standard * 100}% of net for players from our traffic, {SHARES.referral * 100}% for players from your referral link,{' '}
          {SHARES.exclusive * 100}% during a 60-day web-exclusive window after Rise Launch. Net is the ad revenue we received minus refunds and invalid
          traffic. Balances under {money(threshold, st.currency)} roll over to the next month. Payouts are made about 45 days after the end of the month.
          This statement is issued by {STUDIO_NAME} under a self-billing arrangement accepted in the developer terms. You are responsible for your own
          taxes.
        </Text>
      </Page>
    </Document>
  );
}

export async function downloadStatement(st: RevenueMonthRow): Promise<void> {
  const blob = await pdf(<Statement st={st} />).toBlob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `statement-${st.month}-${st.studioName.replace(/[^a-z0-9]+/gi, '-').toLowerCase()}.pdf`;
  a.click();
  window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
}
