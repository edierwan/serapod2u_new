import { readFileSync } from 'node:fs'
import path from 'node:path'
import { describe, expect, it } from 'vitest'

const repoFile = (relativePath: string) =>
  readFileSync(path.resolve(__dirname, '../../../../', relativePath), 'utf8')

const dialog = repoFile('app/src/components/dashboard/views/orders/OrderDocumentsDialogEnhanced.tsx')
const ordersApprove = repoFile('supabase/migrations/20260824150000_serapp_close_hold_on_orders_approve.sql')

describe('A D2H order opens on its own workflow, never on a Purchase Order', () => {
  const availableTabs = dialog.slice(
    dialog.indexOf('const availableTabs = useMemo'),
    dialog.indexOf('const defaultTab = availableTabs[0]')
  )

  it('offers SO -> DO -> Invoice -> Payment -> Receipt for D2H and S2D', () => {
    expect(availableTabs).toContain("orderData?.order_type === 'D2H' || orderData?.order_type === 'S2D'")
    expect(availableTabs).toContain("return ['so', 'do', 'invoice', 'payment', 'receipt']")
  })

  it('never puts a purchase order in the D2H tab set', () => {
    const d2hBranch = availableTabs.slice(
      availableTabs.indexOf("=== 'D2H'"),
      availableTabs.indexOf('if (is50_50Split)')
    )
    expect(d2hBranch).not.toContain("'po'")
  })

  it('pulls the selected tab back into the workflow when it is not part of it', () => {
    expect(dialog).toContain('if (!availableTabs.includes(activeTab))')
    expect(dialog).toContain('setActiveTab(defaultTab)')
  })

  it('does not mount the Purchase Order panel for a workflow without one', () => {
    // This is the guard that stops "Purchase Order not yet created" from
    // rendering under a D2H sales order.
    expect(dialog).toContain("{availableTabs.includes('po') && (")
    expect(dialog).toContain("{availableTabs.includes('so') && (")
    expect(dialog).toContain("{availableTabs.includes('do') && (")
  })

  it('keeps the Sales Order panel driven by the SO document alone', () => {
    const soPanel = dialog.slice(
      dialog.indexOf("{availableTabs.includes('so') && ("),
      dialog.indexOf('{/* DO Tab */}')
    )
    expect(soPanel).toContain('{documents.so ? (')
    expect(soPanel).toContain('Sales Order Details')
    expect(soPanel).toContain('Download SO PDF')
    expect(soPanel).toContain('<AcknowledgeButton')
    // The sales order view must not consult the purchase order in any way.
    expect(soPanel).not.toContain('documents.po')
    expect(soPanel).not.toContain('Purchase Order')
  })
})

describe('D2H approval never creates a Purchase Order', () => {
  it('issues SO, DO and Invoice from the seller to the buyer', () => {
    const d2hBranch = ordersApprove.slice(
      ordersApprove.indexOf("IF v.order_type IN ('D2H','S2D') THEN\n    IF NOT EXISTS"),
      ordersApprove.indexOf('  ELSE\n    IF NOT EXISTS(SELECT 1 FROM public.documents WHERE order_id=v.id AND doc_type=\'PO\')')
    )
    expect(d2hBranch).toContain("'SO'")
    expect(d2hBranch).toContain("'DO'")
    expect(d2hBranch).toContain("'INVOICE'")
    expect(d2hBranch).not.toContain("'PO'")
    // Issued by the seller (HQ) to the buyer (distributor).
    expect(d2hBranch).toContain('v.seller_org_id,v.buyer_org_id')
  })

  it('creates a Purchase Order only on the non-D2H branch', () => {
    const poBranch = ordersApprove.slice(ordersApprove.indexOf("doc_type='PO'"))
    expect(poBranch).toContain("'PO','PO-'||v.order_no")
  })
})
