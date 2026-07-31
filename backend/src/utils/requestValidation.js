const CONTROL_CHARACTERS = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function cleanText(value, { maxLength = 2000, required = false } = {}) {
  if (value === undefined || value === null) {
    if (required) throw new Error('A required text field is missing');
    return null;
  }
  if (typeof value !== 'string') throw new Error('Text fields must be strings');
  const cleaned = value.replace(CONTROL_CHARACTERS, '').trim();
  if (required && !cleaned) throw new Error('A required text field is empty');
  if (cleaned.length > maxLength) throw new Error(`Text exceeds the ${maxLength} character limit`);
  return cleaned;
}

function requireUuid(value, field = 'id') {
  if (typeof value !== 'string' || !UUID_PATTERN.test(value)) {
    throw new Error(`${field} must be a valid UUID`);
  }
  return value;
}

function requireEnum(value, allowed, field) {
  if (!allowed.includes(value)) throw new Error(`${field} must be one of: ${allowed.join(', ')}`);
  return value;
}

module.exports = { cleanText, requireUuid, requireEnum };
