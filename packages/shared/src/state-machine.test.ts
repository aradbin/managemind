import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { defineMachine } from './state-machine';

// A cut-down order lifecycle, the shape Phase 4 will use.
const order = defineMachine<
  'pending' | 'confirmed' | 'processing' | 'completed' | 'cancelled',
  'confirm' | 'process' | 'complete' | 'cancel',
  { stockReserved: boolean }
>({
  name: 'order',
  initial: 'pending',
  states: ['pending', 'confirmed', 'processing', 'completed', 'cancelled'],
  transitions: {
    pending: {
      confirm: { to: 'confirmed', guard: (c) => c.stockReserved || 'stock is not reserved' },
      cancel: { to: 'cancelled', effects: ['release_stock'] },
    },
    confirmed: {
      process: { to: 'processing' },
      cancel: { to: 'cancelled', effects: ['release_stock', 'notify_customer'] },
    },
    processing: { complete: { to: 'completed', effects: ['settle_cod'] } },
  },
});
const ok = { stockReserved: true };

describe('state machine', () => {
  it('returns the transition with its declared effects', () => {
    expect(order.transition('confirmed', 'cancel', ok)).toEqual({
      machine: 'order',
      from: 'confirmed',
      to: 'cancelled',
      event: 'cancel',
      effects: ['release_stock', 'notify_customer'],
    });
    expect(order.transition('pending', 'confirm', ok).effects).toEqual([]);
  });

  it('rejects transitions that are not declared', () => {
    expect(order.can('completed', 'cancel', ok)).toBe(false);
    const attempt = () => order.transition('completed', 'cancel', ok);
    expect(attempt).toThrow(AppError);
    try {
      attempt();
    } catch (e) {
      expect((e as AppError).code).toBe('illegal_transition');
      expect((e as AppError).status).toBe(409);
    }
  });

  it('rejects a transition whose guard refuses, with the reason', () => {
    expect(order.can('pending', 'confirm', { stockReserved: false })).toBe(false);
    expect(() => order.transition('pending', 'confirm', { stockReserved: false })).toThrow(
      /stock is not reserved/,
    );
  });

  it('lists events and final states', () => {
    expect(order.events('pending')).toEqual(['confirm', 'cancel']);
    expect(order.isFinal('completed')).toBe(true);
    expect(order.isFinal('pending')).toBe(false);
  });

  it('refuses a definition that points at an unknown state', () => {
    expect(() =>
      defineMachine<'a' | 'b', 'go'>({
        name: 'broken',
        initial: 'a',
        states: ['a', 'b'],
        transitions: { a: { go: { to: 'c' as 'b' } } },
      }),
    ).toThrow(/unknown state "c"/);
  });

  it('draws a Mermaid diagram', () => {
    const diagram = order.toMermaid();
    expect(diagram).toContain('[*] --> pending');
    expect(diagram).toContain('confirmed --> cancelled: cancel');
    expect(diagram).toContain('completed --> [*]');
  });
});
