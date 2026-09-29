import { describe, expect, it, vi } from 'vitest'
import { orderEventRow, recordOrderEvent } from './order-events'
import { hasShipmentDetails, isOwnDelivery, OWN_DELIVERY_LABEL } from './delivery'

describe('orderEventRow', () => {
  it('keeps the previous status only when the status really changed', () => {
    const row = orderEventRow({ orderId: 'o1', eventType: 'status_changed', actorType: 'staff', fromStatus: 'paid', toStatus: 'processing' })
    expect(row).toMatchObject({ order_id: 'o1', from_status: 'paid', to_status: 'processing', actor_type: 'staff' })
    expect(orderEventRow({ orderId: 'o1', eventType: 'shipping_updated', actorType: 'staff', fromStatus: 'shipped', toStatus: 'shipped' }).from_status).toBeNull()
  })

  it('trims long notes and labels', () => {
    const row = orderEventRow({ orderId: 'o1', eventType: 'note', actorType: 'staff', note: 'x'.repeat(900), actorLabel: 'y'.repeat(300) })
    expect(row.note).toHaveLength(500)
    expect(row.actor_label).toHaveLength(160)
  })
})

describe('recordOrderEvent', () => {
  it('never throws, even when the history table is missing', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined)
    const failing = { from: () => ({ insert: async () => ({ error: { message: 'relation does not exist' } }) }) }
    const broken = { from: () => { throw new Error('boom') } }
    await expect(recordOrderEvent(failing, { orderId: 'o1', eventType: 'created', actorType: 'customer' })).resolves.toBeUndefined()
    await expect(recordOrderEvent(broken, { orderId: 'o1', eventType: 'created', actorType: 'customer' })).resolves.toBeUndefined()
    warn.mockRestore()
  })
})

describe('own delivery', () => {
  it('counts our own team as a real shipment, like a tracking number', () => {
    expect(isOwnDelivery(OWN_DELIVERY_LABEL)).toBe(true)
    expect(isOwnDelivery('J&T Express')).toBe(false)
    expect(hasShipmentDetails({ shipping_courier_name: OWN_DELIVERY_LABEL })).toBe(true)
    expect(hasShipmentDetails({ shipping_tracking_no: 'JT1', shipping_courier_name: 'J&T Express' })).toBe(true)
    expect(hasShipmentDetails({ easyparcel_order_no: 'EI-1' })).toBe(true)
    expect(hasShipmentDetails({ shipping_courier_name: 'J&T Express — Standard' })).toBe(false)
  })
})
