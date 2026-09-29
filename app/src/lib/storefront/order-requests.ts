export const ORDER_REQUEST_TYPES = ['return', 'damaged', 'wrong_item', 'not_received', 'other'] as const
export type OrderRequestType = (typeof ORDER_REQUEST_TYPES)[number]

export const ORDER_REQUEST_STATUSES = ['new', 'reviewing', 'approved', 'rejected', 'refunded', 'closed'] as const
export type OrderRequestStatus = (typeof ORDER_REQUEST_STATUSES)[number]

export const ORDER_REQUEST_TYPE_LABELS: Record<OrderRequestType, string> = {
  return: 'Return an item',
  damaged: 'Arrived damaged',
  wrong_item: 'Wrong item',
  not_received: 'Not received',
  other: 'Something else',
}

/** Wording staff see. */
export const ORDER_REQUEST_STATUS_LABELS: Record<OrderRequestStatus, string> = {
  new: 'New',
  reviewing: 'Reviewing',
  approved: 'Approved',
  rejected: 'Rejected',
  refunded: 'Refunded',
  closed: 'Closed',
}

/** Wording the customer sees. */
export const ORDER_REQUEST_CUSTOMER_LABELS: Record<OrderRequestStatus, string> = {
  new: 'Received',
  reviewing: 'Under review',
  approved: 'Approved',
  rejected: 'Not approved',
  refunded: 'Refunded',
  closed: 'Closed',
}

export const ORDER_REQUEST_TRANSITIONS: Record<OrderRequestStatus, OrderRequestStatus[]> = {
  new: ['reviewing', 'approved', 'rejected', 'closed'],
  reviewing: ['approved', 'rejected', 'closed'],
  approved: ['refunded', 'closed'],
  rejected: [],
  refunded: [],
  closed: [],
}

export const OPEN_ORDER_REQUEST_STATUSES: OrderRequestStatus[] = ['new', 'reviewing', 'approved']

/** Order statuses a customer may raise a request on. */
export const ORDER_REQUEST_ELIGIBLE_ORDER_STATUSES = ['paid', 'processing', 'shipped', 'delivered']

/** These types need at least one photo. */
export const ORDER_REQUEST_PHOTO_REQUIRED: OrderRequestType[] = ['damaged', 'wrong_item']

export const ORDER_REQUEST_MAX_PHOTOS = 4
export const ORDER_REQUEST_MAX_PHOTO_BYTES = 5 * 1024 * 1024
export const ORDER_REQUEST_PHOTO_TYPES = ['image/jpeg', 'image/png', 'image/webp']
export const ORDER_REQUEST_MIN_MESSAGE = 10
export const ORDER_REQUEST_MAX_MESSAGE = 2000
export const ORDER_REQUEST_MAX_REPLY = 2000

export function isOrderRequestType(value: unknown): value is OrderRequestType {
  return typeof value === 'string' && (ORDER_REQUEST_TYPES as readonly string[]).includes(value)
}

export function isOrderRequestStatus(value: unknown): value is OrderRequestStatus {
  return typeof value === 'string' && (ORDER_REQUEST_STATUSES as readonly string[]).includes(value)
}

export function isOpenOrderRequest(status: string) {
  return (OPEN_ORDER_REQUEST_STATUSES as string[]).includes(status)
}

export function canMoveOrderRequest(from: string, to: string) {
  if (!isOrderRequestStatus(from) || !isOrderRequestStatus(to)) return false
  return ORDER_REQUEST_TRANSITIONS[from].includes(to)
}

export function canRaiseOrderRequest(orderStatus: string) {
  return ORDER_REQUEST_ELIGIBLE_ORDER_STATUSES.includes(orderStatus)
}

/** Returns an error message, or null when the request is valid. */
export function validateOrderRequestInput(input: { type: unknown; message: unknown; photoCount: number }) {
  if (!isOrderRequestType(input.type)) return 'Choose what happened.'
  const message = typeof input.message === 'string' ? input.message.trim() : ''
  if (message.length < ORDER_REQUEST_MIN_MESSAGE) return `Tell us a bit more (at least ${ORDER_REQUEST_MIN_MESSAGE} characters).`
  if (message.length > ORDER_REQUEST_MAX_MESSAGE) return `Keep it under ${ORDER_REQUEST_MAX_MESSAGE} characters.`
  if (input.photoCount > ORDER_REQUEST_MAX_PHOTOS) return `Add up to ${ORDER_REQUEST_MAX_PHOTOS} photos.`
  if (ORDER_REQUEST_PHOTO_REQUIRED.includes(input.type) && input.photoCount < 1) return 'Add at least one photo of the item.'
  return null
}

export type OrderRequestView = {
  id: string
  requestNo: string
  orderId: string
  orderRef: string
  orderStatus: string
  salesChannel: string
  customerEmail: string
  customerName: string | null
  type: OrderRequestType
  status: OrderRequestStatus
  message: string
  staffReply: string | null
  photos: string[]
  createdAt: string
  updatedAt: string
}
