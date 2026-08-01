import dayjs from 'dayjs';
import { buildProcurementRequestPrefill, parseLegacyRequestDescription } from './procurementRequestPrefill';

describe('procurement request bid prefill', () => {
  test('parses legacy request prose without losing quantity, unit, or warranty', () => {
    const parsed = parseLegacyRequestDescription(`### Specifications
Solar-powered cold room with remote monitoring.

### Quantity & Unit of Measure
Quantity: 3 sets

### Warranty & Support Requirements
Two-year on-site warranty.`);

    expect(parsed).toEqual({
      specification: 'Solar-powered cold room with remote monitoring.',
      quantity: 3,
      unit_of_measure: 'sets',
      warranty: 'Two-year on-site warranty.',
    });
  });

  test('prefers structured requirements and derives a valid tender schedule', () => {
    const prefill = buildProcurementRequestPrefill({
      id: 'request-1',
      tenant_id: 'tenant-1',
      title: 'Supply of laptops',
      description: 'Legacy copy',
      requirements: {
        specification: 'Business laptops with 16 GB RAM',
        quantity: 20,
        unit_of_measure: 'each',
        warranty: 'Three years',
        business_category: 'ICT & Software',
      },
      estimated_budget: '200000',
      payment_method: 'bank_transfer',
      required_delivery_date: '2026-09-30T12:00:00.000Z',
    }, dayjs('2026-08-01T10:00:00.000Z'));

    expect(prefill.source_request_id).toBe('request-1');
    expect(prefill.line_items[0]).toMatchObject({ quantity: 20, unit_of_measure: 'each', unit_price_estimate: 10000 });
    expect(prefill.business_category).toBe('ICT & Software');
    expect(prefill.delivery_end.format('YYYY-MM-DD')).toBe('2026-09-30');
    expect(prefill.deadline.isBefore(prefill.delivery_start)).toBe(true);
    expect(prefill.delivery_start.isBefore(prefill.delivery_end)).toBe(true);
    expect(prefill.technical_specifications).toContain('Three years');
  });
});
