CREATE TABLE schema_migrations (
    version INTEGER PRIMARY KEY CHECK (version > 0),
    name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0),
    checksum_sha256 TEXT NOT NULL CHECK (
        length(checksum_sha256) = 64
        AND checksum_sha256 NOT GLOB '*[^0-9a-f]*'
    ),
    applied_at TEXT NOT NULL CHECK (length(trim(applied_at)) > 0)
);

CREATE TRIGGER schema_migrations_immutable_update
BEFORE UPDATE ON schema_migrations
BEGIN
    SELECT RAISE(ABORT, 'migration history is immutable');
END;

CREATE TRIGGER schema_migrations_immutable_delete
BEFORE DELETE ON schema_migrations
BEGIN
    SELECT RAISE(ABORT, 'migration history is retained');
END;

CREATE TABLE activity_events (
    event_sequence INTEGER PRIMARY KEY AUTOINCREMENT,
    event_id TEXT NOT NULL UNIQUE,
    operation_key TEXT NOT NULL UNIQUE,
    event_type TEXT NOT NULL CHECK (event_type IN (
        'product.created','product.updated','product.deleted',
        'product.variant_added','product.variant_updated','product.variant_removed',
        'product.packaging_added','product.packaging_updated','product.packaging_removed',
        'inventory.batch_created','inventory.batch_updated','inventory.batch_removed',
        'inventory.stock_adjusted','delivery.received','delivery.draft_cancelled',
        'sale.completed'
    )),
    occurred_at TEXT NOT NULL,
    actor_id TEXT,
    event_json TEXT NOT NULL CHECK (length(trim(event_json)) > 0),
    CHECK (length(trim(event_id)) > 0),
    CHECK (length(trim(operation_key)) > 0)
);

CREATE INDEX idx_activity_type_time
    ON activity_events(event_type, occurred_at, event_sequence);

CREATE TRIGGER activity_events_immutable_update
BEFORE UPDATE ON activity_events
BEGIN
    SELECT RAISE(ABORT, 'Activity events are append-only');
END;

CREATE TRIGGER activity_events_immutable_delete
BEFORE DELETE ON activity_events
BEGIN
    SELECT RAISE(ABORT, 'Activity events are retained');
END;

CREATE TABLE products (
    product_id TEXT PRIMARY KEY,
    product_position INTEGER NOT NULL UNIQUE CHECK (product_position >= 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    description TEXT,
    generic_name TEXT,
    manufacturer TEXT,
    category TEXT,
    CHECK (length(trim(product_id)) > 0)
);

CREATE TABLE variants (
    variant_id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    variant_position INTEGER NOT NULL CHECK (variant_position >= 0),
    variant_name TEXT NOT NULL CHECK (length(trim(variant_name)) > 0),
    nafdac_registration_number TEXT,
    UNIQUE(product_id, variant_id),
    UNIQUE(product_id, variant_position),
    FOREIGN KEY(product_id) REFERENCES products(product_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (length(trim(variant_id)) > 0)
);

CREATE TABLE packaging_levels (
    packaging_level_id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    packaging_position INTEGER NOT NULL CHECK (packaging_position >= 0),
    name TEXT NOT NULL CHECK (length(trim(name)) > 0),
    cost_price_minor_units INTEGER,
    selling_price_minor_units INTEGER,
    quantity_of_next_level INTEGER,
    next_level_id TEXT,
    UNIQUE(product_id, variant_id, packaging_level_id),
    UNIQUE(product_id, variant_id, packaging_position),
    UNIQUE(product_id, variant_id, next_level_id),
    FOREIGN KEY(product_id, variant_id)
        REFERENCES variants(product_id, variant_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY(product_id, variant_id, next_level_id)
        REFERENCES packaging_levels(product_id, variant_id, packaging_level_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (length(trim(packaging_level_id)) > 0),
    CHECK (cost_price_minor_units IS NULL OR (
        typeof(cost_price_minor_units) = 'integer'
        AND cost_price_minor_units BETWEEN 0 AND 9007199254740991
    )),
    CHECK (selling_price_minor_units IS NULL OR (
        typeof(selling_price_minor_units) = 'integer'
        AND selling_price_minor_units BETWEEN 0 AND 9007199254740991
    )),
    CHECK (
        (next_level_id IS NULL AND quantity_of_next_level IS NULL)
        OR (
            next_level_id IS NOT NULL
            AND next_level_id <> packaging_level_id
            AND typeof(quantity_of_next_level) = 'integer'
            AND quantity_of_next_level BETWEEN 1 AND 9007199254740991
        )
    )
);

CREATE TRIGGER packaging_no_cycle_insert
BEFORE INSERT ON packaging_levels
WHEN NEW.next_level_id IS NOT NULL
BEGIN
    SELECT CASE WHEN EXISTS (
        WITH RECURSIVE chain(level_id) AS (
            SELECT NEW.next_level_id
            UNION
            SELECT levels.next_level_id
            FROM packaging_levels AS levels
            JOIN chain ON levels.packaging_level_id = chain.level_id
            WHERE levels.product_id = NEW.product_id
              AND levels.variant_id = NEW.variant_id
              AND levels.next_level_id IS NOT NULL
        )
        SELECT 1 FROM chain WHERE level_id = NEW.packaging_level_id
    ) THEN RAISE(ABORT, 'packaging hierarchy cycle') END;
END;

CREATE TRIGGER packaging_no_cycle_update
BEFORE UPDATE OF next_level_id ON packaging_levels
WHEN NEW.next_level_id IS NOT NULL
BEGIN
    SELECT CASE WHEN EXISTS (
        WITH RECURSIVE chain(level_id) AS (
            SELECT NEW.next_level_id
            UNION
            SELECT levels.next_level_id
            FROM packaging_levels AS levels
            JOIN chain ON levels.packaging_level_id = chain.level_id
            WHERE levels.product_id = NEW.product_id
              AND levels.variant_id = NEW.variant_id
              AND levels.next_level_id IS NOT NULL
        )
        SELECT 1 FROM chain WHERE level_id = NEW.packaging_level_id
    ) THEN RAISE(ABORT, 'packaging hierarchy cycle') END;
END;

CREATE TABLE variant_low_stock_thresholds (
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (
        typeof(quantity) = 'integer'
        AND quantity BETWEEN 0 AND 9007199254740991
    ),
    packaging_level_id TEXT,
    PRIMARY KEY(product_id, variant_id),
    FOREIGN KEY(product_id, variant_id)
        REFERENCES variants(product_id, variant_id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    FOREIGN KEY(product_id, variant_id, packaging_level_id)
        REFERENCES packaging_levels(product_id, variant_id, packaging_level_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE TABLE batches (
    batch_id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    batch_position INTEGER NOT NULL CHECK (batch_position >= 0),
    batch_number TEXT,
    expiry_date TEXT,
    received_date TEXT,
    UNIQUE(batch_id, product_id, variant_id),
    UNIQUE(product_id, variant_id, batch_position),
    FOREIGN KEY(product_id, variant_id)
        REFERENCES variants(product_id, variant_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (length(trim(batch_id)) > 0),
    CHECK (batch_number IS NULL OR (
        length(trim(batch_number)) > 0
        AND batch_number = trim(batch_number)
    )),
    CHECK (expiry_date IS NULL OR (
        length(expiry_date) = 10
        AND expiry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND COALESCE(date(expiry_date, '+0 days') = expiry_date, 0)
    )),
    CHECK (received_date IS NULL OR (
        length(received_date) = 10
        AND received_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND COALESCE(date(received_date, '+0 days') = received_date, 0)
    ))
);

CREATE UNIQUE INDEX uq_batch_numbered_with_expiry
    ON batches(product_id, variant_id, batch_number, expiry_date)
    WHERE batch_number IS NOT NULL AND expiry_date IS NOT NULL;

CREATE UNIQUE INDEX uq_batch_numbered_without_expiry
    ON batches(product_id, variant_id, batch_number)
    WHERE batch_number IS NOT NULL AND expiry_date IS NULL;

CREATE UNIQUE INDEX uq_batch_unnumbered_with_expiry
    ON batches(product_id, variant_id, expiry_date)
    WHERE batch_number IS NULL AND expiry_date IS NOT NULL;

CREATE TABLE inventory_records (
    inventory_id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    inventory_position INTEGER NOT NULL CHECK (inventory_position >= 0),
    batch_id TEXT,
    UNIQUE(inventory_id, product_id, variant_id),
    UNIQUE(product_id, variant_id, inventory_position),
    FOREIGN KEY(product_id, variant_id)
        REFERENCES variants(product_id, variant_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY(batch_id, product_id, variant_id)
        REFERENCES batches(batch_id, product_id, variant_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (length(trim(inventory_id)) > 0)
);

CREATE UNIQUE INDEX uq_inventory_record_for_batch
    ON inventory_records(product_id, variant_id, batch_id)
    WHERE batch_id IS NOT NULL;

CREATE INDEX idx_inventory_variant_batch
    ON inventory_records(product_id, variant_id, batch_id);

CREATE TABLE inventory_stock (
    inventory_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    packaging_level_id TEXT NOT NULL,
    stock_position INTEGER NOT NULL CHECK (stock_position >= 0),
    quantity INTEGER NOT NULL CHECK (
        typeof(quantity) = 'integer'
        AND quantity BETWEEN 0 AND 9007199254740991
    ),
    PRIMARY KEY(inventory_id, packaging_level_id),
    UNIQUE(inventory_id, stock_position),
    FOREIGN KEY(inventory_id, product_id, variant_id)
        REFERENCES inventory_records(inventory_id, product_id, variant_id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    FOREIGN KEY(product_id, variant_id, packaging_level_id)
        REFERENCES packaging_levels(product_id, variant_id, packaging_level_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT
);

CREATE INDEX idx_inventory_stock_packaging
    ON inventory_stock(product_id, variant_id, packaging_level_id);

CREATE TABLE batch_pricing (
    batch_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    packaging_level_id TEXT NOT NULL,
    pricing_position INTEGER NOT NULL CHECK (pricing_position >= 0),
    cost_price_minor_units INTEGER,
    selling_price_minor_units INTEGER,
    PRIMARY KEY(batch_id, packaging_level_id),
    UNIQUE(batch_id, pricing_position),
    FOREIGN KEY(batch_id, product_id, variant_id)
        REFERENCES batches(batch_id, product_id, variant_id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    FOREIGN KEY(product_id, variant_id, packaging_level_id)
        REFERENCES packaging_levels(product_id, variant_id, packaging_level_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (cost_price_minor_units IS NULL OR (
        typeof(cost_price_minor_units) = 'integer'
        AND cost_price_minor_units BETWEEN 0 AND 9007199254740991
    )),
    CHECK (selling_price_minor_units IS NULL OR (
        typeof(selling_price_minor_units) = 'integer'
        AND selling_price_minor_units BETWEEN 0 AND 9007199254740991
    ))
);

CREATE INDEX idx_batch_pricing_packaging
    ON batch_pricing(product_id, variant_id, packaging_level_id);

CREATE TABLE sale_drafts (
    draft_position INTEGER PRIMARY KEY AUTOINCREMENT,
    draft_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('draft', 'cancelled', 'approved')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    customer_name TEXT,
    customer_address TEXT,
    sale_date TEXT,
    staff_user_id TEXT,
    staff_display_name TEXT,
    notes TEXT,
    approved_sale_id TEXT,
    UNIQUE(draft_id, approved_sale_id),
    FOREIGN KEY(approved_sale_id, draft_id)
        REFERENCES sales(sale_id, source_draft_id)
        DEFERRABLE INITIALLY DEFERRED,
    CHECK (length(trim(draft_id)) > 0),
    CHECK (
        (status = 'approved' AND approved_sale_id IS NOT NULL)
        OR (status IN ('draft', 'cancelled') AND approved_sale_id IS NULL)
    ),
    CHECK (sale_date IS NULL OR (
        length(sale_date) = 10
        AND sale_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND COALESCE(date(sale_date, '+0 days') = sale_date, 0)
    ))
);

CREATE INDEX idx_sale_drafts_status_updated
    ON sale_drafts(status, updated_at, draft_position);

CREATE TABLE sale_draft_items (
    draft_id TEXT NOT NULL,
    line_id TEXT NOT NULL,
    item_position INTEGER NOT NULL CHECK (item_position >= 0),
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    inventory_record_id TEXT NOT NULL,
    batch_id TEXT,
    packaging_level_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (
        typeof(quantity) = 'integer'
        AND quantity BETWEEN 1 AND 9007199254740991
    ),
    default_selling_price_minor_units INTEGER,
    applied_selling_price_minor_units INTEGER NOT NULL,
    discount_minor_units INTEGER NOT NULL,
    PRIMARY KEY(draft_id, line_id),
    UNIQUE(draft_id, item_position),
    FOREIGN KEY(draft_id) REFERENCES sale_drafts(draft_id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CHECK (length(trim(line_id)) > 0),
    CHECK (length(trim(product_id)) > 0),
    CHECK (length(trim(variant_id)) > 0),
    CHECK (length(trim(inventory_record_id)) > 0),
    CHECK (length(trim(packaging_level_id)) > 0),
    CHECK (default_selling_price_minor_units IS NULL OR (
        typeof(default_selling_price_minor_units) = 'integer'
        AND default_selling_price_minor_units BETWEEN 0 AND 9007199254740991
    )),
    CHECK (
        typeof(applied_selling_price_minor_units) = 'integer'
        AND applied_selling_price_minor_units BETWEEN 0 AND 9007199254740991
    ),
    CHECK (
        typeof(discount_minor_units) = 'integer'
        AND discount_minor_units BETWEEN 0 AND 9007199254740991
    )
);

CREATE INDEX idx_sale_draft_items_product
    ON sale_draft_items(product_id, variant_id, inventory_record_id);

CREATE TABLE sales (
    sale_position INTEGER PRIMARY KEY AUTOINCREMENT,
    sale_id TEXT NOT NULL UNIQUE,
    source_draft_id TEXT NOT NULL UNIQUE,
    completed_event_id TEXT NOT NULL UNIQUE,
    completed_at TEXT NOT NULL,
    customer_name TEXT,
    customer_address TEXT,
    sale_date TEXT,
    staff_user_id TEXT,
    staff_display_name TEXT,
    notes TEXT,
    subtotal_minor_units INTEGER NOT NULL CHECK (
        typeof(subtotal_minor_units) = 'integer'
        AND subtotal_minor_units BETWEEN 0 AND 9007199254740991
    ),
    discount_minor_units INTEGER NOT NULL CHECK (
        typeof(discount_minor_units) = 'integer'
        AND discount_minor_units BETWEEN 0 AND 9007199254740991
    ),
    final_minor_units INTEGER NOT NULL CHECK (
        typeof(final_minor_units) = 'integer'
        AND final_minor_units BETWEEN 0 AND 9007199254740991
    ),
    expired_batch_confirmed INTEGER NOT NULL CHECK (
        expired_batch_confirmed IN (0, 1)
    ),
    UNIQUE(sale_id, source_draft_id),
    FOREIGN KEY(source_draft_id) REFERENCES sale_drafts(draft_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    FOREIGN KEY(completed_event_id) REFERENCES activity_events(event_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (length(trim(sale_id)) > 0),
    CHECK (discount_minor_units <= subtotal_minor_units),
    CHECK (final_minor_units = subtotal_minor_units - discount_minor_units),
    CHECK (sale_date IS NULL OR (
        length(sale_date) = 10
        AND sale_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND COALESCE(date(sale_date, '+0 days') = sale_date, 0)
    ))
);

CREATE INDEX idx_sales_completed_at
    ON sales(completed_at, sale_position);

CREATE TABLE sale_items (
    sale_id TEXT NOT NULL,
    line_id TEXT NOT NULL,
    item_position INTEGER NOT NULL CHECK (item_position >= 0),
    inventory_record_id TEXT NOT NULL,
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    batch_id TEXT,
    packaging_level_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (
        typeof(quantity) = 'integer'
        AND quantity BETWEEN 1 AND 9007199254740991
    ),
    default_selling_price_minor_units INTEGER,
    applied_selling_price_minor_units INTEGER NOT NULL,
    subtotal_minor_units INTEGER NOT NULL,
    discount_minor_units INTEGER NOT NULL,
    final_minor_units INTEGER NOT NULL,
    expired_batch INTEGER NOT NULL CHECK (expired_batch IN (0, 1)),
    item_snapshot_json TEXT NOT NULL CHECK (length(trim(item_snapshot_json)) > 0),
    PRIMARY KEY(sale_id, line_id),
    UNIQUE(sale_id, item_position),
    FOREIGN KEY(sale_id) REFERENCES sales(sale_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (discount_minor_units <= subtotal_minor_units),
    CHECK (final_minor_units = subtotal_minor_units - discount_minor_units)
);

CREATE TABLE deliveries (
    delivery_position INTEGER PRIMARY KEY AUTOINCREMENT,
    delivery_id TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL CHECK (status IN ('draft', 'received')),
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    delivery_date TEXT,
    received_by TEXT,
    supplier_name TEXT,
    invoice_number TEXT,
    received_event_id TEXT UNIQUE,
    FOREIGN KEY(received_event_id) REFERENCES activity_events(event_id)
        ON DELETE RESTRICT ON UPDATE RESTRICT,
    CHECK (length(trim(delivery_id)) > 0),
    CHECK (
        (status = 'draft')
        OR (
            status = 'received'
            AND received_event_id IS NOT NULL
            AND length(trim(received_by)) > 0
            AND length(delivery_date) = 10
            AND delivery_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
            AND COALESCE(date(delivery_date, '+0 days') = delivery_date, 0)
        )
    )
);

CREATE INDEX idx_deliveries_status_date
    ON deliveries(status, delivery_date, delivery_position);

CREATE TABLE delivery_items (
    delivery_id TEXT NOT NULL,
    delivery_item_id TEXT NOT NULL,
    item_position INTEGER NOT NULL CHECK (item_position >= 0),
    product_id TEXT NOT NULL,
    variant_id TEXT NOT NULL,
    packaging_level_id TEXT NOT NULL,
    quantity INTEGER NOT NULL CHECK (
        typeof(quantity) = 'integer'
        AND quantity BETWEEN 1 AND 9007199254740991
    ),
    batch_number TEXT,
    expiry_date TEXT,
    cost_price_minor_units INTEGER,
    selling_price_minor_units INTEGER,
    received_batch_id TEXT,
    receipt_snapshot_json TEXT,
    PRIMARY KEY(delivery_id, delivery_item_id),
    UNIQUE(delivery_id, item_position),
    FOREIGN KEY(delivery_id) REFERENCES deliveries(delivery_id)
        ON DELETE CASCADE ON UPDATE RESTRICT,
    CHECK (length(trim(delivery_item_id)) > 0),
    CHECK (length(trim(product_id)) > 0),
    CHECK (length(trim(variant_id)) > 0),
    CHECK (length(trim(packaging_level_id)) > 0),
    CHECK (batch_number IS NULL OR (
        length(trim(batch_number)) > 0 AND batch_number = trim(batch_number)
    )),
    CHECK (expiry_date IS NULL OR (
        length(expiry_date) = 10
        AND expiry_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND COALESCE(date(expiry_date, '+0 days') = expiry_date, 0)
    ))
);

CREATE INDEX idx_delivery_items_product
    ON delivery_items(product_id, variant_id, packaging_level_id);

CREATE VIEW active_draft_products AS
    SELECT DISTINCT items.product_id
    FROM sale_draft_items AS items
    JOIN sale_drafts AS drafts ON drafts.draft_id = items.draft_id
    WHERE drafts.status = 'draft'
    UNION
    SELECT DISTINCT items.product_id
    FROM delivery_items AS items
    JOIN deliveries AS delivery ON delivery.delivery_id = items.delivery_id
    WHERE delivery.status = 'draft';

CREATE TRIGGER sale_draft_item_insert_status
BEFORE INSERT ON sale_draft_items
WHEN COALESCE(
    (SELECT status FROM sale_drafts WHERE draft_id = NEW.draft_id), ''
) <> 'draft'
BEGIN
    SELECT RAISE(ABORT, 'sale draft items require an active draft');
END;

CREATE TRIGGER sale_draft_item_insert_references
BEFORE INSERT ON sale_draft_items
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM variants
        WHERE product_id = NEW.product_id AND variant_id = NEW.variant_id
    ) THEN RAISE(ABORT, 'sale draft variant does not exist') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM packaging_levels
        WHERE product_id = NEW.product_id
          AND variant_id = NEW.variant_id
          AND packaging_level_id = NEW.packaging_level_id
    ) THEN RAISE(ABORT, 'sale draft packaging does not exist') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM inventory_records
        WHERE inventory_id = NEW.inventory_record_id
          AND product_id = NEW.product_id
          AND variant_id = NEW.variant_id
          AND batch_id IS NEW.batch_id
    ) THEN RAISE(ABORT, 'sale draft inventory allocation does not match') END;
END;

CREATE TRIGGER sale_draft_item_update_status
BEFORE UPDATE ON sale_draft_items
WHEN COALESCE(
    (SELECT status FROM sale_drafts WHERE draft_id = OLD.draft_id), ''
) <> 'draft'
OR NEW.draft_id <> OLD.draft_id
BEGIN
    SELECT RAISE(ABORT, 'only active sale draft items may be changed');
END;

CREATE TRIGGER sale_draft_item_update_references
BEFORE UPDATE ON sale_draft_items
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM variants
        WHERE product_id = NEW.product_id AND variant_id = NEW.variant_id
    ) THEN RAISE(ABORT, 'sale draft variant does not exist') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM packaging_levels
        WHERE product_id = NEW.product_id
          AND variant_id = NEW.variant_id
          AND packaging_level_id = NEW.packaging_level_id
    ) THEN RAISE(ABORT, 'sale draft packaging does not exist') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM inventory_records
        WHERE inventory_id = NEW.inventory_record_id
          AND product_id = NEW.product_id
          AND variant_id = NEW.variant_id
          AND batch_id IS NEW.batch_id
    ) THEN RAISE(ABORT, 'sale draft inventory allocation does not match') END;
END;

CREATE TRIGGER sale_draft_item_delete_status
BEFORE DELETE ON sale_draft_items
WHEN COALESCE(
    (SELECT status FROM sale_drafts WHERE draft_id = OLD.draft_id), ''
) <> 'draft'
BEGIN
    SELECT RAISE(ABORT, 'terminal sale draft items are retained');
END;

CREATE TRIGGER sale_draft_status_transition
BEFORE UPDATE OF status ON sale_drafts
WHEN NEW.status <> OLD.status
 AND NOT (OLD.status = 'draft' AND NEW.status IN ('cancelled', 'approved'))
BEGIN
    SELECT RAISE(ABORT, 'invalid sale draft status transition');
END;

CREATE TRIGGER sale_draft_terminal_immutable
BEFORE UPDATE ON sale_drafts
WHEN OLD.status <> 'draft'
BEGIN
    SELECT RAISE(ABORT, 'terminal sale drafts are immutable');
END;

CREATE TRIGGER sale_draft_terminal_delete
BEFORE DELETE ON sale_drafts
WHEN OLD.status <> 'draft'
BEGIN
    SELECT RAISE(ABORT, 'terminal sale drafts are retained');
END;

CREATE TRIGGER sales_requires_active_draft_and_event
BEFORE INSERT ON sales
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM sale_drafts
        WHERE draft_id = NEW.source_draft_id
          AND status = 'draft'
          AND EXISTS (
              SELECT 1 FROM sale_draft_items
              WHERE draft_id = NEW.source_draft_id
          )
    ) THEN RAISE(ABORT, 'sale requires a non-empty active draft') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM activity_events
        WHERE event_id = NEW.completed_event_id
          AND event_type = 'sale.completed'
          AND operation_key = 'sale.completed:' || NEW.sale_id
    ) THEN RAISE(ABORT, 'sale requires its matching Activity event') END;
END;

CREATE TRIGGER sales_approve_source_draft
AFTER INSERT ON sales
BEGIN
    UPDATE sale_drafts
    SET status = 'approved',
        approved_sale_id = NEW.sale_id,
        updated_at = NEW.completed_at
    WHERE draft_id = NEW.source_draft_id AND status = 'draft';
END;

CREATE TRIGGER sales_immutable_update
BEFORE UPDATE ON sales
BEGIN
    SELECT RAISE(ABORT, 'completed sales are immutable');
END;

CREATE TRIGGER sales_immutable_delete
BEFORE DELETE ON sales
BEGIN
    SELECT RAISE(ABORT, 'completed sales are retained');
END;

CREATE TRIGGER sale_item_immutable_update
BEFORE UPDATE ON sale_items
BEGIN
    SELECT RAISE(ABORT, 'completed sale items are immutable');
END;

CREATE TRIGGER sale_item_immutable_delete
BEFORE DELETE ON sale_items
BEGIN
    SELECT RAISE(ABORT, 'completed sale items are retained');
END;

CREATE TRIGGER delivery_insert_draft_only
BEFORE INSERT ON deliveries
WHEN NEW.status <> 'draft'
BEGIN
    SELECT RAISE(ABORT, 'deliveries must start as drafts');
END;

CREATE TRIGGER delivery_item_insert_status
BEFORE INSERT ON delivery_items
WHEN COALESCE(
    (SELECT status FROM deliveries WHERE delivery_id = NEW.delivery_id), ''
) <> 'draft'
BEGIN
    SELECT RAISE(ABORT, 'delivery items require an active draft');
END;

CREATE TRIGGER delivery_item_insert_references
BEFORE INSERT ON delivery_items
BEGIN
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM variants
        WHERE product_id = NEW.product_id AND variant_id = NEW.variant_id
    ) THEN RAISE(ABORT, 'delivery draft variant does not exist') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM packaging_levels
        WHERE product_id = NEW.product_id
          AND variant_id = NEW.variant_id
          AND packaging_level_id = NEW.packaging_level_id
    ) THEN RAISE(ABORT, 'delivery draft packaging does not exist') END;
END;

CREATE TRIGGER delivery_item_update_status
BEFORE UPDATE ON delivery_items
WHEN COALESCE(
    (SELECT status FROM deliveries WHERE delivery_id = OLD.delivery_id), ''
) <> 'draft'
OR NEW.delivery_id <> OLD.delivery_id
BEGIN
    SELECT RAISE(ABORT, 'received delivery items are immutable');
END;

CREATE TRIGGER delivery_item_delete_status
BEFORE DELETE ON delivery_items
WHEN COALESCE(
    (SELECT status FROM deliveries WHERE delivery_id = OLD.delivery_id), ''
) = 'received'
BEGIN
    SELECT RAISE(ABORT, 'received delivery history is retained');
END;

CREATE TRIGGER delivery_status_transition
BEFORE UPDATE OF status ON deliveries
WHEN NEW.status <> OLD.status
 AND NOT (OLD.status = 'draft' AND NEW.status = 'received')
BEGIN
    SELECT RAISE(ABORT, 'invalid delivery status transition');
END;

CREATE TRIGGER delivery_receipt_requires_snapshots
BEFORE UPDATE OF status ON deliveries
WHEN OLD.status = 'draft' AND NEW.status = 'received'
BEGIN
    SELECT CASE WHEN length(trim(NEW.received_by)) = 0
        THEN RAISE(ABORT, 'received delivery requires a recipient') END;
    SELECT CASE WHEN NOT (
        length(NEW.delivery_date) = 10
        AND NEW.delivery_date GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]'
        AND COALESCE(date(NEW.delivery_date, '+0 days') = NEW.delivery_date, 0)
    ) THEN RAISE(ABORT, 'received delivery requires a valid calendar date') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM activity_events
        WHERE event_id = NEW.received_event_id
          AND event_type = 'delivery.received'
          AND operation_key = 'delivery.received:' || NEW.delivery_id
    ) THEN RAISE(ABORT, 'received delivery requires its matching Activity event') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM delivery_items
        WHERE delivery_id = NEW.delivery_id
    ) THEN RAISE(ABORT, 'received delivery requires at least one item') END;
    SELECT CASE WHEN EXISTS (
        SELECT 1 FROM delivery_items
        WHERE delivery_id = NEW.delivery_id
          AND (receipt_snapshot_json IS NULL OR received_batch_id IS NULL)
    ) THEN RAISE(ABORT, 'received delivery items require receipt snapshots') END;
END;

CREATE TRIGGER delivery_received_immutable_update
BEFORE UPDATE ON deliveries
WHEN OLD.status = 'received'
BEGIN
    SELECT RAISE(ABORT, 'received delivery history is immutable');
END;

CREATE TRIGGER delivery_delete_requires_cancellation_event
BEFORE DELETE ON deliveries
BEGIN
    SELECT CASE WHEN OLD.status <> 'draft'
        THEN RAISE(ABORT, 'received delivery history is retained') END;
    SELECT CASE WHEN NOT EXISTS (
        SELECT 1 FROM activity_events
        WHERE event_type = 'delivery.draft_cancelled'
          AND operation_key = 'delivery.draft_cancelled:' || OLD.delivery_id
    ) THEN RAISE(ABORT, 'delivery deletion requires its cancellation Activity') END;
END;

CREATE TRIGGER products_delete_requires_activity
BEFORE DELETE ON products
WHEN NOT EXISTS (
    SELECT 1 FROM activity_events
    WHERE event_type = 'product.deleted'
      AND substr(
          operation_key,
          1,
          length('product.deleted:' || OLD.product_id || ':')
      ) = 'product.deleted:' || OLD.product_id || ':'
)
BEGIN
    SELECT RAISE(ABORT, 'product deletion requires its Activity snapshot');
END;

CREATE TRIGGER products_delete_active_draft
BEFORE DELETE ON products
WHEN EXISTS (
    SELECT 1 FROM active_draft_products
    WHERE product_id = OLD.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft protects product');
END;

CREATE TRIGGER products_update_active_draft
BEFORE UPDATE OF generic_name, manufacturer, category ON products
WHEN (
    OLD.generic_name IS NOT NEW.generic_name
    OR OLD.manufacturer IS NOT NEW.manufacturer
    OR OLD.category IS NOT NEW.category
)
AND EXISTS (
    SELECT 1 FROM active_draft_products
    WHERE product_id = OLD.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product structure');
END;

CREATE TRIGGER variants_insert_active_draft
BEFORE INSERT ON variants
WHEN EXISTS (
    SELECT 1 FROM active_draft_products WHERE product_id = NEW.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product structure');
END;

CREATE TRIGGER variants_update_active_draft
BEFORE UPDATE ON variants
WHEN EXISTS (
    SELECT 1 FROM active_draft_products
    WHERE product_id IN (OLD.product_id, NEW.product_id)
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product structure');
END;

CREATE TRIGGER variants_delete_active_draft
BEFORE DELETE ON variants
WHEN EXISTS (
    SELECT 1 FROM active_draft_products WHERE product_id = OLD.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product structure');
END;

CREATE TRIGGER packaging_insert_active_draft
BEFORE INSERT ON packaging_levels
WHEN EXISTS (
    SELECT 1 FROM active_draft_products WHERE product_id = NEW.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product packaging');
END;

CREATE TRIGGER packaging_update_active_draft
BEFORE UPDATE ON packaging_levels
WHEN EXISTS (
    SELECT 1 FROM active_draft_products
    WHERE product_id IN (OLD.product_id, NEW.product_id)
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product packaging');
END;

CREATE TRIGGER packaging_delete_active_draft
BEFORE DELETE ON packaging_levels
WHEN EXISTS (
    SELECT 1 FROM active_draft_products WHERE product_id = OLD.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product packaging');
END;

CREATE TRIGGER threshold_insert_active_draft
BEFORE INSERT ON variant_low_stock_thresholds
WHEN EXISTS (
    SELECT 1 FROM active_draft_products WHERE product_id = NEW.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product structure');
END;

CREATE TRIGGER threshold_update_active_draft
BEFORE UPDATE ON variant_low_stock_thresholds
WHEN EXISTS (
    SELECT 1 FROM active_draft_products
    WHERE product_id IN (OLD.product_id, NEW.product_id)
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product structure');
END;

CREATE TRIGGER threshold_delete_active_draft
BEFORE DELETE ON variant_low_stock_thresholds
WHEN EXISTS (
    SELECT 1 FROM active_draft_products WHERE product_id = OLD.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product structure');
END;

CREATE TRIGGER batches_insert_active_draft
BEFORE INSERT ON batches
WHEN EXISTS (
    SELECT 1 FROM active_draft_products WHERE product_id = NEW.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product inventory');
END;

CREATE TRIGGER batches_update_active_draft
BEFORE UPDATE ON batches
WHEN EXISTS (
    SELECT 1 FROM active_draft_products
    WHERE product_id IN (OLD.product_id, NEW.product_id)
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product inventory');
END;

CREATE TRIGGER batches_delete_active_draft
BEFORE DELETE ON batches
WHEN EXISTS (
    SELECT 1 FROM active_draft_products WHERE product_id = OLD.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product inventory');
END;

CREATE TRIGGER inventory_records_insert_active_draft
BEFORE INSERT ON inventory_records
WHEN EXISTS (
    SELECT 1 FROM active_draft_products WHERE product_id = NEW.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product inventory');
END;

CREATE TRIGGER inventory_records_update_active_draft
BEFORE UPDATE ON inventory_records
WHEN EXISTS (
    SELECT 1 FROM active_draft_products
    WHERE product_id IN (OLD.product_id, NEW.product_id)
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product inventory');
END;

CREATE TRIGGER inventory_records_delete_active_draft
BEFORE DELETE ON inventory_records
WHEN EXISTS (
    SELECT 1 FROM active_draft_products WHERE product_id = OLD.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product inventory');
END;

CREATE TRIGGER inventory_stock_insert_active_draft
BEFORE INSERT ON inventory_stock
WHEN EXISTS (
    SELECT 1 FROM active_draft_products WHERE product_id = NEW.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product inventory');
END;

CREATE TRIGGER inventory_stock_update_active_draft
BEFORE UPDATE ON inventory_stock
WHEN EXISTS (
    SELECT 1 FROM active_draft_products
    WHERE product_id IN (OLD.product_id, NEW.product_id)
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product inventory');
END;

CREATE TRIGGER inventory_stock_delete_active_draft
BEFORE DELETE ON inventory_stock
WHEN EXISTS (
    SELECT 1 FROM active_draft_products WHERE product_id = OLD.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product inventory');
END;

CREATE TRIGGER batch_pricing_insert_active_draft
BEFORE INSERT ON batch_pricing
WHEN EXISTS (
    SELECT 1 FROM active_draft_products WHERE product_id = NEW.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product inventory');
END;

CREATE TRIGGER batch_pricing_update_active_draft
BEFORE UPDATE ON batch_pricing
WHEN EXISTS (
    SELECT 1 FROM active_draft_products
    WHERE product_id IN (OLD.product_id, NEW.product_id)
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product inventory');
END;

CREATE TRIGGER batch_pricing_delete_active_draft
BEFORE DELETE ON batch_pricing
WHEN EXISTS (
    SELECT 1 FROM active_draft_products WHERE product_id = OLD.product_id
)
BEGIN
    SELECT RAISE(ABORT, 'active draft locks product inventory');
END;
