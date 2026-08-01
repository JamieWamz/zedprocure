import dayjs from 'dayjs';

const VALID_UNITS = new Set([
  'each', 'kg', 'g', 'ton', 'meters', 'cm', 'liters', 'ml', 'sqm', 'sqft',
  'hours', 'days', 'months', 'lump_sum', 'boxes', 'pairs', 'sets',
]);

function asObject(value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value;
  if (typeof value !== 'string') return {};
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

export function parseLegacyRequestDescription(description = '') {
  const text = String(description || '').trim();
  const section = (heading) => {
    const pattern = new RegExp(`###\\s*${heading}\\s*([\\s\\S]*?)(?=\\n###\\s|$)`, 'i');
    return text.match(pattern)?.[1]?.trim() || '';
  };
  const quantitySection = section('Quantity & Unit of Measure');
  const quantityMatch = quantitySection.match(/Quantity:\s*([\d.]+)\s+([a-z_]+)/i);
  const quantity = Number(quantityMatch?.[1] || 1);
  const requestedUnit = quantityMatch?.[2]?.toLowerCase();

  return {
    specification: section('Specifications') || text,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    unit_of_measure: VALID_UNITS.has(requestedUnit) ? requestedUnit : 'each',
    warranty: section('Warranty & Support Requirements'),
  };
}

function requestDates(requiredDeliveryDate, now) {
  const current = dayjs(now);
  const parsedRequiredDate = requiredDeliveryDate ? dayjs(requiredDeliveryDate) : null;
  const hasUsableRequiredDate = parsedRequiredDate?.isValid() && parsedRequiredDate.isAfter(current.add(8, 'hour'));
  const deliveryEnd = hasUsableRequiredDate
    ? parsedRequiredDate.hour(17).minute(0).second(0).millisecond(0)
    : current.add(14, 'day').hour(17).minute(0).second(0).millisecond(0);

  const minimumDeadline = current.add(1, 'day').hour(17).minute(0).second(0).millisecond(0);
  const requestedDeadline = deliveryEnd.subtract(7, 'day');
  let deadline = requestedDeadline.isAfter(minimumDeadline) ? requestedDeadline : minimumDeadline;
  if (!deadline.isBefore(deliveryEnd)) deadline = deliveryEnd.subtract(4, 'hour');

  let deliveryStart = deadline.add(1, 'day').hour(8).minute(0).second(0).millisecond(0);
  if (!deliveryStart.isBefore(deliveryEnd)) deliveryStart = deadline.add(1, 'hour');

  return { deadline, deliveryStart, deliveryEnd };
}

export function buildProcurementRequestPrefill(request, now = dayjs()) {
  const legacy = parseLegacyRequestDescription(request?.description);
  const structured = asObject(request?.requirements);
  const quantity = Number(structured.quantity ?? legacy.quantity ?? 1);
  const unit = VALID_UNITS.has(structured.unit_of_measure)
    ? structured.unit_of_measure
    : legacy.unit_of_measure;
  const specification = String(structured.specification || legacy.specification || request?.description || '').trim();
  const warranty = String(structured.warranty || legacy.warranty || '').trim();
  const dates = requestDates(request?.required_delivery_date, now);
  const budget = Number(request?.estimated_budget);
  const safeQuantity = Number.isFinite(quantity) && quantity > 0 ? quantity : 1;

  const technicalParts = [
    specification && `Customer specifications\n${specification}`,
    warranty && `Warranty and support\n${warranty}`,
    request?.payment_method && `Preferred payment method\n${String(request.payment_method).replaceAll('_', ' ')}`,
    request?.required_delivery_date && `Customer needed-by date\n${dayjs(request.required_delivery_date).format('DD MMMM YYYY')}`,
  ].filter(Boolean);

  return {
    source_request_id: request?.id,
    tenant_id: request?.tenant_id,
    title: request?.title || '',
    description: specification,
    business_category: structured.business_category || undefined,
    delivery_terms: 'DDP',
    deadline: dates.deadline,
    delivery_start: dates.deliveryStart,
    delivery_end: dates.deliveryEnd,
    bidding_fee_amount: 0,
    technical_specifications: technicalParts.join('\n\n'),
    line_items: [{
      item_description: request?.title || specification.slice(0, 250) || 'Customer requirement',
      unit_of_measure: unit || 'each',
      quantity: safeQuantity,
      unit_price_estimate: Number.isFinite(budget) && budget > 0 ? Number((budget / safeQuantity).toFixed(2)) : null,
    }],
  };
}
