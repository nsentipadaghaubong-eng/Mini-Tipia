ALTER TABLE delivery_items
    ADD COLUMN received_inventory_id TEXT
    CHECK (
        received_inventory_id IS NULL
        OR length(trim(received_inventory_id)) > 0
    );

CREATE TRIGGER delivery_receipt_requires_inventory_association
BEFORE UPDATE OF status ON deliveries
WHEN OLD.status = 'draft' AND NEW.status = 'received'
BEGIN
    SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM delivery_items AS item
        WHERE item.delivery_id = NEW.delivery_id
          AND NOT EXISTS (
              SELECT 1
              FROM inventory_records AS record
              WHERE record.inventory_id = item.received_inventory_id
                AND record.product_id = item.product_id
                AND record.variant_id = item.variant_id
                AND record.batch_id IS item.received_batch_id
          )
    ) THEN RAISE(
        ABORT,
        'received delivery items require their resulting Inventory record association'
    ) END;
END;
