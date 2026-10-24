import { describe, expect, it } from 'vitest';
import { confirmationSettings } from './settings';
import {
  assessPhone,
  DEFAULT_CALL_SCRIPT,
  deliveryScore,
  emptyPhoneHistory,
  type PhoneHistory,
  renderCallScript,
  unknownScriptVariables,
} from './recovery';

const history = (h: Partial<PhoneHistory>): PhoneHistory => ({ ...emptyPhoneHistory(), ...h });
const rules = { flagAfterFailed: 1, minScore: null, minDecided: 2 };

describe('delivery success score', () => {
  it('is delivered over delivered and not received, rounded', () => {
    expect(deliveryScore(history({ delivered: 8, returned: 1, fake: 1 }))).toBe(80);
    expect(deliveryScore(history({ delivered: 2, noAnswer: 1 }))).toBe(67);
    expect(deliveryScore(history({ wrongNumber: 3 }))).toBe(0);
  });

  it('is null for a phone with no decided order, whatever else it has', () => {
    expect(deliveryScore(history({ cancelled: 4, open: 2 }))).toBeNull();
  });
});

describe('assessPhone', () => {
  it('calls a new phone neither risky nor trusted', () => {
    expect(assessPhone(emptyPhoneHistory(), null, rules)).toMatchObject({
      score: null,
      decided: 0,
      risky: false,
      trusted: false,
      reasons: [],
    });
  });

  it("keeps Phase 5A's flags: staff's flag and failed deliveries", () => {
    const r = assessPhone(history({ delivered: 5 }), { flagged: true, failedDeliveries: 2 }, rules);
    expect(r.reasons).toEqual(['flagged', 'failed_deliveries']);
    expect(r).toMatchObject({ risky: true, trusted: false });
    const limit = { ...rules, flagAfterFailed: 3 };
    expect(assessPhone(history({}), { flagged: false, failedDeliveries: 2 }, limit).risky).toBe(
      false,
    );
  });

  it('is risky under the threshold only with enough decided orders', () => {
    const strict = { ...rules, minScore: 50 };
    expect(assessPhone(history({ fake: 1 }), null, strict).risky).toBe(false);
    expect(assessPhone(history({ fake: 1, returned: 1 }), null, strict).reasons).toEqual([
      'low_score',
    ]);
    expect(assessPhone(history({ delivered: 1, fake: 1 }), null, strict).risky).toBe(false);
  });

  it('has no threshold by default', () => {
    expect(assessPhone(history({ fake: 5 }), null, rules).risky).toBe(false);
  });

  it('trusts 90% or more over at least 3 delivered, unless risky', () => {
    expect(assessPhone(history({ delivered: 3 }), null, rules).trusted).toBe(true);
    expect(assessPhone(history({ delivered: 2 }), null, rules).trusted).toBe(false);
    expect(assessPhone(history({ delivered: 9, fake: 1 }), null, rules).trusted).toBe(true);
    expect(assessPhone(history({ delivered: 8, fake: 1 }), null, rules).trusted).toBe(false);
    const flagged = { flagged: true, failedDeliveries: 0 };
    expect(assessPhone(history({ delivered: 10 }), flagged, rules).trusted).toBe(false);
  });
});

describe('call script', () => {
  const values = {
    name: 'Rina',
    order_number: '#1001',
    items: 'Blue kurti × 2',
    total: '৳2,450',
    cod_amount: '৳2,450',
    area: 'Dhanmondi',
    delivery_estimate: '1–2 days',
    store_name: 'Rina Fashion',
  };

  it('uses only known placeholders by default, in both languages', () => {
    expect(unknownScriptVariables(DEFAULT_CALL_SCRIPT.bn)).toEqual([]);
    expect(unknownScriptVariables(DEFAULT_CALL_SCRIPT.en)).toEqual([]);
  });

  it("fills the store's script, or the default when the language is empty", () => {
    expect(renderCallScript({ en: 'Hi {name}, {order_number}' }, 'en', values)).toBe(
      'Hi Rina, #1001',
    );
    expect(renderCallScript({ en: 'Hi {name}' }, 'bn', values)).toContain('Rina Fashion');
  });

  it('renders as plain text, never markup', () => {
    expect(renderCallScript({ en: '{name}' }, 'en', { name: '<b>x</b>' })).toBe('<b>x</b>');
  });

  it('refuses a script with an unknown placeholder', () => {
    expect(confirmationSettings.safeParse({ script: { en: 'Hi {nmae}' } }).success).toBe(false);
    expect(confirmationSettings.safeParse({ script: { en: 'Hi {name}' } }).success).toBe(true);
  });
});
