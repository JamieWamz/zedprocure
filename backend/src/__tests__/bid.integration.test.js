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
  let invitedSupplierId;
  let invitedSupplierUserId;
  let invitedSupplierToken;
  let uninvitedSupplierUserId;
  let uninvitedSupplierToken;
  let authToken;
  let customerToken;

  beforeAll(async () => {
    client = await pool.connect();
    await client.query('TRUNCATE TABLE tenants, platform_admins, tenant_users, suppliers, supplier_users RESTART IDENTITY CASCADE');
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

    const invitedSupplierRes = await client.query(
      `INSERT INTO suppliers (company_name, registration_number, verification_status, is_active)
       VALUES ('Invited Supplier', 'SUP-INVITED', 'verified', true) RETURNING id`
    );
    invitedSupplierId = invitedSupplierRes.rows[0].id;
    invitedSupplierUserId = randomUUID();
    await client.query(
      `INSERT INTO supplier_users (id, supplier_id, email, password_hash, full_name, role)
       VALUES ($1, $2, 'invited-supplier@test.com', 'hash', 'Invited Supplier User', 'supplier_user')`,
      [invitedSupplierUserId, invitedSupplierId]
    );
    invitedSupplierToken = jwt.sign(
      { user_id: invitedSupplierUserId, user_type: 'supplier_user', role: 'supplier_user' },
      jwtSecret,
      { expiresIn: '1h' }
    );

    const uninvitedSupplierRes = await client.query(
      `INSERT INTO suppliers (company_name, registration_number, verification_status, is_active)
       VALUES ('Uninvited Supplier', 'SUP-UNINVITED', 'verified', true) RETURNING id`
    );
    const uninvitedSupplierId = uninvitedSupplierRes.rows[0].id;
    uninvitedSupplierUserId = randomUUID();
    await client.query(
      `INSERT INTO supplier_users (id, supplier_id, email, password_hash, full_name, role)
       VALUES ($1, $2, 'uninvited-supplier@test.com', 'hash', 'Uninvited Supplier User', 'supplier_user')`,
      [uninvitedSupplierUserId, uninvitedSupplierId]
    );
    uninvitedSupplierToken = jwt.sign(
      { user_id: uninvitedSupplierUserId, user_type: 'supplier_user', role: 'supplier_user' },
      jwtSecret,
      { expiresIn: '1h' }
    );
  });

  describe('invite-only bid access', () => {
    const restrictedBidData = () => ({
      title: `Restricted Bid ${randomUUID()}`,
      description: 'Private sourcing event',
      deadline: new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString(),
      delivery_terms: 'DDP',
      visibility: 'restricted',
      line_items: JSON.stringify([{ item_description: 'Private item', unit_of_measure: 'each', quantity: 1 }]),
      bidding_fee_amount: 0,
    });

    it('requires an invite list when creating an invite-only bid', async () => {
      const res = await request(app)
        .post(`/api/tenants/${tenantId}/bids`)
        .set('Cookie', `${TOKEN_COOKIE}=${authToken}`)
        .field(restrictedBidData());

      expect(res.statusCode).toBe(400);
      expect(res.body.error).toMatch(/at least one verified supplier/i);
    });

    it('stores invitations and prevents discovery or access by uninvited suppliers', async () => {
      const createRes = await request(app)
        .post(`/api/tenants/${tenantId}/bids`)
        .set('Cookie', `${TOKEN_COOKIE}=${authToken}`)
        .field({
          ...restrictedBidData(),
          supplier_ids: JSON.stringify([invitedSupplierId]),
        });

      expect(createRes.statusCode).toBe(201);
      const restrictedBidId = createRes.body.id;

      const publishRes = await request(app)
        .put(`/api/bids/${restrictedBidId}/publish`)
        .set('Cookie', `${TOKEN_COOKIE}=${authToken}`);
      expect(publishRes.statusCode).toBe(200);

      const publicRes = await request(app).get('/api/public/bids');
      expect(publicRes.statusCode).toBe(200);
      expect(publicRes.body.some(bid => bid.id === restrictedBidId)).toBe(false);

      const uninvitedDetailRes = await request(app)
        .get(`/api/bids/${restrictedBidId}`)
        .set('Cookie', `${TOKEN_COOKIE}=${uninvitedSupplierToken}`);
      expect(uninvitedDetailRes.statusCode).toBe(403);

      const expressInterestRes = await request(app)
        .post(`/api/supplier/bids/${restrictedBidId}/express-interest`)
        .set('Cookie', `${TOKEN_COOKIE}=${uninvitedSupplierToken}`);
      expect(expressInterestRes.statusCode).toBe(403);
      expect(expressInterestRes.body.error).toMatch(/invite-only/i);

      const invitedDetailRes = await request(app)
        .get(`/api/bids/${restrictedBidId}`)
        .set('Cookie', `${TOKEN_COOKIE}=${invitedSupplierToken}`);
      expect(invitedDetailRes.statusCode).toBe(200);
      expect(invitedDetailRes.body.suppliers[0].bid_supplier_id).toBeTruthy();

      const supplierFeedRes = await request(app)
        .get('/api/supplier/bids')
        .set('Cookie', `${TOKEN_COOKIE}=${uninvitedSupplierToken}`);
      expect(supplierFeedRes.statusCode).toBe(200);
      expect(supplierFeedRes.body.some(bid => bid.id === restrictedBidId)).toBe(false);
    });
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

  describe('customer request to bid detail workflow', () => {
    it('preserves structured requirements, conversion dates, and readable delivery expectations', async () => {
      const neededBy = new Date(Date.now() + 21 * 24 * 60 * 60 * 1000);
      const requestRes = await request(app)
        .post('/api/procurement-requests')
        .set('Cookie', `${TOKEN_COOKIE}=${customerToken}`)
        .send({
          title: 'Supply of field laptops',
          description: 'Rugged business laptops for field teams',
          estimated_budget: 120000,
          payment_method: 'bank_transfer',
          required_delivery_date: neededBy.toISOString(),
          requirements: {
            specification: 'Rugged laptops with 16 GB RAM and LTE',
            quantity: 12,
            unit_of_measure: 'each',
            warranty: 'Three-year on-site warranty',
            business_category: 'ICT & Software',
          },
        });

      expect(requestRes.statusCode).toBe(201);
      expect(requestRes.body.requirements).toMatchObject({ quantity: 12, unit_of_measure: 'each' });

      const bidRes = await request(app)
        .post(`/api/tenants/${tenantId}/bids`)
        .set('Cookie', `${TOKEN_COOKIE}=${authToken}`)
        .field({
          title: requestRes.body.title,
          description: requestRes.body.requirements.specification,
          deadline: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
          delivery_start: new Date(Date.now() + 8 * 24 * 60 * 60 * 1000).toISOString(),
          delivery_end: neededBy.toISOString(),
          delivery_terms: 'DDP',
          business_category: 'ICT & Software',
          line_items: JSON.stringify([{ item_description: requestRes.body.title, unit_of_measure: 'each', quantity: 12 }]),
          bidding_fee_amount: 0,
          source_request_id: requestRes.body.id,
        });

      expect(bidRes.statusCode).toBe(201);
      expect(bidRes.body.source_request_id).toBe(requestRes.body.id);

      const publishRes = await request(app)
        .put(`/api/bids/${bidRes.body.id}/publish`)
        .set('Cookie', `${TOKEN_COOKIE}=${authToken}`);
      expect(publishRes.statusCode).toBe(200);

      const requirementRes = await request(app)
        .post(`/api/bids/${bidRes.body.id}/requirements`)
        .set('Cookie', `${TOKEN_COOKIE}=${customerToken}`)
        .send({
          budget_amount: 120000,
          expected_delivery_time: '14 business days after award',
          payment_method: 'bank_transfer',
          certification_standards: 'Three-year warranty and ISO 9001 manufacturer',
        });
      expect(requirementRes.statusCode).toBe(201);

      const detailRes = await request(app)
        .get(`/api/bids/${bidRes.body.id}`)
        .set('Cookie', `${TOKEN_COOKIE}=${customerToken}`);
      expect(detailRes.statusCode).toBe(200);
      expect(detailRes.body.requirements[0].expected_delivery_time).toBe('14 business days after award');
      expect(detailRes.body.line_items).toHaveLength(1);

      const requestRow = await client.query(
        'SELECT status, converted_bid_id FROM procurement_requests WHERE id = $1',
        [requestRes.body.id]
      );
      expect(requestRow.rows[0]).toMatchObject({ status: 'converted_to_bid', converted_bid_id: bidRes.body.id });
    });
  });
});
