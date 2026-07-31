const request = require('supertest');
const app = require('../index');
const pool = require('../config/db');
const jwt = require('jsonwebtoken');
const { jwtSecret, TOKEN_COOKIE } = require('../config/auth');
const { randomUUID } = require('crypto');

describe('Bid Routes', () => {
  let client;
  let tenantId;
  let adminId;
  let customerId;
  let authToken;
  let customerToken;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query('TRUNCATE TABLE tenants, platform_admins, tenant_users RESTART IDENTITY CASCADE');
    const tenantRes = await client.query(
      "INSERT INTO tenants (name, registration_number) VALUES ('Test Tenant', 'REG123') RETURNING id"
    );
    tenantId = tenantRes.rows[0].id;

    const adminRes = await client.query(
      "INSERT INTO platform_admins (id, email, password_hash, full_name, role) VALUES ($1, 'admin@test.com', 'hash', 'Test Admin', 'business_admin') RETURNING id",
      [randomUUID()]
    );
    adminId = adminRes.rows[0].id;
    authToken = jwt.sign({ user_id: adminId, user_type: 'platform_admin', role: 'business_admin' }, jwtSecret, { expiresIn: '1h' });

    const customerRes = await client.query(
      "INSERT INTO tenant_users (id, tenant_id, email, password_hash, full_name, role) VALUES ($1, $2, 'customer@test.com', 'hash', 'Test Customer', 'customer') RETURNING id",
      [randomUUID(), tenantId]
    );
    customerId = customerRes.rows[0].id;
    customerToken = jwt.sign({ user_id: customerId, user_type: 'tenant_user', tenant_id: tenantId, role: 'customer' }, jwtSecret, { expiresIn: '1h' });
  });

  afterAll(async () => {
    await client.release();
    await pool.end();
  });

  describe('POST /api/tenants/:tid/bids', () => {
    const bidData = {
        title: 'Test Bid',
        description: 'Test bid description',
        deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
        delivery_terms: 'DDP',
        business_category: 'ICT & Software',
        line_items: JSON.stringify([
          {
            item_description: 'Test Item',
            unit_of_measure: 'each',
            quantity: 10,
          },
        ]),
        bidding_fee_amount: 100,
    };

    it('should return 401 Unauthorized without an auth token', async () => {
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/bids`)
        .field(bidData);
      
      expect(res.statusCode).toEqual(401);
    });
    
    it('should return 403 Forbidden for a user with an incorrect role', async () => {
        const res = await request(app)
        .post(`/api/tenants/${tenantId}/bids`)
        .set('Cookie', `${TOKEN_COOKIE}=${customerToken}`)
        .field(bidData);

        expect(res.statusCode).toEqual(403);
    });

    it('should create a new bid with valid auth and set created_by', async () => {
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/bids`)
        .set('Cookie', `${TOKEN_COOKIE}=${authToken}`)
        .field(bidData);

      expect(res.statusCode).toEqual(201);
      expect(res.body).toHaveProperty('id');
      expect(res.body.title).toBe('Test Bid');
      expect(res.body.created_by).toBe(adminId);
    });
    
    it('should fail to create a new bid with an invalid business category', async () => {
      const invalidBidData = {
        ...bidData,
        title: 'Test Bid 2',
        business_category: 'Invalid Category',
      };

      const res = await request(app)
        .post(`/api/tenants/${tenantId}/bids`)
        .set('Cookie', `${TOKEN_COOKIE}=${authToken}`)
        .field(invalidBidData);

      expect(res.statusCode).toEqual(500);
    });
  });
});
