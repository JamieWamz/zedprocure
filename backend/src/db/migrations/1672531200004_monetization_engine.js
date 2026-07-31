exports.up = pgm => {
  pgm.sql(`
    CREATE TABLE platform_monetization_settings (
      singleton_id BOOLEAN PRIMARY KEY DEFAULT TRUE CHECK (singleton_id),
      escrow_fee_type VARCHAR(12) NOT NULL DEFAULT 'percentage' CHECK (escrow_fee_type IN ('percentage','fixed')),
      escrow_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 2.50 CHECK (escrow_fee_percent BETWEEN 0 AND 100),
      escrow_fee_fixed NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (escrow_fee_fixed >= 0),
      express_match_fee NUMERIC(15,2) NOT NULL DEFAULT 75 CHECK (express_match_fee >= 0),
      withdrawal_fee_percent NUMERIC(5,2) NOT NULL DEFAULT 1.50 CHECK (withdrawal_fee_percent BETWEEN 0 AND 100),
      withdrawal_fee_fixed NUMERIC(15,2) NOT NULL DEFAULT 5 CHECK (withdrawal_fee_fixed >= 0),
      allow_subsidized_transactions BOOLEAN NOT NULL DEFAULT FALSE,
      subsidy_limit NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (subsidy_limit >= 0),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    INSERT INTO platform_monetization_settings (singleton_id) VALUES (TRUE) ON CONFLICT DO NOTHING;

    CREATE TABLE supplier_subscriptions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      supplier_id UUID NOT NULL UNIQUE REFERENCES suppliers(id) ON DELETE CASCADE,
      tier VARCHAR(20) NOT NULL DEFAULT 'free' CHECK (tier IN ('free','growth','enterprise')),
      monthly_bid_limit INTEGER NOT NULL DEFAULT 0 CHECK (monthly_bid_limit >= 0),
      bids_used INTEGER NOT NULL DEFAULT 0 CHECK (bids_used >= 0),
      bid_credits INTEGER NOT NULL DEFAULT 0 CHECK (bid_credits >= 0),
      period_start TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()),
      period_end TIMESTAMPTZ NOT NULL DEFAULT date_trunc('month', now()) + interval '1 month',
      active BOOLEAN NOT NULL DEFAULT TRUE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );

    ALTER TABLE payment_transactions ADD COLUMN bid_id UUID REFERENCES bids(id);
    ALTER TABLE payment_transactions DROP CONSTRAINT IF EXISTS payment_transactions_payment_method_check;
    ALTER TABLE payment_transactions ADD CONSTRAINT payment_transactions_payment_method_check
      CHECK (payment_method IN ('mobile_money','bank_transfer','wallet'));

    CREATE TABLE bid_fee_charges (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      bid_id UUID NOT NULL REFERENCES bids(id) ON DELETE CASCADE,
      supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      supplier_user_id UUID NOT NULL REFERENCES supplier_users(id),
      payment_transaction_id UUID REFERENCES payment_transactions(id),
      charge_source VARCHAR(20) NOT NULL CHECK (charge_source IN ('wallet','subscription','bid_credit','free')),
      amount NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (amount >= 0),
      status VARCHAR(20) NOT NULL DEFAULT 'completed' CHECK (status IN ('pending','completed','refunded')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      UNIQUE (bid_id, supplier_id)
    );

    ALTER TABLE bids ADD COLUMN express_match BOOLEAN NOT NULL DEFAULT FALSE;
    ALTER TABLE bids ADD COLUMN express_match_fee NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (express_match_fee >= 0);

    DELETE FROM supplier_responses a USING supplier_responses b
      WHERE a.bid_supplier_id = b.bid_supplier_id
        AND (a.submitted_at, a.id) < (b.submitted_at, b.id);
    CREATE UNIQUE INDEX supplier_responses_one_per_supplier_bid ON supplier_responses (bid_supplier_id);

    DELETE FROM bid_response_line_items a USING bid_response_line_items b
      WHERE a.supplier_response_id = b.supplier_response_id
        AND a.bid_line_item_id = b.bid_line_item_id
        AND (a.created_at, a.id) < (b.created_at, b.id);
    CREATE UNIQUE INDEX bid_response_line_items_unique_item
      ON bid_response_line_items (supplier_response_id, bid_line_item_id);

    ALTER TABLE orders ADD COLUMN buyer_price NUMERIC(15,2);
    ALTER TABLE orders ADD COLUMN supplier_price NUMERIC(15,2);
    ALTER TABLE orders ADD COLUMN spread_amount NUMERIC(15,2);
    ALTER TABLE orders ADD COLUMN buyer_protection_fee NUMERIC(15,2) NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN express_match_fee NUMERIC(15,2) NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN supplier_payout_amount NUMERIC(15,2);
    ALTER TABLE orders ADD COLUMN platform_revenue_amount NUMERIC(15,2);
    ALTER TABLE orders ADD COLUMN subsidy_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
    ALTER TABLE orders ADD COLUMN pricing_snapshot JSONB;
    ALTER TABLE orders ADD COLUMN supplier_response_id UUID REFERENCES supplier_responses(id);
    ALTER TABLE orders ADD COLUMN bid_requirement_id UUID REFERENCES bid_requirements(id);

    UPDATE orders SET
      buyer_price = total_amount,
      supplier_price = total_amount,
      spread_amount = 0,
      supplier_payout_amount = total_amount,
      platform_revenue_amount = 0,
      pricing_snapshot = jsonb_build_object('legacy', true, 'buyerTotal', total_amount, 'supplierPayout', total_amount)
    WHERE buyer_price IS NULL;
    ALTER TABLE orders ALTER COLUMN buyer_price SET NOT NULL;
    ALTER TABLE orders ALTER COLUMN supplier_price SET NOT NULL;
    ALTER TABLE orders ALTER COLUMN spread_amount SET NOT NULL;
    ALTER TABLE orders ALTER COLUMN supplier_payout_amount SET NOT NULL;
    ALTER TABLE orders ALTER COLUMN platform_revenue_amount SET NOT NULL;
    ALTER TABLE orders ALTER COLUMN pricing_snapshot SET NOT NULL;
    ALTER TABLE orders ADD CONSTRAINT orders_pricing_nonnegative_check CHECK (
      buyer_price > 0 AND supplier_price > 0 AND buyer_protection_fee >= 0
      AND express_match_fee >= 0 AND supplier_payout_amount > 0 AND total_amount > 0
    );
    ALTER TABLE orders ADD CONSTRAINT orders_buyer_total_equation_check CHECK (
      total_amount = buyer_price + buyer_protection_fee + express_match_fee
    );
    ALTER TABLE orders ADD CONSTRAINT orders_supplier_payout_equation_check CHECK (
      supplier_payout_amount = supplier_price
    );
    ALTER TABLE orders ADD CONSTRAINT orders_spread_equation_check CHECK (
      spread_amount = buyer_price - supplier_price
    );
    ALTER TABLE orders ADD CONSTRAINT orders_revenue_equation_check CHECK (
      platform_revenue_amount = spread_amount + buyer_protection_fee + express_match_fee
    );
    ALTER TABLE orders ADD CONSTRAINT orders_subsidy_equation_check CHECK (
      subsidy_amount = GREATEST(-platform_revenue_amount, 0)
    );

    ALTER TABLE escrow_accounts ADD COLUMN supplier_payout_amount NUMERIC(15,2);
    ALTER TABLE escrow_accounts ADD COLUMN platform_fee_amount NUMERIC(15,2) NOT NULL DEFAULT 0;
    ALTER TABLE escrow_accounts ADD COLUMN subsidy_amount NUMERIC(15,2) NOT NULL DEFAULT 0;

    UPDATE wallet_transactions older SET reference = NULL
      FROM wallet_transactions newer
      WHERE older.reference IS NOT NULL AND older.reference = newer.reference
        AND (older.created_at, older.id) < (newer.created_at, newer.id);
    CREATE UNIQUE INDEX wallet_transactions_reference_unique
      ON wallet_transactions(reference) WHERE reference IS NOT NULL;
    UPDATE payments_log older SET status = 'failed', updated_at = now()
      FROM payments_log newer
      WHERE older.order_id = newer.order_id AND older.status = 'pending' AND newer.status = 'pending'
        AND (older.created_at, older.id) < (newer.created_at, newer.id);
    CREATE UNIQUE INDEX payments_log_one_pending_per_order
      ON payments_log(order_id) WHERE status = 'pending';

    CREATE VIEW buyer_order_quotes AS
      SELECT id AS order_id, bid_id, buyer_price AS procurement_amount,
             buyer_protection_fee, express_match_fee, total_amount AS total_due,
             status, created_at
      FROM orders;
    CREATE VIEW supplier_order_payouts AS
      SELECT id AS order_id, bid_id, awarded_supplier_id,
             supplier_price AS accepted_quote, supplier_payout_amount AS net_payout,
             status, created_at
      FROM orders;

    CREATE TABLE withdrawal_requests (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      wallet_id UUID NOT NULL REFERENCES wallets(id),
      requested_by UUID NOT NULL,
      gross_amount NUMERIC(15,2) NOT NULL CHECK (gross_amount > 0),
      processing_fee NUMERIC(15,2) NOT NULL CHECK (processing_fee >= 0),
      net_payout NUMERIC(15,2) NOT NULL CHECK (net_payout > 0),
      payout_method VARCHAR(20) NOT NULL CHECK (payout_method IN ('mobile_money','bank_transfer')),
      payout_destination VARCHAR(255) NOT NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','processing','completed','failed','reversed')),
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
  `);
};

exports.down = pgm => {
  pgm.sql(`
    DROP TABLE IF EXISTS withdrawal_requests;
    DROP VIEW IF EXISTS supplier_order_payouts;
    DROP VIEW IF EXISTS buyer_order_quotes;
    DROP INDEX IF EXISTS wallet_transactions_reference_unique;
    DROP INDEX IF EXISTS payments_log_one_pending_per_order;
    ALTER TABLE escrow_accounts DROP COLUMN IF EXISTS platform_fee_amount;
    ALTER TABLE escrow_accounts DROP COLUMN IF EXISTS subsidy_amount;
    ALTER TABLE escrow_accounts DROP COLUMN IF EXISTS supplier_payout_amount;
    ALTER TABLE orders DROP COLUMN IF EXISTS bid_requirement_id;
    ALTER TABLE orders DROP COLUMN IF EXISTS supplier_response_id;
    ALTER TABLE orders DROP COLUMN IF EXISTS pricing_snapshot;
    ALTER TABLE orders DROP COLUMN IF EXISTS platform_revenue_amount;
    ALTER TABLE orders DROP COLUMN IF EXISTS subsidy_amount;
    ALTER TABLE orders DROP COLUMN IF EXISTS supplier_payout_amount;
    ALTER TABLE orders DROP COLUMN IF EXISTS express_match_fee;
    ALTER TABLE orders DROP COLUMN IF EXISTS buyer_protection_fee;
    ALTER TABLE orders DROP COLUMN IF EXISTS spread_amount;
    ALTER TABLE orders DROP COLUMN IF EXISTS supplier_price;
    ALTER TABLE orders DROP COLUMN IF EXISTS buyer_price;
    DROP INDEX IF EXISTS bid_response_line_items_unique_item;
    DROP INDEX IF EXISTS supplier_responses_one_per_supplier_bid;
    ALTER TABLE bids DROP COLUMN IF EXISTS express_match_fee;
    ALTER TABLE bids DROP COLUMN IF EXISTS express_match;
    DROP TABLE IF EXISTS bid_fee_charges;
    ALTER TABLE payment_transactions DROP COLUMN IF EXISTS bid_id;
    DROP TABLE IF EXISTS supplier_subscriptions;
    DROP TABLE IF EXISTS platform_monetization_settings;
  `);
};
