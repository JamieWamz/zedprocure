import { getPasswordValidationError } from './passwordValidation';

describe('getPasswordValidationError', () => {
  test.each([
    ['', 'Password is required'],
    ['Short1!', 'Password must be at least 10 characters'],
    [`SecurePass1!${'x'.repeat(118)}`, 'Password is too long'],
    ['ALLUPPERCASE1!', 'Password must contain a lowercase letter'],
    ['alllowercase1!', 'Password must contain an uppercase letter'],
    ['NoNumbersHere!', 'Password must contain a number'],
    ['NoSpecial123', 'Password must contain a special character'],
  ])('rejects an invalid password', (password, expected) => {
    expect(getPasswordValidationError(password)).toBe(expected);
  });

  it('accepts a password matching the server policy', () => {
    expect(getPasswordValidationError('SecurePass1!')).toBeNull();
  });
});
