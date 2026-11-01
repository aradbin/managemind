// A phone's delivery success score (phase-6-plan §3.3, §3.8): a badge on
// lists and cards, and a panel with the counts behind it and why a phone is
// risky. The score is the store's own history only; colour is never the
// only signal, each badge says it in words.
import type { components } from '@managemind/sdk';
import { formatNumber } from '@managemind/shared/i18n';
import type { ReactNode } from 'react';
import { type AdminKey, useLocale } from '../i18n';
import '../i18n/orders';
import { cn } from '../lib/utils';

export type PhoneRisk = components['schemas']['PhoneRisk'];

const TONES = {
  risky: 'bg-danger-soft text-danger',
  trusted: 'bg-success-soft text-success',
  known: 'bg-muted text-foreground',
  new: 'bg-muted text-muted-foreground',
};

const toneOf = (r: PhoneRisk): keyof typeof TONES =>
  r.risky ? 'risky' : r.trusted ? 'trusted' : r.score === null ? 'new' : 'known';

/** "8 of 10 delivered · 1 came back · 1 fake": every non-zero count, in words. */
export function useRiskCounts() {
  const { t, locale } = useLocale();
  const n = (v: number) => formatNumber(locale, v);
  return (r: PhoneRisk, withOther = true) => {
    const h = r.history;
    const parts = [
      r.decided > 0 && t('risk.delivered', { delivered: n(h.delivered), decided: n(r.decided) }),
      h.returned > 0 && t('risk.returned', { count: n(h.returned) }),
      h.fake > 0 && t('risk.fake', { count: n(h.fake) }),
      h.wrongNumber > 0 && t('risk.wrongNumber', { count: n(h.wrongNumber) }),
      h.noAnswer > 0 && t('risk.noAnswer', { count: n(h.noAnswer) }),
      withOther && h.cancelled > 0 && t('risk.cancelled', { count: n(h.cancelled) }),
      withOther && h.open > 0 && t('risk.open', { count: n(h.open) }),
    ];
    return parts.filter(Boolean).join(' · ');
  };
}

/** The score as a chip: "80%", "New", or "Risky · 40%". */
export function ScoreBadge({ risk, className }: { risk: PhoneRisk; className?: string }) {
  const { t, locale } = useLocale();
  const counts = useRiskCounts();
  const tone = toneOf(risk);
  const score =
    risk.score === null
      ? t('risk.new')
      : t('risk.score', { score: formatNumber(locale, risk.score) });
  const label = [risk.risky && t('risk.risky'), score].filter(Boolean).join(' · ');
  const detail = counts(risk, false);
  return (
    <span
      title={detail || t('risk.newHint')}
      className={cn(
        'inline-flex h-[22px] items-center whitespace-nowrap rounded-md px-2 text-xs font-medium tabular-nums',
        TONES[tone],
        className,
      )}
    >
      <span className="sr-only">{t('risk.badge')}: </span>
      {label}
    </span>
  );
}

/** Why a risky phone is risky, one line each. */
export function RiskReasons({
  risk,
  failedDeliveries,
}: {
  risk: PhoneRisk;
  failedDeliveries?: number;
}) {
  const { t, locale } = useLocale();
  if (!risk.risky) return null;
  return (
    <ul className="flex flex-col gap-1 text-sm text-danger">
      {risk.reasons.map((reason) => (
        <li key={reason}>
          {t(`risk.reason.${reason}` as AdminKey, {
            count: formatNumber(locale, failedDeliveries ?? risk.history.returned),
          })}
        </li>
      ))}
      <li className="text-muted-foreground">{t('risk.riskyRule')}</li>
    </ul>
  );
}

/**
 * The delivery record: the score, a bar of delivered against not received,
 * the counts, why it's risky, and whatever the screen adds below.
 */
export function RiskPanel({
  risk,
  heading = 'h2',
  atPlacement,
  failedDeliveries,
  children,
}: {
  risk: PhoneRisk;
  heading?: 'h2' | 'h3';
  /** The score the order saw when it was placed, when it differs. */
  atPlacement?: number | null | undefined;
  failedDeliveries?: number;
  children?: ReactNode;
}) {
  const { t, locale } = useLocale();
  const counts = useRiskCounts();
  const H = heading;
  const share = risk.decided ? (risk.history.delivered / risk.decided) * 100 : 0;
  return (
    <section
      aria-labelledby="risk-h"
      className="flex flex-col gap-3 rounded-xl border border-border bg-background p-4 md:p-5"
    >
      <div className="flex items-center justify-between gap-2">
        <H id="risk-h" className="font-semibold">
          {t('risk.title')}
        </H>
        <ScoreBadge risk={risk} />
      </div>
      {risk.decided > 0 && (
        <div aria-hidden className="flex h-2 overflow-hidden rounded-full bg-danger-soft">
          <div className="bg-success" style={{ width: `${share}%` }} />
        </div>
      )}
      <p className="text-sm">{counts(risk) || t('risk.newHint')}</p>
      {atPlacement !== undefined && atPlacement !== risk.score && (
        <p className="text-xs text-muted-foreground">
          {t('risk.atPlacement', {
            score:
              atPlacement === null
                ? t('risk.new')
                : t('risk.score', { score: formatNumber(locale, atPlacement) }),
          })}
        </p>
      )}
      <RiskReasons risk={risk} {...(failedDeliveries === undefined ? {} : { failedDeliveries })} />
      <p className="text-xs text-muted-foreground">{t('risk.fromStore')}</p>
      {children}
    </section>
  );
}
