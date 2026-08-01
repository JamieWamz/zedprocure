export type PaymentProvider = 'MTN' | 'AIRTEL' | 'BANK';
export type EscrowStatus =
  | 'INITIATED'
  | 'PAYMENT_PENDING'
  | 'HELD_IN_ESCROW'
  | 'DISBURSEMENT_PENDING'
  | 'RELEASED'
  | 'DISPUTED'
  | 'REFUNDED'
  | 'FAILED';
export type ProviderOutcome = 'PENDING' | 'SUCCEEDED' | 'FAILED';
export type PaymentOperation = 'collection' | 'disbursement';

export interface MoneyRequest {
  amount: string;
  currency: 'ZMW';
}

export interface CollectionRequest extends MoneyRequest {
  orderId: string;
  destination: string;
  reference: string;
  description: string;
}

export interface DisbursementRequest extends CollectionRequest {
  bankCode?: string | null;
}

export interface ProviderAcknowledgement {
  reference: string;
  status?: string;
  raw?: Record<string, unknown>;
}

export interface ProviderQueryResult {
  status: ProviderOutcome;
  raw: Record<string, unknown>;
}

export interface NormalizedWebhookEvent {
  reference: string;
  operation: PaymentOperation;
  status: ProviderOutcome;
  eventType: string;
  failureCode: string | null;
  failureMessage: string | null;
}

export interface PaymentProviderAdapter {
  collect(request: CollectionRequest): Promise<ProviderAcknowledgement>;
  disburse(request: DisbursementRequest): Promise<ProviderAcknowledgement>;
  queryTransaction(reference: string, operation: PaymentOperation): Promise<ProviderQueryResult>;
}

export interface EscrowApiResponse {
  escrowTransactionId: string;
  transactionRef: string;
  providerReference: string;
  status: EscrowStatus;
  operation?: 'RELEASE' | 'REFUND';
}
