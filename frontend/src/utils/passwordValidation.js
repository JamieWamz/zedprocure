export function getPasswordValidationError(password) {
  if (typeof password !== 'string' || password.length === 0) return 'Password is required';
  if (password.length < 10) return 'Password must be at least 10 characters';
  if (password.length > 128) return 'Password is too long';
  if (!/[a-z]/.test(password)) return 'Password must contain a lowercase letter';
  if (!/[A-Z]/.test(password)) return 'Password must contain an uppercase letter';
  if (!/[0-9]/.test(password)) return 'Password must contain a number';
  if (!/[^A-Za-z0-9]/.test(password)) return 'Password must contain a special character';
  return null;
}

export const strongPasswordRule = {
  validator: (_, value) => {
    const error = getPasswordValidationError(value);
    return error ? Promise.reject(new Error(error)) : Promise.resolve();
  },
};
