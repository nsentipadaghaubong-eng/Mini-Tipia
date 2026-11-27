# Stage 15.5.2 — Product Read Repository

## Outcome

Added `getAllProducts()` in `src/persistence/repositories/productRepository.ts`. It issues one code-defined `SELECT` through the existing `querySqlite` wrapper and maps the joined result into the existing `productStructure`, `variant`, and `packagingLevel` types. The single statement gives the catalog one consistent SQLite read snapshot and uses `LEFT JOIN`s so Products or Variants without child records are retained.

The repository is read-only. It does not initialize or mutate application state, connect to Product UI, create/edit/delete records, access inventory, or introduce a pool or persistence boundary.

## Schema-to-domain mapping

| Migration 001 source | Domain destination | Mapping |
|---|---|---|
| `products.product_id`, `name` | `productStructure.id`, `name` | IDs and names preserved; ordered by `product_position`. |
| `products.description`, `generic_name`, `manufacturer`, `category` | Optional `productStructure` fields | SQL `NULL` is represented by omission; non-null text, including empty text, is preserved. |
| `variants.variant_id`, `variant_name` | `variant.id`, `variantName` | Nested by persisted `product_id`, ordered by `variant_position`. |
| `variants.nafdac_registration_number` | Optional `variant.nafdacRegistrationNumber` | SQL `NULL` is omitted; a stored string is preserved. |
| `variant_low_stock_thresholds.quantity`, `packaging_level_id` | Optional `variant.lowStockThreshold` | No threshold row means the field is omitted. A nullable packaging ID is omitted from the threshold object; quantity, including zero, is retained. |
| `packaging_levels.packaging_level_id`, `name` | `packagingLevel.id`, `name` | Nested under the matching Product and Variant, ordered by `packaging_position`. |
| `cost_price_minor_units`, `selling_price_minor_units` | `packagingLevel.costPrice`, `sellingPrice` | SQL `NULL` stays `null`. Integer minor units are converted to decimal major-unit numbers by dividing by 100, matching the existing decimal price domain. The conversion is checked for safe-integer and cent round-trip fidelity; unrepresentable values fail explicitly rather than silently losing price precision. |
| `quantity_of_next_level`, `next_level_id` | `quantityofNextLevel`, `nextLevelId` | Persisted values are mapped directly, preserving the hierarchy links and conversion quantities; no hierarchy is inferred or flattened. |
| `product_position`, `variant_position`, `packaging_position` | Array ordering | Used only to restore the persisted ordering. |

Migration 001’s composite foreign keys relate each Variant and packaging level to its Product/Variant. The query joins on those IDs, and the mapper groups by Product ID then Variant ID, preventing child records from crossing parents. There is no separate default-price table in this schema; default prices are the packaging-level cost and selling prices.

`createInitialApplicationState()` still uses demo Products. This repository is intentionally not wired into startup or UI in this stage.

## Tests and limitations

Repository tests execute the actual Migration 001 SQL against a fresh in-memory SQLite database using Node 24’s built-in `node:sqlite`; the query wrapper is mocked at its IPC edge but runs the repository SQL against that real isolated SQLite database. Coverage includes an empty catalog, a Product/Variant, multiple Variants, ordered multi-level packaging and conversions, NAFDAC metadata, prices and thresholds, multiple-Product association isolation, nullable fields, Products without Variants, and a price value that cannot be represented faithfully by the domain number type.

The schema allows minor-unit integers up to JavaScript’s safe-integer limit, while a JavaScript decimal `number` cannot represent every possible cent amount across that entire range. The repository detects non-round-trippable values and returns an explicit error. If such extreme prices are a supported business requirement, the domain money representation or schema range will need a separate design decision; neither contract was changed here.

The test harness emits Node’s experimental `node:sqlite` warning and therefore currently assumes a Node runtime that provides that built-in module. No dependency was installed or manifest changed.

See `stage_15_5_2_test_results.md` for exact validation outcomes, including the intermittent Windows SQLite test-file cleanup failures observed in the existing Rust persistence test module.

## Recommendation

The Product read repository is ready for a separately scoped consumer/integration stage. Keep it disconnected from UI and startup until that stage explicitly authorizes integration. Before supporting the schema’s largest possible price values as valid application data, decide whether to constrain the persisted range or adopt an exact money type.
