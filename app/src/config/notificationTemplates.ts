export type Channel = 'whatsapp' | 'sms' | 'email';
export type NotificationKey =
    | 'order_approved'
    | 'order_rejected'
    | 'order_submitted'
    | 'order_closed'
    | 'order_deleted'
    | 'manufacturer_scan_complete'
    | 'low_stock_alert'
    | 'out_of_stock'
    | 'stock_received'
    | 'qr_activated'
    | 'points_awarded'
    | 'lucky_draw_entry'
    | 'redemption_completed'
    | 'user_created'
    | 'user_activated'
    | 'user_deactivated'
    | 'password_changed'
    | 'password_reset_request'
    | 'login_suspicious'
    | 'po_created'
    | 'po_acknowledged'
    | 'invoice_created'
    | 'invoice_acknowledged'
    | 'balance_request_created'
    | 'payment_received'
    | 'balance_payment_received'
    | 'receipt_issued'
    | 'generic';

export interface Template {
    id: string;
    name: string;
    description?: string;
    channel: Channel;
    subject?: string; // For email
    body: string;
}

export const notificationTemplates: Record<string, Template[]> = {

    // ══════════════════════════════════════════════════════════
    // ORDER STATUS CHANGES
    // ══════════════════════════════════════════════════════════

    'order_submitted': [
        {
            id: 'os_wa_1',
            name: 'Quick Approval Alert',
            description: 'Concise notification for fast action',
            channel: 'whatsapp',
            body: `📋 *New Order Pending Approval*\n\n*Order:* #{{order_no}}\n*Date:* {{order_date}}\n*Customer:* {{customer_name}}\n*Total:* RM {{amount}}\n\nThis order requires your review and approval.\n\n👉 {{order_url}}`
        },
        {
            id: 'os_wa_2',
            name: 'Detailed Order Summary',
            description: 'Comprehensive order details with product breakdown',
            channel: 'whatsapp',
            body: `📦 *Order Submitted — Approval Required*\n━━━━━━━━━━━━━━━━━━\n\n*Order No:* #{{order_no}}\n*Date:* {{order_date}}\n*Status:* Pending Approval\n\n👤 *Customer Details*\n• Name: {{customer_name}}\n• Phone: {{customer_phone}}\n• Delivery: {{delivery_address}}\n\n🛒 *Order Items*\n{{item_list}}\n\n💰 *Order Total:* RM {{amount}}\n• Cases: {{total_cases}}\n• Items: {{total_items}} product(s)\n\n⏳ This order is awaiting your approval.\nPlease review and take action.\n\n🔗 {{order_url}}`
        },
        {
            id: 'os_wa_3',
            name: 'Executive Brief',
            description: 'Short executive-level summary for busy approvers',
            channel: 'whatsapp',
            body: `🔔 *Action Required*\n\nOrder *#{{order_no}}* from *{{customer_name}}* for *RM {{amount}}* needs your approval.\n\nSubmitted: {{order_date}}\nItems: {{total_items}} product(s) · {{total_cases}} case(s)\n\nApprove now → {{order_url}}`
        },
        {
            id: 'os_sms_1',
            name: 'SMS Approval Alert',
            description: 'Short SMS notification',
            channel: 'sms',
            body: `[Serapod2U] Order #{{order_no}} submitted by {{customer_name}} for RM {{amount}} needs approval. Review: {{order_url}}`
        },
        {
            id: 'os_email_1',
            name: 'Formal Order Submission',
            description: 'Professional email with full order details',
            channel: 'email',
            subject: 'Order #{{order_no}} — Pending Your Approval',
            body: `Dear Approver,\n\nA new order has been submitted and requires your review.\n\nOrder Number: {{order_no}}\nDate: {{order_date}}\nCustomer: {{customer_name}}\nPhone: {{customer_phone}}\nDelivery Address: {{delivery_address}}\n\nOrder Items:\n{{item_list}}\n\nTotal Amount: RM {{amount}}\nTotal Cases: {{total_cases}}\n\nPlease review and approve or reject this order at your earliest convenience.\n\n{{order_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'order_approved': [
        {
            id: 'oa_wa_1',
            name: 'Approval Confirmation',
            description: 'Professional approval notification with details',
            channel: 'whatsapp',
            body: `✅ *Order Approved*\n━━━━━━━━━━━━━━━━━━\n\n*Order No:* #{{order_no}}\n*Date:* {{order_date}}\n*Status:* Approved ✓\n\n👤 *Customer:* {{customer_name}}\n💰 *Total:* RM {{amount}}\n📦 *Items:* {{total_items}} product(s) · {{total_cases}} case(s)\n\n✍️ *Approved by:* {{approved_by}}\n🕐 *Approved at:* {{approved_at}}\n\nThis order is now being processed.\n\n🔗 {{order_url}}`
        },
        {
            id: 'oa_wa_2',
            name: 'Quick Approval Notice',
            description: 'Brief approval alert',
            channel: 'whatsapp',
            body: `✅ Order *#{{order_no}}* has been *approved* by {{approved_by}}.\n\nCustomer: {{customer_name}}\nAmount: RM {{amount}}\n\n🔗 {{order_url}}`
        },
        {
            id: 'oa_wa_3',
            name: 'Full Approval Summary',
            description: 'Detailed approval with item breakdown',
            channel: 'whatsapp',
            body: `✅ *Order Approved — Ready for Processing*\n━━━━━━━━━━━━━━━━━━\n\n*Order No:* #{{order_no}}\n*Approved by:* {{approved_by}}\n*Date:* {{approved_at}}\n\n👤 *Customer Details*\n• Name: {{customer_name}}\n• Phone: {{customer_phone}}\n• Delivery: {{delivery_address}}\n\n🛒 *Order Items*\n{{item_list}}\n\n💰 *Order Total:* RM {{amount}}\n📦 Cases: {{total_cases}} · Items: {{total_items}}\n\nThe order has been approved and will proceed to fulfilment.\n\n🔗 {{order_url}}`
        },
        {
            id: 'oa_sms_1',
            name: 'SMS Approval Alert',
            description: 'Short SMS approval notification',
            channel: 'sms',
            body: `[Serapod2U] Order #{{order_no}} APPROVED by {{approved_by}}. Amount: RM {{amount}}. View: {{order_url}}`
        },
        {
            id: 'oa_email_1',
            name: 'Official Approval Email',
            description: 'Formal email approval notification',
            channel: 'email',
            subject: 'Order #{{order_no}} — Approved',
            body: `Dear Team,\n\nOrder #{{order_no}} has been approved.\n\nApproved by: {{approved_by}}\nApproval Date: {{approved_at}}\n\nCustomer: {{customer_name}}\nPhone: {{customer_phone}}\nDelivery Address: {{delivery_address}}\n\nOrder Items:\n{{item_list}}\n\nTotal Amount: RM {{amount}}\nTotal Cases: {{total_cases}}\n\nThe order is now being processed for fulfilment.\n\n{{order_url}}\n\nRegards,\nSerapod2U System`
        },
        {
            id: 'oa_wa_mfg_1',
            name: 'Manufacturer — QR Generation Ready',
            description: 'Designed for manufacturer: order approved, ready for QR generation and printing',
            channel: 'whatsapp',
            body: `🏭 *Order Approved — Ready for QR Generation*\n━━━━━━━━━━━━━━━━━━\n\n*Order No:* #{{order_no}}\n*Date:* {{order_date}}\n*Approved by:* {{approved_by}}\n\n📦 *Order Details*\n• Customer: {{customer_name}}\n• Items: {{total_items}} product(s) · {{total_cases}} case(s)\n• Total: RM {{amount}}\n\n📌 *Action Required:*\n1️⃣ Go to *QR Batches* section\n2️⃣ Generate QR codes for this order\n3️⃣ Download the Excel file for printing\n4️⃣ Complete the manufacturing scan process\n\nOnce all QR codes are scanned and packed, the batch will be marked as ready for shipment.\n\n🔗 {{order_url}}`
        },
        {
            id: 'oa_wa_mfg_2',
            name: 'Manufacturer — Quick QR Alert',
            description: 'Brief manufacturer notification about QR generation',
            channel: 'whatsapp',
            body: `🏭 Order *#{{order_no}}* approved!\n\n📦 {{total_cases}} cases · {{total_items}} items\n💰 RM {{amount}}\n\n✅ Go to *QR Batches* → Generate QR codes → Download Excel for printing.\n\n🔗 {{order_url}}`
        },
        {
            id: 'oa_email_mfg_1',
            name: 'Manufacturer Approval Email',
            description: 'Email for manufacturer with QR generation instructions',
            channel: 'email',
            subject: 'Order #{{order_no}} Approved — QR Generation Ready',
            body: `Dear Manufacturer,\n\nOrder #{{order_no}} has been approved and is ready for QR code generation.\n\nApproved by: {{approved_by}}\nApproval Date: {{approved_at}}\n\nCustomer: {{customer_name}}\nTotal Items: {{total_items}}\nTotal Cases: {{total_cases}}\nAmount: RM {{amount}}\n\nNext Steps:\n1. Go to QR Batches section\n2. Generate QR codes for this order\n3. Download the Excel file for printing\n4. Complete the manufacturing scan process\n\nOnce complete, the batch will be marked as ready for shipment.\n\n{{order_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'order_closed': [
        {
            id: 'oc_wa_1',
            name: 'Order Completion Notice',
            description: 'Professional order closure notification',
            channel: 'whatsapp',
            body: `🏁 *Order Completed*\n━━━━━━━━━━━━━━━━━━\n\n*Order No:* #{{order_no}}\n*Status:* Closed ✓\n*Closed at:* {{closed_at}}\n\n👤 *Customer:* {{customer_name}}\n💰 *Total:* RM {{amount}}\n📦 *Items:* {{total_items}} product(s) · {{total_cases}} case(s)\n\nThis order has been fully completed. All documents have been processed and payments settled.\n\n🔗 {{order_url}}`
        },
        {
            id: 'oc_wa_2',
            name: 'Quick Closed Alert',
            description: 'Brief closure notification',
            channel: 'whatsapp',
            body: `🏁 Order *#{{order_no}}* is now *closed*.\n\nCustomer: {{customer_name}}\nTotal: RM {{amount}}\nClosed: {{closed_at}}\n\nAll processes completed successfully.`
        },
        {
            id: 'oc_sms_1',
            name: 'SMS Closed Alert',
            description: 'Short SMS notification',
            channel: 'sms',
            body: `[Serapod2U] Order #{{order_no}} is now CLOSED. Total: RM {{amount}}. All documents processed.`
        },
        {
            id: 'oc_email_1',
            name: 'Order Closure Email',
            description: 'Formal closure email',
            channel: 'email',
            subject: 'Order #{{order_no}} — Completed & Closed',
            body: `Dear Team,\n\nOrder #{{order_no}} has been completed and closed.\n\nCustomer: {{customer_name}}\nTotal Amount: RM {{amount}}\nClosed at: {{closed_at}}\n\nOrder Items:\n{{item_list}}\n\nAll documents have been processed and payments settled. No further action is required.\n\n{{order_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'order_rejected': [
        {
            id: 'or_wa_1',
            name: 'Rejection / Cancellation Notice',
            description: 'Notification for rejected or cancelled orders',
            channel: 'whatsapp',
            body: `❌ *Order {{action}}*\n━━━━━━━━━━━━━━━━━━\n\n*Order No:* #{{order_no}}\n*Date:* {{order_date}}\n*Status:* {{status}}\n\n👤 *Customer:* {{customer_name}}\n💰 *Total:* RM {{amount}}\n\n📝 *Reason:* {{reason}}\n\nIf you have questions about this decision, please contact your administrator.\n\n🔗 {{order_url}}`
        },
        {
            id: 'or_wa_2',
            name: 'Quick Rejection Alert',
            description: 'Brief notification',
            channel: 'whatsapp',
            body: `❌ Order *#{{order_no}}* (RM {{amount}}) has been *{{status}}*.\n\nReason: {{reason}}\nCustomer: {{customer_name}}\n\nInventory allocation has been released.`
        },
        {
            id: 'or_sms_1',
            name: 'SMS Rejection Alert',
            description: 'Short SMS notification',
            channel: 'sms',
            body: `[Serapod2U] Order #{{order_no}} has been {{status}}. Reason: {{reason}}. Amount: RM {{amount}}.`
        },
        {
            id: 'or_email_1',
            name: 'Order Rejection Email',
            description: 'Formal rejection/cancellation email',
            channel: 'email',
            subject: 'Order #{{order_no}} — {{status}}',
            body: `Dear Team,\n\nOrder #{{order_no}} has been {{status}}.\n\nCustomer: {{customer_name}}\nOrder Date: {{order_date}}\nTotal Amount: RM {{amount}}\n\nReason: {{reason}}\n\nAny allocated inventory has been released back to stock.\n\nIf you have questions, please contact your administrator.\n\n{{order_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'order_deleted': [
        {
            id: 'od_wa_1',
            name: 'Order Deleted Alert',
            description: 'Notification when an order is permanently deleted',
            channel: 'whatsapp',
            body: `🗑️ *Order Permanently Deleted*\n━━━━━━━━━━━━━━━━━━\n\n*Order No:* #{{order_no}}\n*Previous Status:* {{status}}\n*Customer:* {{customer_name}}\n\n🔴 *Deleted by:* {{deleted_by}}\n🕐 *Deleted at:* {{deleted_at}}\n\nThis order and all related records (documents, QR codes, stock movements) have been permanently removed from the system.\n\nThis action cannot be undone.`
        },
        {
            id: 'od_wa_2',
            name: 'Quick Delete Notice',
            description: 'Brief deletion alert',
            channel: 'whatsapp',
            body: `🗑️ Order *#{{order_no}}* has been *permanently deleted* by {{deleted_by}}.\n\nCustomer: {{customer_name}}\nDeleted at: {{deleted_at}}`
        },
        {
            id: 'od_sms_1',
            name: 'SMS Delete Alert',
            channel: 'sms',
            body: `[Serapod2U] Order #{{order_no}} DELETED by {{deleted_by}} at {{deleted_at}}. All records permanently removed.`
        },
        {
            id: 'od_email_1',
            name: 'Order Deletion Email',
            channel: 'email',
            subject: 'Order #{{order_no}} — Permanently Deleted',
            body: `NOTICE: Order Permanently Deleted\n\nOrder #{{order_no}} has been permanently deleted from the system.\n\nCustomer: {{customer_name}}\nDeleted by: {{deleted_by}}\nDeleted at: {{deleted_at}}\n\nAll related records including documents, QR codes, and stock movements have been removed. This action cannot be undone.\n\nRegards,\nSerapod2U System`
        }
    ],

    'manufacturer_scan_complete': [
        {
            id: 'msc_wa_1',
            name: 'Production Complete — Admin',
            description: 'Notifies admin/HQ that manufacturing process is done',
            channel: 'whatsapp',
            body: `🏭 *Manufacturing Process Completed*\n━━━━━━━━━━━━━━━━━━\n\n*Order:* #{{order_no}}\n*Batch:* {{batch_id}}\n*Status:* Ready to Ship ✓\n\n📦 *Production Summary*\n• Master Cases: {{total_master_codes}}\n• Unique QR Codes: {{total_unique_codes}}\n• Completed at: {{production_completed_at}}\n• Completed by: {{completed_by}}\n\nAll QR codes have been packed and marked as ready for shipment. The batch is now awaiting warehouse receiving.\n\n🔗 {{order_url}}`
        },
        {
            id: 'msc_wa_2',
            name: 'Production Complete — Manufacturer',
            description: 'Template designed for manufacturer recipients with QR generation focus',
            channel: 'whatsapp',
            body: `✅ *Order Ready — QR Generation Complete*\n━━━━━━━━━━━━━━━━━━\n\nOrder *#{{order_no}}* has been manufactured and all QR codes are ready.\n\n📦 {{total_master_codes}} master cases packed\n📱 {{total_unique_codes}} unique QR codes generated\n🕐 Completed: {{production_completed_at}}\n\nThe batch is now marked as *ready to ship* and awaiting warehouse receiving.\n\nPlease coordinate with the logistics team for shipment.\n\n🔗 {{order_url}}`
        },
        {
            id: 'msc_wa_3',
            name: 'Quick Production Summary',
            description: 'Brief notification for quick awareness',
            channel: 'whatsapp',
            body: `🏭 Order *#{{order_no}}* — Manufacturing Complete!\n\n{{total_master_codes}} cases packed · {{total_unique_codes}} QR codes\nReady for shipment.\n\n🔗 {{order_url}}`
        },
        {
            id: 'msc_sms_1',
            name: 'SMS Production Complete',
            channel: 'sms',
            body: `[Serapod2U] Manufacturing complete: Order #{{order_no}} — {{total_master_codes}} cases, {{total_unique_codes}} QR codes. Ready to ship.`
        },
        {
            id: 'msc_email_1',
            name: 'Production Complete Email',
            channel: 'email',
            subject: 'Manufacturing Complete — Order #{{order_no}}',
            body: `Dear Team,\n\nThe manufacturing process for Order #{{order_no}} has been completed.\n\nBatch: {{batch_id}}\nMaster Cases: {{total_master_codes}}\nUnique QR Codes: {{total_unique_codes}}\nCompleted at: {{production_completed_at}}\nCompleted by: {{completed_by}}\n\nAll QR codes have been generated, packed, and marked as ready for shipment.\n\nPlease coordinate warehouse receiving and logistics.\n\n{{order_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    // ══════════════════════════════════════════════════════════
    // INVENTORY & STOCK ALERTS
    // ══════════════════════════════════════════════════════════

    'low_stock_alert': [
        {
            id: 'ls_wa_1',
            name: 'Low Stock Warning',
            description: 'Alert when stock reaches reorder point',
            channel: 'whatsapp',
            body: `⚠️ *Low Stock Alert*\n━━━━━━━━━━━━━━━━━━\n\n*Product:* {{product_name}}\n*Variant:* {{variant_name}}\n*SKU:* {{sku}}\n*Warehouse:* {{warehouse_name}}\n\n📊 *Stock Levels*\n• Available: {{available_qty}} units\n• Reorder Point: {{reorder_point}} units\n• Suggested Order: {{reorder_qty}} units\n\n⚡ Stock has dropped below the reorder threshold.\nPlease arrange replenishment to avoid stockouts.\n\n🔗 {{inventory_url}}`
        },
        {
            id: 'ls_wa_2',
            name: 'Quick Low Stock Alert',
            description: 'Brief alert for quick action',
            channel: 'whatsapp',
            body: `⚠️ *Low Stock:* {{product_name}} ({{variant_name}})\n\nOnly *{{available_qty}} units* remaining at {{warehouse_name}}.\nReorder point: {{reorder_point}} units\n\nPlease restock soon.`
        },
        {
            id: 'ls_sms_1',
            name: 'SMS Low Stock Alert',
            description: 'Short SMS alert',
            channel: 'sms',
            body: `[Serapod2U] LOW STOCK: {{product_name}} ({{variant_name}}) — {{available_qty}} units left. Reorder point: {{reorder_point}}. Restock recommended.`
        },
        {
            id: 'ls_email_1',
            name: 'Low Stock Email Alert',
            description: 'Detailed email for inventory managers',
            channel: 'email',
            subject: '⚠️ Low Stock Alert — {{product_name}} ({{variant_name}})',
            body: `Dear Inventory Manager,\n\nThis is an automated alert to inform you that the following product has reached its reorder point.\n\nProduct: {{product_name}}\nVariant: {{variant_name}}\nSKU: {{sku}}\nWarehouse: {{warehouse_name}}\n\nCurrent Stock Level: {{available_qty}} units\nReorder Point: {{reorder_point}} units\nSuggested Reorder Quantity: {{reorder_qty}} units\n\nPlease arrange replenishment at your earliest convenience to ensure uninterrupted supply.\n\n{{inventory_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'out_of_stock': [
        {
            id: 'oos_wa_1',
            name: 'Out of Stock Alert',
            description: 'Critical alert when stock reaches zero',
            channel: 'whatsapp',
            body: `🚨 *OUT OF STOCK*\n━━━━━━━━━━━━━━━━━━\n\n*Product:* {{product_name}}\n*Variant:* {{variant_name}}\n*SKU:* {{sku}}\n*Warehouse:* {{warehouse_name}}\n\n❌ *Available Stock: 0 units*\n\n🔴 This product is now out of stock.\nImmediate restocking is required to fulfil pending orders.\n\n🔗 {{inventory_url}}`
        },
        {
            id: 'oos_sms_1',
            name: 'SMS Out of Stock',
            description: 'Urgent SMS notification',
            channel: 'sms',
            body: `[Serapod2U] URGENT: {{product_name}} ({{variant_name}}) is OUT OF STOCK at {{warehouse_name}}. Immediate restock needed.`
        },
        {
            id: 'oos_email_1',
            name: 'Out of Stock Email',
            description: 'Critical stock depletion email',
            channel: 'email',
            subject: '🚨 Out of Stock — {{product_name}} ({{variant_name}})',
            body: `URGENT: Stock Depletion Notice\n\nProduct: {{product_name}}\nVariant: {{variant_name}}\nSKU: {{sku}}\nWarehouse: {{warehouse_name}}\n\nStatus: OUT OF STOCK (0 units available)\n\nThis product is no longer available for fulfilment. Please arrange immediate restocking.\n\n{{inventory_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'stock_received': [
        {
            id: 'sr_wa_1',
            name: 'Stock Received Confirmation',
            description: 'Confirmation when new stock is received',
            channel: 'whatsapp',
            body: `📦 *Stock Received*\n━━━━━━━━━━━━━━━━━━\n\n*Product:* {{product_name}}\n*Variant:* {{variant_name}}\n*Warehouse:* {{warehouse_name}}\n\n📥 *Received:* {{quantity_received}} units\n📊 *New Total:* {{total_on_hand}} units\n\n✅ Stock has been successfully received and inventory updated.`
        },
        {
            id: 'sr_sms_1',
            name: 'SMS Stock Received',
            description: 'Brief SMS confirmation',
            channel: 'sms',
            body: `[Serapod2U] Stock received: {{product_name}} — {{quantity_received}} units. Total now: {{total_on_hand}} units.`
        },
        {
            id: 'sr_email_1',
            name: 'Stock Received Email',
            description: 'Receiving confirmation email',
            channel: 'email',
            subject: 'Stock Received — {{product_name}} ({{variant_name}})',
            body: `Dear Team,\n\nNew stock has been received and inventory has been updated.\n\nProduct: {{product_name}}\nVariant: {{variant_name}}\nWarehouse: {{warehouse_name}}\n\nQuantity Received: {{quantity_received}} units\nNew Total On Hand: {{total_on_hand}} units\n\n{{inventory_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    // ══════════════════════════════════════════════════════════
    // QR CODE & CONSUMER ACTIVITIES
    // ══════════════════════════════════════════════════════════

    'qr_activated': [
        {
            id: 'qa_wa_1',
            name: 'QR Activation Alert',
            description: 'Notification when a QR code is scanned/activated',
            channel: 'whatsapp',
            body: `📱 *QR Code Activated*\n━━━━━━━━━━━━━━━━━━\n\n*Product:* {{product_name}}\n*Variant:* {{variant_name}}\n*QR Code:* {{qr_code}}\n*Location:* {{scan_location}}\n*Scanned at:* {{scanned_at}}\n\n✅ A consumer has successfully scanned and activated this QR code.`
        },
        {
            id: 'qa_sms_1',
            name: 'SMS QR Activation',
            description: 'Brief SMS alert',
            channel: 'sms',
            body: `[Serapod2U] QR scan: {{product_name}} — Code {{qr_code}} activated at {{scanned_at}}.`
        },
        {
            id: 'qa_email_1',
            name: 'QR Activation Email',
            description: 'Detailed QR activation email',
            channel: 'email',
            subject: 'QR Code Activated — {{product_name}}',
            body: `A QR code has been activated.\n\nProduct: {{product_name}}\nVariant: {{variant_name}}\nQR Code: {{qr_code}}\nScan Location: {{scan_location}}\nActivated At: {{scanned_at}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'points_awarded': [
        {
            id: 'pa_wa_1',
            name: 'Points Awarded Alert',
            description: 'Notification when loyalty points are earned',
            channel: 'whatsapp',
            body: `⭐ *Points Awarded*\n━━━━━━━━━━━━━━━━━━\n\n*Consumer:* {{consumer_name}}\n*Phone:* {{consumer_phone}}\n*Product:* {{product_name}}\n\n🎯 *Points Earned:* {{points_earned}}\n📊 *Total Balance:* {{total_points}}\n\nA consumer has earned loyalty points through a QR code scan.`
        },
        {
            id: 'pa_sms_1',
            name: 'SMS Points Alert',
            description: 'Short SMS notification',
            channel: 'sms',
            body: `[Serapod2U] {{consumer_name}} earned {{points_earned}} points for {{product_name}}. Total: {{total_points}} pts.`
        },
        {
            id: 'pa_email_1',
            name: 'Points Award Email',
            description: 'Points earned notification email',
            channel: 'email',
            subject: 'Points Awarded — {{consumer_name}}',
            body: `A consumer has earned loyalty points.\n\nConsumer: {{consumer_name}}\nPhone: {{consumer_phone}}\nProduct: {{product_name}}\n\nPoints Earned: {{points_earned}}\nTotal Balance: {{total_points}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'lucky_draw_entry': [
        {
            id: 'ld_wa_1',
            name: 'Lucky Draw Entry Alert',
            description: 'Notification when a lucky draw entry is submitted',
            channel: 'whatsapp',
            body: `🎰 *Lucky Draw Entry*\n━━━━━━━━━━━━━━━━━━\n\n*Consumer:* {{consumer_name}}\n*Phone:* {{consumer_phone}}\n*Product:* {{product_name}}\n*Entry No:* {{entry_number}}\n\n🎟️ A new lucky draw entry has been submitted through a QR code scan.\n*Entry Status:* {{entry_status}}`
        },
        {
            id: 'ld_sms_1',
            name: 'SMS Lucky Draw Alert',
            description: 'Short SMS notification',
            channel: 'sms',
            body: `[Serapod2U] Lucky draw entry by {{consumer_name}} for {{product_name}}. Entry: {{entry_number}}.`
        },
        {
            id: 'ld_email_1',
            name: 'Lucky Draw Entry Email',
            description: 'Lucky draw entry notification email',
            channel: 'email',
            subject: 'New Lucky Draw Entry — {{entry_number}}',
            body: `A new lucky draw entry has been submitted.\n\nConsumer: {{consumer_name}}\nPhone: {{consumer_phone}}\nProduct: {{product_name}}\nEntry Number: {{entry_number}}\nStatus: {{entry_status}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'redemption_completed': [
        {
            id: 'rc_wa_1',
            name: 'Redemption Completed Alert',
            description: 'Notification when a reward is redeemed',
            channel: 'whatsapp',
            body: `🎁 *Reward Redeemed*\n━━━━━━━━━━━━━━━━━━\n\n*Consumer:* {{consumer_name}}\n*Phone:* {{consumer_phone}}\n*Reward:* {{reward_name}}\n*Points Used:* {{points_used}}\n*Remaining Balance:* {{remaining_points}}\n\n✅ Redemption completed successfully.`
        },
        {
            id: 'rc_sms_1',
            name: 'SMS Redemption Alert',
            description: 'Short SMS notification',
            channel: 'sms',
            body: `[Serapod2U] Redemption: {{consumer_name}} redeemed {{reward_name}} using {{points_used}} pts. Balance: {{remaining_points}}.`
        },
        {
            id: 'rc_email_1',
            name: 'Redemption Completed Email',
            description: 'Redemption confirmation email',
            channel: 'email',
            subject: 'Reward Redeemed — {{consumer_name}}',
            body: `A reward has been redeemed.\n\nConsumer: {{consumer_name}}\nPhone: {{consumer_phone}}\nReward: {{reward_name}}\nPoints Used: {{points_used}}\nRemaining Balance: {{remaining_points}}\n\nRegards,\nSerapod2U System`
        }
    ],

    // ══════════════════════════════════════════════════════════
    // USER ACCOUNT ACTIVITIES
    // ══════════════════════════════════════════════════════════

    'user_created': [
        {
            id: 'uc_wa_1',
            name: 'New User Created',
            description: 'Alert when a new user account is created',
            channel: 'whatsapp',
            body: `👤 *New User Account Created*\n━━━━━━━━━━━━━━━━━━\n\n*Name:* {{user_name}}\n*Email:* {{user_email}}\n*Role:* {{user_role}}\n*Created at:* {{created_at}}\n\nA new user has been added to your organization.`
        },
        {
            id: 'uc_sms_1',
            name: 'SMS New User Alert',
            description: 'Brief SMS alert',
            channel: 'sms',
            body: `[Serapod2U] New user created: {{user_name}} ({{user_email}}) with role {{user_role}}.`
        },
        {
            id: 'uc_email_1',
            name: 'New User Email',
            description: 'New user creation email',
            channel: 'email',
            subject: 'New User Account — {{user_name}}',
            body: `A new user account has been created.\n\nName: {{user_name}}\nEmail: {{user_email}}\nRole: {{user_role}}\nCreated At: {{created_at}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'user_activated': [
        {
            id: 'ua_wa_1',
            name: 'Account Activated',
            description: 'Notification when user account is activated',
            channel: 'whatsapp',
            body: `✅ *Account Activated*\n\n*User:* {{user_name}}\n*Email:* {{user_email}}\n*Activated at:* {{activated_at}}\n\nThis user account is now active and can access the system.`
        },
        {
            id: 'ua_sms_1',
            name: 'SMS Account Activated',
            channel: 'sms',
            body: `[Serapod2U] Account activated: {{user_name}} ({{user_email}}) is now active.`
        },
        {
            id: 'ua_email_1',
            name: 'Account Activation Email',
            channel: 'email',
            subject: 'Account Activated — {{user_name}}',
            body: `User account has been activated.\n\nName: {{user_name}}\nEmail: {{user_email}}\nActivated At: {{activated_at}}\n\nThe user can now access the system.\n\nRegards,\nSerapod2U System`
        }
    ],

    'user_deactivated': [
        {
            id: 'ud_wa_1',
            name: 'Account Deactivated',
            description: 'Alert when a user account is deactivated',
            channel: 'whatsapp',
            body: `🚫 *Account Deactivated*\n\n*User:* {{user_name}}\n*Email:* {{user_email}}\n*Deactivated at:* {{deactivated_at}}\n\nThis user account has been deactivated and can no longer access the system.`
        },
        {
            id: 'ud_sms_1',
            name: 'SMS Account Deactivated',
            channel: 'sms',
            body: `[Serapod2U] Account deactivated: {{user_name}} ({{user_email}}).`
        },
        {
            id: 'ud_email_1',
            name: 'Account Deactivation Email',
            channel: 'email',
            subject: 'Account Deactivated — {{user_name}}',
            body: `A user account has been deactivated.\n\nName: {{user_name}}\nEmail: {{user_email}}\nDeactivated At: {{deactivated_at}}\n\nThe user can no longer access the system.\n\nRegards,\nSerapod2U System`
        }
    ],

    'password_changed': [
        {
            id: 'pc_wa_1',
            name: 'Password Changed Alert',
            description: 'Security notification for password changes',
            channel: 'whatsapp',
            body: `🔐 *Password Changed*\n\n*User:* {{user_name}}\n*Email:* {{user_email}}\n*Changed at:* {{changed_at}}\n\nIf this was not you, please contact your administrator immediately.`
        },
        {
            id: 'pc_sms_1',
            name: 'SMS Password Changed',
            channel: 'sms',
            body: `[Serapod2U] Password changed for {{user_email}} at {{changed_at}}. Not you? Contact admin immediately.`
        },
        {
            id: 'pc_email_1',
            name: 'Password Changed Email',
            channel: 'email',
            subject: 'Password Changed — {{user_email}}',
            body: `Your password has been changed.\n\nUser: {{user_name}}\nEmail: {{user_email}}\nChanged At: {{changed_at}}\n\nIf you did not make this change, please contact your administrator immediately.\n\nRegards,\nSerapod2U System`
        }
    ],

    'password_reset_request': [
        {
            id: 'pr_wa_1',
            name: 'Password Reset Requested',
            description: 'Alert when a password reset is initiated',
            channel: 'whatsapp',
            body: `🔑 *Password Reset Requested*\n\n*User:* {{user_name}}\n*Email:* {{user_email}}\n*Requested at:* {{requested_at}}\n\nA password reset has been requested for this account.`
        },
        {
            id: 'pr_sms_1',
            name: 'SMS Password Reset',
            channel: 'sms',
            body: `[Serapod2U] Password reset requested for {{user_email}} at {{requested_at}}.`
        },
        {
            id: 'pr_email_1',
            name: 'Password Reset Email',
            channel: 'email',
            subject: 'Password Reset Request — {{user_email}}',
            body: `A password reset has been requested.\n\nUser: {{user_name}}\nEmail: {{user_email}}\nRequested At: {{requested_at}}\n\nIf this request was not authorized, please review your security settings.\n\nRegards,\nSerapod2U System`
        }
    ],

    'login_suspicious': [
        {
            id: 'sl_wa_1',
            name: 'Suspicious Login Alert',
            description: 'Security alert for unusual login activity',
            channel: 'whatsapp',
            body: `🚨 *Suspicious Login Detected*\n━━━━━━━━━━━━━━━━━━\n\n*User:* {{user_name}}\n*Email:* {{user_email}}\n*IP Address:* {{ip_address}}\n*Location:* {{login_location}}\n*Time:* {{login_time}}\n\n⚠️ An unusual login attempt was detected.\nIf this was not you, please change your password immediately and contact your administrator.`
        },
        {
            id: 'sl_sms_1',
            name: 'SMS Suspicious Login',
            channel: 'sms',
            body: `[Serapod2U] ALERT: Suspicious login for {{user_email}} from {{ip_address}} at {{login_time}}. Not you? Change password now.`
        },
        {
            id: 'sl_email_1',
            name: 'Suspicious Login Email',
            channel: 'email',
            subject: '🚨 Suspicious Login — {{user_email}}',
            body: `SECURITY ALERT: Suspicious Login Detected\n\nUser: {{user_name}}\nEmail: {{user_email}}\nIP Address: {{ip_address}}\nLocation: {{login_location}}\nTime: {{login_time}}\n\nIf this was not you, please change your password immediately and contact your administrator.\n\nRegards,\nSerapod2U System`
        }
    ],

    // ══════════════════════════════════════════════════════════
    // DOCUMENT WORKFLOW (PO → Invoice → Payment → Receipt)
    // ══════════════════════════════════════════════════════════

    'po_created': [
        {
            id: 'po_wa_1',
            name: 'PO Created — Manufacturer',
            description: 'Notifies manufacturer to acknowledge PO and upload Proforma Invoice',
            channel: 'whatsapp',
            body: `📋 *Purchase Order Created*\n━━━━━━━━━━━━━━━━━━\n\n*PO No:* #{{doc_no}}\n*Order:* #{{order_no}}\n*Date:* {{doc_date}}\n\n👤 *Buyer:* {{buyer_name}}\n💰 *Total Amount:* RM {{amount}}\n\n📌 *Action Required:*\nPlease review and acknowledge the PO at your earliest convenience. Once acknowledged, a Deposit Invoice will be automatically generated.\n\nUpload your Proforma Invoice if applicable.\n\n🔗 {{document_url}}`
        },
        {
            id: 'po_wa_2',
            name: 'PO Created — Quick Alert',
            channel: 'whatsapp',
            body: `📋 New PO *#{{doc_no}}* for Order *#{{order_no}}*\n\nAmount: RM {{amount}}\nBuyer: {{buyer_name}}\n\n✅ Acknowledge to generate Deposit Invoice.\n\n🔗 {{document_url}}`
        },
        {
            id: 'po_sms_1',
            name: 'SMS PO Created',
            channel: 'sms',
            body: `[Serapod2U] PO #{{doc_no}} created for Order #{{order_no}}. Amount: RM {{amount}}. Please acknowledge to proceed.`
        },
        {
            id: 'po_email_1',
            name: 'PO Created Email',
            channel: 'email',
            subject: 'Purchase Order #{{doc_no}} — Action Required',
            body: `Dear Team,\n\nA new Purchase Order has been created.\n\nPO No: #{{doc_no}}\nOrder No: #{{order_no}}\nDate: {{doc_date}}\nBuyer: {{buyer_name}}\nTotal Amount: RM {{amount}}\n\nPlease review and acknowledge this PO. Once acknowledged, a Deposit Invoice will be automatically generated.\n\n{{document_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'po_acknowledged': [
        {
            id: 'poa_wa_1',
            name: 'PO Acknowledged — Buyer',
            description: 'Notifies buyer that manufacturer acknowledged PO and Deposit Invoice is ready',
            channel: 'whatsapp',
            body: `✅ *PO Acknowledged*\n━━━━━━━━━━━━━━━━━━\n\n*PO No:* #{{doc_no}}\n*Order:* #{{order_no}}\n*Acknowledged by:* {{acknowledged_by}}\n*Date:* {{acknowledged_at}}\n\n📄 *Deposit Invoice Generated*\nInvoice No: #{{invoice_no}}\nDeposit Amount (30%): RM {{deposit_amount}}\n\n📌 *Next Step:*\nPlease review the Deposit Invoice and arrange payment.\n\n🔗 {{document_url}}`
        },
        {
            id: 'poa_wa_2',
            name: 'PO Acknowledged — Quick',
            channel: 'whatsapp',
            body: `✅ PO *#{{doc_no}}* acknowledged by {{acknowledged_by}}.\n\nDeposit Invoice *#{{invoice_no}}* — RM {{deposit_amount}} (30%) is now ready.\n\n🔗 {{document_url}}`
        },
        {
            id: 'poa_sms_1',
            name: 'SMS PO Acknowledged',
            channel: 'sms',
            body: `[Serapod2U] PO #{{doc_no}} acknowledged. Deposit Invoice #{{invoice_no}} generated. Amount: RM {{deposit_amount}} (30%).`
        },
        {
            id: 'poa_email_1',
            name: 'PO Acknowledgement Email',
            channel: 'email',
            subject: 'PO #{{doc_no}} Acknowledged — Invoice #{{invoice_no}} Ready',
            body: `Dear Team,\n\nThe Purchase Order has been acknowledged by the manufacturer.\n\nPO No: #{{doc_no}}\nOrder No: #{{order_no}}\nAcknowledged by: {{acknowledged_by}}\nDate: {{acknowledged_at}}\n\nA Deposit Invoice has been automatically generated:\nInvoice No: #{{invoice_no}}\nDeposit Amount (30%): RM {{deposit_amount}}\n\nPlease review and arrange payment.\n\n{{document_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'invoice_created': [
        {
            id: 'ic_wa_1',
            name: 'Invoice Ready — Buyer',
            description: 'Notifies buyer to review Deposit Invoice and make 30% deposit payment',
            channel: 'whatsapp',
            body: `🧾 *Deposit Invoice Ready*\n━━━━━━━━━━━━━━━━━━\n\n*Invoice No:* #{{doc_no}}\n*Order:* #{{order_no}}\n*Date:* {{doc_date}}\n\n💰 *Total Amount:* RM {{amount}}\n📊 *Deposit (30%):* RM {{deposit_amount}}\n\n📌 *Action Required:*\nPlease review and acknowledge this invoice, then upload proof of payment for the 30% deposit.\n\n🔗 {{document_url}}`
        },
        {
            id: 'ic_wa_2',
            name: 'Invoice Quick Alert',
            channel: 'whatsapp',
            body: `🧾 Deposit Invoice *#{{doc_no}}* for Order *#{{order_no}}*\n\nDeposit: RM {{deposit_amount}} (30%)\n\n💳 Acknowledge & upload payment proof.\n\n🔗 {{document_url}}`
        },
        {
            id: 'ic_sms_1',
            name: 'SMS Invoice Ready',
            channel: 'sms',
            body: `[Serapod2U] Invoice #{{doc_no}} ready. Order #{{order_no}}. Deposit 30%: RM {{deposit_amount}}. Please review.`
        },
        {
            id: 'ic_email_1',
            name: 'Deposit Invoice Email',
            channel: 'email',
            subject: 'Deposit Invoice #{{doc_no}} — RM {{deposit_amount}} Due',
            body: `Dear Team,\n\nA Deposit Invoice has been generated.\n\nInvoice No: #{{doc_no}}\nOrder No: #{{order_no}}\nDate: {{doc_date}}\nTotal Amount: RM {{amount}}\nDeposit (30%): RM {{deposit_amount}}\n\nPlease review and acknowledge this invoice, then upload proof of payment for the deposit amount.\n\n{{document_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'invoice_acknowledged': [
        {
            id: 'ia_wa_1',
            name: 'Invoice Acknowledged — Seller',
            description: 'Notifies seller that buyer acknowledged invoice and payment proof uploaded',
            channel: 'whatsapp',
            body: `✅ *Invoice Acknowledged*\n━━━━━━━━━━━━━━━━━━\n\n*Invoice No:* #{{doc_no}}\n*Order:* #{{order_no}}\n*Acknowledged by:* {{acknowledged_by}}\n*Date:* {{acknowledged_at}}\n\n💳 Payment proof has been uploaded.\n\n📌 *Next Step:*\nPlease verify the payment and acknowledge receipt.\n\n🔗 {{document_url}}`
        },
        {
            id: 'ia_wa_2',
            name: 'Invoice Acknowledged — Quick',
            channel: 'whatsapp',
            body: `✅ Invoice *#{{doc_no}}* acknowledged by {{acknowledged_by}}.\n\nPayment proof uploaded. Please verify payment.\n\n🔗 {{document_url}}`
        },
        {
            id: 'ia_sms_1',
            name: 'SMS Invoice Acknowledged',
            channel: 'sms',
            body: `[Serapod2U] Invoice #{{doc_no}} acknowledged by {{acknowledged_by}}. Payment proof uploaded. Please verify.`
        },
        {
            id: 'ia_email_1',
            name: 'Invoice Acknowledged Email',
            channel: 'email',
            subject: 'Invoice #{{doc_no}} Acknowledged — Payment Uploaded',
            body: `Dear Team,\n\nThe Deposit Invoice has been acknowledged by the buyer.\n\nInvoice No: #{{doc_no}}\nOrder No: #{{order_no}}\nAcknowledged by: {{acknowledged_by}}\nDate: {{acknowledged_at}}\n\nPayment proof has been uploaded. Please verify the payment and acknowledge receipt to proceed.\n\n{{document_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'balance_request_created': [
        {
            id: 'brc_wa_1',
            name: 'Balance Payment Request — Buyer',
            description: 'Notifies buyer that 70% balance request is created after manufacturing',
            channel: 'whatsapp',
            body: `💰 *Balance Payment Request*\n━━━━━━━━━━━━━━━━━━\n\n*Document No:* #{{doc_no}}\n*Order:* #{{order_no}}\n*Date:* {{doc_date}}\n\n📊 *Balance Due (70%):* RM {{balance_amount}}\n\n🏭 Manufacturing has been completed. QR codes are ready for shipment.\n\n📌 *Action Required:*\nPlease arrange balance payment of RM {{balance_amount}} to proceed with shipment.\n\n🔗 {{document_url}}`
        },
        {
            id: 'brc_wa_2',
            name: 'Balance Request — Quick',
            channel: 'whatsapp',
            body: `💰 Balance Payment Request *#{{doc_no}}*\n\nOrder: #{{order_no}}\nBalance (70%): RM {{balance_amount}}\n\nManufacturing done. Pay to proceed with shipment.\n\n🔗 {{document_url}}`
        },
        {
            id: 'brc_sms_1',
            name: 'SMS Balance Request',
            channel: 'sms',
            body: `[Serapod2U] Balance request #{{doc_no}} for Order #{{order_no}}. Due: RM {{balance_amount}} (70%). Manufacturing complete.`
        },
        {
            id: 'brc_email_1',
            name: 'Balance Request Email',
            channel: 'email',
            subject: 'Balance Payment Request #{{doc_no}} — RM {{balance_amount}} Due',
            body: `Dear Team,\n\nA balance payment request has been created.\n\nDocument No: #{{doc_no}}\nOrder No: #{{order_no}}\nDate: {{doc_date}}\nBalance Due (70%): RM {{balance_amount}}\n\nManufacturing has been completed and all QR codes are ready for shipment. Please arrange balance payment to proceed.\n\n{{document_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'payment_received': [
        {
            id: 'pr_wa_1',
            name: 'Payment Received — Confirmation',
            description: 'Notifies that payment has been received and acknowledged',
            channel: 'whatsapp',
            body: `💳 *Payment Received & Acknowledged*\n━━━━━━━━━━━━━━━━━━\n\n*Payment No:* #{{doc_no}}\n*Order:* #{{order_no}}\n*Date:* {{doc_date}}\n\n💰 *Amount Paid:* RM {{amount}}\n✅ *Acknowledged by:* {{acknowledged_by}}\n\n📌 *Next Step:*\nA Receipt will be generated to confirm this transaction.\n\n🔗 {{document_url}}`
        },
        {
            id: 'pr_wa_2',
            name: 'Payment Received — Quick',
            channel: 'whatsapp',
            body: `💳 Payment *#{{doc_no}}* for Order *#{{order_no}}* received.\n\nRM {{amount}} acknowledged by {{acknowledged_by}}.\n\nReceipt will be generated.\n\n🔗 {{document_url}}`
        },
        {
            id: 'pr_sms_1',
            name: 'SMS Payment Received',
            channel: 'sms',
            body: `[Serapod2U] Payment #{{doc_no}} received. Order #{{order_no}}. Amount: RM {{amount}}. Receipt will be generated.`
        },
        {
            id: 'pr_email_1',
            name: 'Payment Received Email',
            channel: 'email',
            subject: 'Payment #{{doc_no}} Received — Order #{{order_no}}',
            body: `Dear Team,\n\nPayment has been received and acknowledged.\n\nPayment No: #{{doc_no}}\nOrder No: #{{order_no}}\nDate: {{doc_date}}\nAmount: RM {{amount}}\nAcknowledged by: {{acknowledged_by}}\n\nA Receipt will be generated to confirm this transaction.\n\n{{document_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'balance_payment_received': [
        {
            id: 'bpr_wa_1',
            name: 'Balance Payment Received',
            description: 'Notifies manufacturer that 70% balance payment is received',
            channel: 'whatsapp',
            body: `💰 *Balance Payment Received*\n━━━━━━━━━━━━━━━━━━\n\n*Document No:* #{{doc_no}}\n*Order:* #{{order_no}}\n*Date:* {{doc_date}}\n\n✅ *Balance Paid:* RM {{balance_amount}} (70%)\n👤 *Acknowledged by:* {{acknowledged_by}}\n\nFull payment has been received. The order is now clear for final shipment and closing.\n\n🔗 {{document_url}}`
        },
        {
            id: 'bpr_wa_2',
            name: 'Balance Payment — Quick',
            channel: 'whatsapp',
            body: `💰 Balance payment for Order *#{{order_no}}* received!\n\nRM {{balance_amount}} (70%) — Acknowledged by {{acknowledged_by}}\n\nOrder ready for final closing.\n\n🔗 {{document_url}}`
        },
        {
            id: 'bpr_sms_1',
            name: 'SMS Balance Payment',
            channel: 'sms',
            body: `[Serapod2U] Balance payment received: Order #{{order_no}}. Amount: RM {{balance_amount}} (70%). Ready for closing.`
        },
        {
            id: 'bpr_email_1',
            name: 'Balance Payment Email',
            channel: 'email',
            subject: 'Balance Payment Received — Order #{{order_no}}',
            body: `Dear Team,\n\nThe balance payment has been received and acknowledged.\n\nDocument No: #{{doc_no}}\nOrder No: #{{order_no}}\nDate: {{doc_date}}\nBalance Amount (70%): RM {{balance_amount}}\nAcknowledged by: {{acknowledged_by}}\n\nFull payment is now complete. The order is clear for final shipment and closing.\n\n{{document_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    'receipt_issued': [
        {
            id: 'ri_wa_1',
            name: 'Receipt Issued — Order Complete',
            description: 'Final document in workflow — confirms transaction complete',
            channel: 'whatsapp',
            body: `🧾 *Receipt Issued — Transaction Complete*\n━━━━━━━━━━━━━━━━━━\n\n*Receipt No:* #{{doc_no}}\n*Order:* #{{order_no}}\n*Date:* {{doc_date}}\n\n💰 *Total Paid:* RM {{amount}}\n✅ *Status:* Complete\n\nThe full document workflow is now complete:\n📋 PO → 🧾 Invoice → 💳 Payment → 🧾 Receipt ✓\n\nThank you for your business!\n\n🔗 {{document_url}}`
        },
        {
            id: 'ri_wa_2',
            name: 'Receipt — Quick Confirmation',
            channel: 'whatsapp',
            body: `🧾 Receipt *#{{doc_no}}* issued for Order *#{{order_no}}*.\n\nTotal: RM {{amount}}\n\n✅ Document workflow complete.\n\n🔗 {{document_url}}`
        },
        {
            id: 'ri_sms_1',
            name: 'SMS Receipt Issued',
            channel: 'sms',
            body: `[Serapod2U] Receipt #{{doc_no}} issued. Order #{{order_no}}. Amount: RM {{amount}}. Workflow complete.`
        },
        {
            id: 'ri_email_1',
            name: 'Receipt Issued Email',
            channel: 'email',
            subject: 'Receipt #{{doc_no}} — Order #{{order_no}} Complete',
            body: `Dear Team,\n\nA receipt has been issued confirming transaction completion.\n\nReceipt No: #{{doc_no}}\nOrder No: #{{order_no}}\nDate: {{doc_date}}\nTotal Amount: RM {{amount}}\n\nThe document workflow is now complete:\nPO → Invoice → Payment → Receipt ✓\n\nThank you for your business.\n\n{{document_url}}\n\nRegards,\nSerapod2U System`
        }
    ],

    // ══════════════════════════════════════════════════════════
    // FALLBACK / GENERIC
    // ══════════════════════════════════════════════════════════

    'generic': [
        {
            id: 'gen_wa_1',
            name: 'Simple Message',
            channel: 'whatsapp',
            body: `Update: {{event_name}} has occurred.\nReference: {{reference_id}}`
        }
    ]
};

export const getTemplatesForEvent = (eventCode: string, channel: string): Template[] => {
    const templates = notificationTemplates[eventCode] || notificationTemplates['generic'] || [];
    return templates.filter(t => t.channel === channel);
};
