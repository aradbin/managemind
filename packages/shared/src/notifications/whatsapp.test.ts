import { describe, expect, it } from 'vitest';
import { TEMPLATE_VARIABLES } from './index';
import {
  confirmPayload,
  readConfirmPayload,
  toWhatsappTemplate,
  WHATSAPP_DEFAULTS,
  WHATSAPP_EVENTS,
  whatsappTemplateName,
  whatsappTemplateProblems,
} from './whatsapp';

describe('WhatsApp templates', () => {
  it('numbers our variables by first use, with a sample for each', () => {
    expect(
      toWhatsappTemplate('Hi {customer_name}, order {order_number}; {customer_name} again.'),
    ).toEqual({
      body: 'Hi {{1}}, order {{2}}; {{1}} again.',
      variables: ['customer_name', 'order_number'],
      examples: ['Rahim', '#1042'],
    });
  });

  it('finds what Meta refuses: a variable at either end, or two side by side', () => {
    expect(whatsappTemplateProblems('{store_name} says hi.')).toEqual(['starts_with_variable']);
    expect(whatsappTemplateProblems('Track: {order_url}')).toEqual(['ends_with_variable']);
    expect(whatsappTemplateProblems('Order {order_number} {total} now.')).toEqual([
      'adjacent_variables',
    ]);
  });

  it('ships default wording Meta accepts, using only each event’s variables', () => {
    for (const event of WHATSAPP_EVENTS) {
      for (const locale of ['bn', 'en'] as const) {
        const text = WHATSAPP_DEFAULTS[event][locale];
        expect(whatsappTemplateProblems(text), `${event} ${locale}`).toEqual([]);
        for (const v of toWhatsappTemplate(text).variables) {
          expect(TEMPLATE_VARIABLES[event], `${event} ${locale} {${v}}`).toContain(v);
        }
      }
    }
  });

  it('names templates by event and version', () => {
    expect(whatsappTemplateName('order_placed')).toBe('mm_order_placed');
    expect(whatsappTemplateName('order_placed', 3)).toBe('mm_order_placed_v3');
  });

  it('reads back only well-formed button payloads', () => {
    expect(readConfirmPayload(confirmPayload('cancel', 'Ab12Cd34Ef'))).toEqual({
      action: 'cancel',
      code: 'Ab12Cd34Ef',
    });
    expect(readConfirmPayload('confirm:')).toBeNull();
    expect(readConfirmPayload('delete:Ab12Cd34Ef')).toBeNull();
  });
});
