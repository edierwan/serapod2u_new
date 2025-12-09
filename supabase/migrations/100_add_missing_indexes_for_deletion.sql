-- Add missing indexes to improve deletion performance

-- scratch_card_plays
CREATE INDEX IF NOT EXISTS idx_scratch_card_plays_qr_code_id ON scratch_card_plays(qr_code_id);

-- consumer_qr_scans
CREATE INDEX IF NOT EXISTS idx_consumer_qr_scans_qr_code_id ON consumer_qr_scans(qr_code_id);

-- qr_master_codes
CREATE INDEX IF NOT EXISTS idx_qr_master_codes_shipment_order_id ON qr_master_codes(shipment_order_id);

-- qr_batches
CREATE INDEX IF NOT EXISTS idx_qr_batches_order_id ON qr_batches(order_id);

-- order_items
CREATE INDEX IF NOT EXISTS idx_order_items_order_id ON order_items(order_id);

-- documents
CREATE INDEX IF NOT EXISTS idx_documents_order_id ON documents(order_id);

-- stock_movements
CREATE INDEX IF NOT EXISTS idx_stock_movements_reference_id ON stock_movements(reference_id);
CREATE INDEX IF NOT EXISTS idx_stock_movements_reference_no ON stock_movements(reference_no);
