// ── Payment Gateway Types ──────────────────────────────────────────
// Shared types for the payment adapter layer.
// Extracted to avoid circular dependencies between index.ts and providers.

export interface PaymentIntentInput {
  orderId: string
  orderRef: string
  amount: number          // in MYR (or currency unit)
  currency: string
  customerName: string
  customerEmail: string
  customerPhone: string
  description: string
  returnUrl: string       // where user lands after payment
  callbackUrl: string     // server-side webhook endpoint
}

export interface PaymentIntentResult {
  success: boolean
  provider: string
  paymentUrl?: string     // redirect user here
  paymentRef?: string     // provider's payment/bill ID
  error?: string
}

export interface PaymentCallbackResult {
  verified: boolean
  orderId: string
  paid: boolean
  transactionId?: string
  error?: string
}

export interface PaymentProviderAdapter {
  name: string
  createPayment: (input: PaymentIntentInput, credentials: Record<string, string>) => Promise<PaymentIntentResult>
  verifyCallback: (payload: Record<string, string>, credentials: Record<string, string>) => Promise<PaymentCallbackResult>
}
