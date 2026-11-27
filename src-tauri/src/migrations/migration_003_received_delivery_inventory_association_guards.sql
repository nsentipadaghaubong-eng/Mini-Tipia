DROP TRIGGER delivery_receipt_requires_inventory_association;

CREATE TRIGGER delivery_receipt_requires_inventory_association
BEFORE UPDATE OF status ON deliveries
WHEN OLD.status = 'draft' AND NEW.status = 'received'
BEGIN
    SELECT CASE WHEN EXISTS (
        SELECT 1
        FROM delivery_items AS item
        WHERE item.delivery_id = NEW.delivery_id
          AND (
              item.received_inventory_id IS NULL
              OR length(trim(item.received_inventory_id)) = 0
              OR EXISTS (
                  SELECT 1
                  FROM inventory_records AS record
                  WHERE record.inventory_id = item.received_inventory_id
                    AND (
                        record.product_id IS NOT item.product_id
                        OR record.variant_id IS NOT item.variant_id
                        OR record.batch_id IS NOT item.received_batch_id
                    )
              )
          )
    ) THEN RAISE(
        ABORT,
        'received delivery items require a valid Inventory record association'
    ) END;
END;

CREATE TRIGGER inventory_record_received_delivery_association_insert
BEFORE INSERT ON inventory_records
WHEN EXISTS (
    SELECT 1
    FROM delivery_items AS item
    JOIN deliveries AS delivery ON delivery.delivery_id = item.delivery_id
    WHERE delivery.status = 'received'
      AND item.received_inventory_id = NEW.inventory_id
      AND (
          item.product_id IS NOT NEW.product_id
          OR item.variant_id IS NOT NEW.variant_id
          OR item.received_batch_id IS NOT NEW.batch_id
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'Inventory record does not match its received Delivery association'
    );
END;

CREATE TRIGGER inventory_record_received_delivery_association_update
BEFORE UPDATE OF inventory_id, product_id, variant_id, batch_id ON inventory_records
WHEN EXISTS (
    SELECT 1
    FROM delivery_items AS item
    JOIN deliveries AS delivery ON delivery.delivery_id = item.delivery_id
    WHERE delivery.status = 'received'
      AND item.received_inventory_id = OLD.inventory_id
      AND (
          NEW.inventory_id IS NOT OLD.inventory_id
          OR item.product_id IS NOT NEW.product_id
          OR item.variant_id IS NOT NEW.variant_id
          OR item.received_batch_id IS NOT NEW.batch_id
      )
)
BEGIN
    SELECT RAISE(
        ABORT,
        'Inventory record identity is retained by received Delivery history'
    );
END;
