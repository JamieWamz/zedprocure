const { financialNoStore, requireJsonMutation } = require('../middleware/financialSecurity');

describe('financial route security middleware', () => {
  test('marks financial responses as non-cacheable', () => {
    const res = { set: jest.fn() };
    const next = jest.fn();
    financialNoStore({}, res, next);
    expect(res.set).toHaveBeenCalledWith(expect.objectContaining({ 'Cache-Control': 'no-store, max-age=0' }));
    expect(next).toHaveBeenCalled();
  });

  test('rejects ambiguous mutation content types', () => {
    const req = { method: 'POST', is: jest.fn(() => false) };
    const json = jest.fn();
    const res = { status: jest.fn(() => ({ json })) };
    requireJsonMutation(req, res, jest.fn());
    expect(res.status).toHaveBeenCalledWith(415);
    expect(json).toHaveBeenCalledWith({ error: 'Financial mutations require application/json' });
  });
});
