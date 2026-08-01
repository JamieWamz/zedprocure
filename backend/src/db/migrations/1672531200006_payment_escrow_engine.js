exports.up = pgm => {
  pgm.sql(`
    ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20);
    ALTER TABLE tenant_users ADD COLUMN IF NOT EXISTS wallet_tier VARCHAR(20) NOT NULL DEFAULT 'STANDARD'
      CHECK (wallet_tier IN ('STANDARD', 'BUSINESS', 'ENTERPRISE'));
    ALTER TABLE supplier_users ADD COLUMN IF NOT EXISTS phone_number VARCHAR(20);
    ALTER TABLE supplier_users ADD COLUMN IF NOT EXISTS wallet_tier VARCHAR(20) NOT NULL DEFAULT 'STANDARD'
      CHECK (wallet_tier IN ('STANDARD', 'BUSINESS', 'ENTERPRISE'));

    CREATE TABLE payout_accounts (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      supplier_id UUID NOT NULL REFERENCES suppliers(id) ON DELETE CASCADE,
      provider VARCHAR(16) NOT NULL CHECK (provider IN ('MTN', 'AIRTEL', 'BANK')),
      encrypted_destination TEXT NOT NULL,
      destination_last4 VARCHAR(4) NOT NULL,
      bank_code VARCHAR(40),
      account_name VARCHAR(150),
      is_primary BOOLEAN NOT NULL DEFAULT FALSE,
      is_verified BOOLEAN NOT NULL DEFAULT FALSE,
      verified_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE UNIQUE INDEX payout_accounts_one_primary_per_supplier
      ON payout_accounts(supplier_id) WHERE is_primary;

    CREATE TABLE escrow_transactions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      order_id UUID NOT NULL UNIQUE REFERENCES orders(id),
      transaction_ref UUID NOT NULL UNIQUE,
      buyer_user_id UUID NOT NULL REFERENCES tenant_users(id),
      seller_id UUID NOT NULL REFERENCES suppliers(id),
      collection_provider VARCHAR(16) NOT NULL CHECK (collection_provider IN ('MTN', 'AIRTEL', 'BANK')),
      payout_provider VARCHAR(16) CHECK (payout_provider IN ('MTN', 'AIRTEL', 'BANK')),
      amount NUMERIC(15,2) NOT NULL CHECK (amount > 0),
      currency CHAR(3) NOT NULL DEFAULT 'ZMW' CHECK (currency ~ '^[A-Z]{3}$'),
      platform_fee NUMERIC(15,2) NOT NULL DEFAULT 0 CHECK (platform_fee >= 0),
      payout_amount NUMERIC(15,2) NOT NULL CHECK (payout_amount > 0),
      status VARCHAR(32) NOT NULL DEFAULT 'INITIATED' CHECK (status IN (
        'INITIATED', 'PAYMENT_PENDING', 'HELD_IN_ESCROW', 'DISBURSEMENT_PENDING',
        'RELEASED', 'DISPUTED', 'REFUNDED', 'FAILED'
      )),
      pending_operation VARCHAR(16) CHECK (pending_operation IN ('COLLECTION', 'RELEASE', 'REFUND')),
      collection_reference VARCHAR(128) UNIQUE,
      disbursement_reference VARCHAR(128) UNIQUE,
      encrypted_collection_destination TEXT NOT NULL,
      collection_msisdn_last4 VARCHAR(4),
      payout_account_id UUID REFERENCES payout_accounts(id),
      provider_response JSONB NOT NULL DEFAULT '{}'::jsonb,
      failure_stage VARCHAR(24),
      failure_code VARCHAR(80),
      failure_message VARCHAR(500),
      reconciliation_attempts INTEGER NOT NULL DEFAULT 0 CHECK (reconciliation_attempts >= 0),
      last_reconciled_at TIMESTAMPTZ,
      next_reconcile_at TIMESTAMPTZ,
      initiated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      collection_requested_at TIMESTAMPTZ,
      held_at TIMESTAMPTZ,
      disbursement_requested_at TIMESTAMPTZ,
      released_at TIMESTAMPTZ,
      disputed_at TIMESTAMPTZ,
      refunded_at TIMESTAMPTZ,
      failed_at TIMESTAMPTZ,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      version INTEGER NOT NULL DEFAULT 1,
      CHECK (amount = payout_amount + platform_fee OR platform_fee = 0)
    );
    CREATE INDEX escrow_transactions_reconciliation_idx
      ON escrow_transactions(status, next_reconcile_at)
      WHERE status IN ('PAYMENT_PENDING', 'DISBURSEMENT_PENDING');

    CREATE OR REPLACE FUNCTION enforce_escrow_state_transition()
    RETURNS trigger AS $$
    BEGIN
      IF NEW.status = OLD.status THEN RETURN NEW; END IF;
      IF NEW.version <> OLD.version + 1 THEN
        RAISE EXCEPTION 'Escrow status transitions must increment version exactly once';
      END IF;
      IF NOT (
        (OLD.status='INITIATED' AND NEW.status IN ('PAYMENT_PENDING','FAILED')) OR
        (OLD.status='PAYMENT_PENDING' AND NEW.status IN ('HELD_IN_ESCROW','FAILED')) OR
        (OLD.status='HELD_IN_ESCROW' AND NEW.status IN ('DISBURSEMENT_PENDING','DISPUTED','FAILED')) OR
        (OLD.status='DISBURSEMENT_PENDING' AND NEW.status IN ('RELEASED','REFUNDED','DISPUTED','FAILED')) OR
        (OLD.status='DISPUTED' AND NEW.status IN ('HELD_IN_ESCROW','DISBURSEMENT_PENDING','REFUNDED')) OR
        (OLD.status='FAILED' AND NEW.status IN ('PAYMENT_PENDING','DISBURSEMENT_PENDING'))
      ) THEN
        RAISE EXCEPTION 'Illegal escrow transition from % to %', OLD.status, NEW.status;
      END IF;
      RETURN NEW;
    END;
    $$ LANGUAGE plpgsql;
    CREATE TRIGGER escrow_transactions_state_guard
      BEFORE UPDATE OF status ON escrow_transactions
      FOR EACH ROW EXECUTE FUNCTION enforce_escrow_state_transition();

    CREATE TABLE escrow_state_transitions (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      escrow_transaction_id UUID NOT NULL REFERENCES escrow_transactions(id),
      from_status VARCHAR(32),
      to_status VARCHAR(32) NOT NULL,
      actor_id UUID,
      actor_type VARCHAR(32),
      reason VARCHAR(500),
      correlation_id UUID NOT NULL,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT now()
    );
    CREATE INDEX escrow_state_transitions_transaction_idx
      ON escrow_state_transitions(escrow_transaction_id, created_at);

    CREATE TABLE webhook_logs (
      id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
      provider VARCHAR(16) NOT NULL CHECK (provider IN ('MTN', 'AIRTEL', 'BANK')),
      idempotency_key VARCHAR(160) NOT NULL,
      event_type VARCHAR(80),
      payload JSONB NOT NULL,
      payload_sha256 CHAR(64) NOT NULL,
      signature_verified BOOLEAN NOT NULL DEFAULT FALSE,
      processing_status VARCHAR(16) NOT NULL DEFAULT 'RECEIVED'
        CHECK (processing_status IN ('RECEIVED', 'PROCESSED', 'IGNORED', 'FAILED')),
      escrow_transaction_id UUID REFERENCES escrow_transactions(id),
      correlation_id UUID NOT NULL,
      error_message VARCHAR(500),
      received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
      processed_at TIMESTAMPTZ,
      UNIQUE (provider, idempotency_key)
    );
    CREATE INDEX webhook_logs_received_idx ON webhook_logs(received_at DESC);

    ALTER TABLE orders ADD COLUMN IF NOT EXISTS escrow_state VARCHAR(32) NOT NULL DEFAULT 'INITIATED'
      CHECK (escrow_state IN ('INITIATED', 'PAYMENT_PENDING', 'HELD_IN_ESCROW',
        'DISBURSEMENT_PENDING', 'RELEASED', 'DISPUTED', 'REFUNDED', 'FAILED'));

    INSERT INTO escrow_transactions
      (order_id, transaction_ref, buyer_user_id, seller_id, collection_provider,
       amount, currency, platform_fee, payout_amount, status, collection_reference,
       encrypted_collection_destination, collection_msisdn_last4, initiated_at,
       held_at, released_at, refunded_at)
    SELECT ea.order_id, uuid_generate_v4(), ea.customer_user_id, o.awarded_supplier_id, 'BANK',
           ea.amount, 'ZMW', ea.platform_fee_amount,
           COALESCE(ea.supplier_payout_amount, ea.amount),
           CASE ea.status WHEN 'funded' THEN 'HELD_IN_ESCROW'
             WHEN 'released' THEN 'RELEASED' WHEN 'refunded' THEN 'REFUNDED'
             ELSE 'INITIATED' END,
           'LEGACY-' || ea.id::text, 'legacy-destination-unavailable', '----',
           COALESCE(ea.funded_at, now()), ea.funded_at, ea.released_at,
           CASE WHEN ea.status='refunded' THEN now() END
    FROM escrow_accounts ea JOIN orders o ON o.id=ea.order_id
    WHERE NOT EXISTS (SELECT 1 FROM escrow_transactions et WHERE et.order_id=ea.order_id);

    UPDATE orders o SET escrow_state = et.status
    FROM escrow_transactions et WHERE et.order_id=o.id;
  `);
};

exports.down = pgm => {
  pgm.sql(`
    ALTER TABLE orders DROP COLUMN IF EXISTS escrow_state;
    DROP TABLE IF EXISTS webhook_logs;
    DROP TABLE IF EXISTS escrow_state_transitions;
    DROP TRIGGER IF EXISTS escrow_transactions_state_guard ON escrow_transactions;
    DROP FUNCTION IF EXISTS enforce_escrow_state_transition();
    DROP TABLE IF EXISTS escrow_transactions;
    DROP TABLE IF EXISTS payout_accounts;
    ALTER TABLE supplier_users DROP COLUMN IF EXISTS wallet_tier;
    ALTER TABLE supplier_users DROP COLUMN IF EXISTS phone_number;
    ALTER TABLE tenant_users DROP COLUMN IF EXISTS wallet_tier;
    ALTER TABLE tenant_users DROP COLUMN IF EXISTS phone_number;
  `);
};
