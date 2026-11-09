// @vitest-environment jsdom

import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
    cleanup,
    fireEvent,
    render,
    screen,
    within
} from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { variant, productStructure } from "../../../products/productStructure";
import type { inventory } from "../../../inventory/inventoryStock";
import type { inventoryBatch } from "../../../inventory/inventoryBatch";
import type { packagingLevel } from "../../../packaging/packagingHierarchy";
import type { NavigationRequest } from "../../../navigation/navigationIntent";
import type { SaleDraft } from "../../../sales/salesDraft";
import type { DeliveryDraft } from "../../../deliveries/deliveryDraft";
import {
    ProductInformation,
    VariantDetails
} from "./ProductsPage";
import ProductsPage from "./ProductsPage";

afterEach(cleanup);

function createLevel(
    id: string,
    name: string,
    nextLevelId: string | null = null,
    quantityofNextLevel: number | null = null,
    costPrice: number | null = null,
    sellingPrice: number | null = null
): packagingLevel {
    return {
        id,
        name,
        nextLevelId,
        quantityofNextLevel,
        costPrice,
        sellingPrice
    };
}

function createVariant(
    id: string,
    variantName: string,
    nafdacRegistrationNumber?: string,
    packagingHierarchy: packagingLevel[] = []
): variant {
    return {
        id,
        variantName,
        ...(nafdacRegistrationNumber === undefined
            ? {}
            : { nafdacRegistrationNumber }),
        packagingHierarchy
    };
}

function createProduct(
    variants: variant[],
    details: Partial<Pick<productStructure, "id" | "name" | "genericName" | "manufacturer">> = {}
): productStructure {
    return {
        id: details.id ?? "product-1",
        name: details.name ?? "Medicine",
        ...(details.genericName === undefined
            ? {}
            : { genericName: details.genericName }),
        ...(details.manufacturer === undefined
            ? {}
            : { manufacturer: details.manufacturer }),
        variant: variants
    };
}

function renderVariant(
    product: productStructure,
    productVariant: variant,
    inventoryRecords: inventory[] = [],
    inventoryBatches: inventoryBatch[] = []
) {
    return renderToStaticMarkup(createElement(VariantDetails, {
        product,
        productVariant,
        inventoryRecords,
        inventoryBatches
    }));
}

function renderProductsPage(
    products: productStructure[],
    inventoryRecords: inventory[] = [],
    inventoryBatches: inventoryBatch[] = [],
    navigationRequest: NavigationRequest | null = null,
    deletionOptions: {
        saleDrafts?: SaleDraft[];
        deliveryDrafts?: DeliveryDraft[];
        onDeleteProduct?: (
            productId: string
        ) => { success: true } | { success: false; error: string };
    } = {}
) {
    return renderToStaticMarkup(createElement(ProductsPage, {
        products,
        inventoryRecords,
        inventoryBatches,
        onCreateProduct: () => undefined,
        onDeleteProduct: deletionOptions.onDeleteProduct ?? (() => ({ success: true })),
        onUpdateProduct: () => undefined,
        saleDrafts: deletionOptions.saleDrafts ?? [],
        deliveryDrafts: deletionOptions.deliveryDrafts ?? [],
        navigationRequest,
        onNavigate: () => undefined,
        onNavigationConsumed: () => undefined,
        onNavigationDismissed: () => undefined
    }));
}

function makeSaleDraft(productId: string, status: SaleDraft["status"] = "draft"): SaleDraft {
    return {
        draftId: "sale-draft-1",
        status,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        items: [{
            lineId: "sale-line-1",
            productId,
            variantId: "variant-1",
            inventoryRecordId: "inventory-1",
            batchId: null,
            packagingLevelId: "box",
            quantity: 1,
            defaultSellingPrice: 1,
            appliedSellingPrice: 1,
            discountAmount: 0
        }]
    };
}

function makeDeliveryDraft(
    productId: string,
    status: DeliveryDraft["status"] = "draft"
): DeliveryDraft {
    return {
        deliveryId: "delivery-draft-1",
        status,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
        deliveryDate: "2026-01-01",
        receivedBy: "Staff",
        items: [{
            deliveryItemId: "delivery-line-1",
            productId,
            variantId: "variant-1",
            packagingLevelId: "box",
            quantity: 1,
            batchNumber: null,
            expiryDate: null
        }]
    };
}

function renderInteractiveProductsPage(
    product: productStructure,
    deletionOptions: {
        saleDrafts?: SaleDraft[];
        deliveryDrafts?: DeliveryDraft[];
        onDeleteProduct?: (
            productId: string
        ) => { success: true } | { success: false; error: string };
    } = {}
) {
    return render(createElement(ProductsPage, {
        products: [product],
        inventoryRecords: [],
        inventoryBatches: [],
        onCreateProduct: () => undefined,
        onDeleteProduct: deletionOptions.onDeleteProduct ?? (() => ({ success: true })),
        onUpdateProduct: () => undefined,
        saleDrafts: deletionOptions.saleDrafts ?? [],
        deliveryDrafts: deletionOptions.deliveryDrafts ?? [],
        navigationRequest: null,
        onNavigate: () => undefined,
        onNavigationConsumed: () => undefined,
        onNavigationDismissed: () => undefined
    }));
}

describe("Product View", () => {
    it("shows product name, generic name, and manufacturer without the internal ID", () => {
        const product = createProduct([], {
            id: "internal-product-id",
            genericName: "Generic medicine",
            manufacturer: "Example Pharma"
        });
        const markup = renderToStaticMarkup(
            createElement(ProductInformation, { product })
        );

        expect(markup).toContain("<dd>Medicine</dd>");
        expect(markup).toContain("<dd>Generic medicine</dd>");
        expect(markup).toContain("<dd>Example Pharma</dd>");
        expect(markup).not.toContain("internal-product-id");
    });

    it("omits missing or blank optional product information", () => {
        const product = createProduct([], {
            genericName: "  ",
            manufacturer: ""
        });
        const markup = renderToStaticMarkup(
            createElement(ProductInformation, { product })
        );

        expect(markup).not.toContain("Generic name");
        expect(markup).not.toContain("Manufacturer");
    });

    it("shows each variant's own NAFDAC number, including a single variant", () => {
        const registered = createVariant("variant-1", "Tablets", "REG-TAB");
        const unregistered = createVariant("variant-2", "Syrup", "  ");
        const product = createProduct([registered, unregistered]);
        const registeredMarkup = renderVariant(product, registered);
        const unregisteredMarkup = renderVariant(product, unregistered);

        expect(registeredMarkup).toContain("<dd>REG-TAB</dd>");
        expect(unregisteredMarkup).not.toContain("NAFDAC Registration Number");
        expect(renderToStaticMarkup(createElement(ProductInformation, {
            product: createProduct([registered])
        }))).not.toContain("NAFDAC Registration Number");
    });

    it("renders packaging order, conversions, prices, and the terminal level", () => {
        const productVariant = createVariant("variant-1", "Tablets", undefined, [
            createLevel("card", "Card", null, null, 2, 3),
            createLevel("box", "Box", "pack", 5, 10, 15),
            createLevel("pack", "Pack", "card", 6, null, 8)
        ]);
        const markup = renderVariant(createProduct([productVariant]), productVariant);

        expect(markup.indexOf("<strong>Box</strong>"))
            .toBeLessThan(markup.indexOf("<strong>Pack</strong>"));
        expect(markup.indexOf("<strong>Pack</strong>"))
            .toBeLessThan(markup.indexOf("<strong>Card</strong>"));
        expect(markup).toContain("1 Box = 5 Pack");
        expect(markup).toContain("1 Pack = 6 Card");
        expect(markup).toContain("Lowest packaging level");
        expect(markup).toContain("₦10");
        expect(markup).toContain("₦15");
        expect(markup).toContain("Not set");
    });

    it("keeps packaging definitions separate for different variants", () => {
        const tablets = createVariant("variant-1", "Tablets", undefined, [
            createLevel("box", "Tablet Box")
        ]);
        const syrup = createVariant("variant-2", "Syrup", undefined, [
            createLevel("bottle", "Syrup Bottle")
        ]);
        const product = createProduct([tablets, syrup]);

        expect(renderVariant(product, tablets)).toContain("Tablet Box");
        expect(renderVariant(product, tablets)).not.toContain("Syrup Bottle");
        expect(renderVariant(product, syrup)).toContain("Syrup Bottle");
        expect(renderVariant(product, syrup)).not.toContain("Tablet Box");
    });

    it("reports invalid packaging hierarchies without breaking Product View", () => {
        const productVariant = createVariant("variant-1", "Tablets", undefined, [
            createLevel("box", "Box", "missing-pack", 5)
        ]);
        const markup = renderVariant(createProduct([productVariant]), productVariant);

        expect(markup).toContain("Packaging information unavailable");
        expect(markup).toContain("Next packaging level not found");
    });

    it("renders all variants in the same modal with their own packaging and registration", () => {
        const tablets = createVariant("variant-1", "Tablets", "REG-TAB", [
            createLevel("tablet-box", "Tablet Box")
        ]);
        const syrup = createVariant("variant-2", "Syrup", "REG-SYR", [
            createLevel("syrup-bottle", "Syrup Bottle")
        ]);
        const product = createProduct([tablets, syrup]);
        const markup = renderProductsPage([product], [], [], {
            requestId: 3,
            intent: { type: "product.view", productId: product.id },
            consumed: true
        });

        expect(markup).toContain("Variants (2)");
        expect(markup).toContain("Tablet Box");
        expect(markup).toContain("Syrup Bottle");
        expect(markup).toContain("REG-TAB");
        expect(markup).toContain("REG-SYR");
    });

    it("joins batches to the correct variant and displays each batch's stock", () => {
        const box = createLevel("box", "Box");
        const tablets = createVariant("variant-1", "Tablets", undefined, [box]);
        const syrup = createVariant("variant-2", "Syrup", undefined, [
            createLevel("bottle", "Bottle")
        ]);
        const product = createProduct([tablets, syrup]);
        const batches: inventoryBatch[] = [
            {
                batchId: "batch-1",
                productId: product.id,
                variantId: tablets.id,
                batchNumber: "LOT-1",
                expiryDate: new Date("2027-01-31")
            },
            {
                batchId: "batch-2",
                productId: product.id,
                variantId: tablets.id,
                batchNumber: "LOT-2",
                expiryDate: null
            },
            {
                batchId: "other-variant-batch",
                productId: product.id,
                variantId: syrup.id,
                batchNumber: "SYRUP-LOT",
                expiryDate: null
            },
            {
                batchId: "other-product-batch",
                productId: "other-product",
                variantId: tablets.id,
                batchNumber: "OTHER-LOT",
                expiryDate: null
            }
        ];
        const records: inventory[] = [
            {
                id: "inventory-1",
                productId: product.id,
                variantId: tablets.id,
                batchId: "batch-1",
                stockQuantities: [{ packagingLevelId: box.id, quantity: 4 }]
            },
            {
                id: "inventory-2",
                productId: product.id,
                variantId: tablets.id,
                batchId: "batch-2",
                stockQuantities: [{ packagingLevelId: box.id, quantity: 9 }]
            },
            {
                id: "inventory-3",
                productId: product.id,
                variantId: syrup.id,
                batchId: "other-variant-batch",
                stockQuantities: []
            }
        ];
        const markup = renderVariant(product, tablets, records, batches);

        expect(markup).toContain("LOT-1");
        expect(markup).toContain("31 Jan 2027");
        expect(markup).toContain("Variant: Tablets");
        expect(markup).toContain("LOT-2");
        expect(markup).toContain("Expiry date unavailable");
        expect(markup).toContain(">4 Boxes</strong>");
        expect(markup).toContain(">9 Boxes</strong>");
        expect(markup).not.toContain("SYRUP-LOT");
        expect(markup).not.toContain("OTHER-LOT");
    });

    it("shows unbatched stock without inventing batch metadata", () => {
        const box = createLevel("box", "Box");
        const productVariant = createVariant("variant-1", "Tablets", undefined, [box]);
        const product = createProduct([productVariant]);
        const markup = renderVariant(product, productVariant, [{
            id: "unbatched-record",
            productId: product.id,
            variantId: productVariant.id,
            batchId: null,
            stockQuantities: [{ packagingLevelId: box.id, quantity: 12 }]
        }]);

        expect(markup).toContain("Unbatched stock");
        expect(markup).toContain(">12 Boxes</strong>");
        expect(markup).not.toContain("Batch number not set");
    });

    it("reports missing batch metadata without fabricating a batch number", () => {
        const box = createLevel("box", "Box");
        const productVariant = createVariant("variant-1", "Tablets", undefined, [box]);
        const product = createProduct([productVariant]);
        const markup = renderVariant(product, productVariant, [{
            id: "inventory-1",
            productId: product.id,
            variantId: productVariant.id,
            batchId: "missing-batch-metadata",
            stockQuantities: [{ packagingLevelId: box.id, quantity: 3 }]
        }]);

        expect(markup).toContain("Batch details unavailable");
        expect(markup).toContain(">3 Boxes</strong>");
        expect(markup).not.toContain("Batch number not set");
        expect(markup).not.toContain("missing-batch-metadata");
    });

    it("reports invalid inventory packaging quantities instead of rendering them as valid stock", () => {
        const box = createLevel("box", "Box");
        const productVariant = createVariant("variant-1", "Tablets", undefined, [box]);
        const product = createProduct([productVariant]);
        const markup = renderVariant(product, productVariant, [{
            id: "invalid-inventory",
            productId: product.id,
            variantId: productVariant.id,
            batchId: null,
            stockQuantities: [{ packagingLevelId: box.id, quantity: -2 }]
        }]);

        expect(markup).toContain("Inventory information unavailable");
        expect(markup).not.toContain(">−2 Boxes</strong>");
        expect(markup).not.toContain(">-2 Boxes</strong>");
    });

    it("renders a Product View modal for the exact requested product and closes through its button", () => {
        const firstProduct = createProduct([], { name: "First" });
        const secondProduct = createProduct([], {
            id: "product-2",
            name: "Second"
        });
        const markup = renderProductsPage(
            [firstProduct, secondProduct],
            [],
            [],
            {
                requestId: 1,
                intent: { type: "product.view", productId: secondProduct.id },
                consumed: true
            }
        );

        expect(markup).toContain('role="dialog"');
        expect(markup).toContain("<h2 id=\"products-modal-title\">Second</h2>");
        expect(markup).toContain('aria-label="Close product details"');
        expect(markup).not.toContain("<h2 id=\"products-modal-title\">First</h2>");
        expect(markup).not.toContain("Edit Product");
        expect(markup).not.toContain("Manage Stock");
    });

    it("opens Product Edit for the exact Inventory navigation request", () => {
        const firstProduct = createProduct([
            createVariant("variant-first", "First variant"),
            createVariant("variant-second", "Second variant")
        ], { name: "First" });
        const secondProduct = createProduct([], {
            id: "product-2",
            name: "Second"
        });
        const markup = renderProductsPage([firstProduct, secondProduct], [], [], {
            requestId: 7,
            intent: {
                type: "product.edit",
                productId: firstProduct.id,
                variantId: "variant-second"
            },
            consumed: true
        });

        expect(markup).toContain('aria-labelledby="product-edit-title"');
        expect(markup).toContain("<h2 id=\"product-edit-title\">Edit Product</h2>");
        expect(markup).toContain("<p>First</p>");
        expect(markup.indexOf("Second variant"))
            .toBeLessThan(markup.indexOf("First variant"));
        expect(markup).not.toContain("<p>Second</p>");
    });

    it("keeps product, inventory, and batch data unchanged while rendering the modal", () => {
        const box = createLevel("box", "Box");
        const productVariant = createVariant("variant-1", "Tablets", "REG-1", [box]);
        const product = createProduct([productVariant], {
            genericName: "Generic",
            manufacturer: "Maker"
        });
        const records: inventory[] = [{
            id: "inventory-1",
            productId: product.id,
            variantId: productVariant.id,
            batchId: null,
            stockQuantities: [{ packagingLevelId: box.id, quantity: 5 }]
        }];
        const batches: inventoryBatch[] = [];
        const before = structuredClone({ product, records, batches });

        renderProductsPage([product], records, batches, {
            requestId: 2,
            intent: { type: "product.view", productId: product.id },
            consumed: true
        });

        expect({ product, records, batches }).toEqual(before);
    });
});

describe("ProductsPage listing", () => {
    it("renders the default filter, result count, and no-products state", () => {
        const markup = renderProductsPage([]);

        expect(markup).toContain('type="search"');
        expect(markup).toContain('aria-label="Filter products"');
        expect(markup).toContain('<option value="all" selected="">All products</option>');
        expect(markup).toContain("Showing 0 of 0 products");
        expect(markup).toContain("No products yet. Create a product to get started.");
        expect(markup).toContain("Create Product");
    });

    it("shows filtered-list count and keeps existing product card actions", () => {
        const product = createProduct([
            createVariant("variant-1", "Tablets")
        ]);
        const markup = renderProductsPage([product]);

        expect(markup).toContain("Showing 1 of 1 product");
        expect(markup).toContain("<h3>Medicine</h3>");
        expect(markup).toContain(">View</button>");
        expect(markup).toContain('aria-label="Edit Medicine"');
        expect(markup).not.toContain("Product editing is not available yet.");
        expect(markup).toContain('aria-label="Delete Medicine"');
        expect(markup).not.toContain("No products yet.");
        const actionsMarkup =
            markup.match(/<div class="product-card-actions">([\s\S]*?)<\/div>/)?.[1] ?? "";
        const actionLabels = Array.from(
            actionsMarkup.matchAll(/<button\b[^>]*>([\s\S]*?)<\/button>/g),
            ([, label]) => label.trim()
        );
        expect(actionLabels).toEqual(["View", "Edit", "Delete"]);
    });
});

describe("ProductsPage deletion", () => {
    const product = createProduct(
        [createVariant("variant-1", "Tablets", undefined, [
            createLevel("box", "Box")
        ])],
        { id: "product-1", name: "Medicine" }
    );

    it("requires explicit confirmation before invoking permanent deletion", () => {
        const onDeleteProduct = vi.fn(() => ({ success: true as const }));
        renderInteractiveProductsPage(product, { onDeleteProduct });

        fireEvent.click(screen.getByRole("button", { name: "Delete Medicine" }));

        expect(screen.getByRole("alertdialog")).toHaveTextContent(
            "permanent and cannot be undone"
        );
        expect(onDeleteProduct).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
        expect(onDeleteProduct).not.toHaveBeenCalled();

        fireEvent.click(screen.getByRole("button", { name: "Delete Medicine" }));
        fireEvent.click(screen.getByRole("button", {
            name: "Delete permanently"
        }));
        expect(onDeleteProduct).toHaveBeenCalledTimes(1);
        expect(onDeleteProduct).toHaveBeenCalledWith(product.id);
    });

    it("blocks deletion for active Sales and Receive Delivery drafts", () => {
        const salesMessage =
            "This product is currently in a Sales draft and cannot be deleted. Please complete or cancel the Sales draft before attempting to delete this product.";
        const deliveryMessage =
            "This product is currently in a Receive Delivery draft and cannot be deleted. Please complete or cancel the Receive Delivery draft before attempting to delete this product.";
        const onDeleteProduct = vi.fn(() => ({ success: true as const }));

        const { unmount } = renderInteractiveProductsPage(product, {
            onDeleteProduct,
            saleDrafts: [makeSaleDraft(product.id)]
        });
        fireEvent.click(screen.getByRole("button", { name: "Delete Medicine" }));
        const salesDialog = screen.getByRole("alertdialog", {
            name: "Product cannot be deleted"
        });
        expect(salesDialog).toBeVisible();
        expect(salesDialog).toHaveTextContent(salesMessage);
        expect(onDeleteProduct).not.toHaveBeenCalled();
        fireEvent.click(within(salesDialog).getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
        unmount();

        renderInteractiveProductsPage(product, {
            onDeleteProduct,
            deliveryDrafts: [makeDeliveryDraft(product.id)]
        });
        fireEvent.click(screen.getByRole("button", { name: "Delete Medicine" }));
        const deliveryDialog = screen.getByRole("alertdialog", {
            name: "Product cannot be deleted"
        });
        expect(deliveryDialog).toBeVisible();
        expect(deliveryDialog).toHaveTextContent(deliveryMessage);
        fireEvent.click(within(deliveryDialog).getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

        expect(onDeleteProduct).not.toHaveBeenCalled();
    });

    it("explains both active draft restrictions when both workflows reference the product", () => {
        const onDeleteProduct = vi.fn(() => ({ success: true as const }));
        renderInteractiveProductsPage(product, {
            onDeleteProduct,
            saleDrafts: [makeSaleDraft(product.id)],
            deliveryDrafts: [makeDeliveryDraft(product.id)]
        });

        fireEvent.click(screen.getByRole("button", { name: "Delete Medicine" }));

        const dialog = screen.getByRole("alertdialog", {
            name: "Product cannot be deleted"
        });
        expect(dialog).toBeVisible();
        expect(dialog).toHaveTextContent(
            "This product is currently in a Sales draft and cannot be deleted. Please complete or cancel the Sales draft before attempting to delete this product."
        );
        expect(dialog).toHaveTextContent(
            "This product is currently in a Receive Delivery draft and cannot be deleted. Please complete or cancel the Receive Delivery draft before attempting to delete this product."
        );
        expect(onDeleteProduct).not.toHaveBeenCalled();
        fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
        expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    });

    it("displays a deletion failure returned during confirmation", () => {
        const onDeleteProduct = vi.fn(() => ({
            success: false as const,
            error: "The product could not be deleted."
        }));
        renderInteractiveProductsPage(product, { onDeleteProduct });

        fireEvent.click(screen.getByRole("button", { name: "Delete Medicine" }));
        fireEvent.click(screen.getByRole("button", {
            name: "Delete permanently"
        }));

        expect(onDeleteProduct).toHaveBeenCalledWith(product.id);
        expect(screen.getByRole("alertdialog")).toHaveTextContent(
            "The product could not be deleted."
        );
        expect(screen.getByRole("alertdialog")).toHaveTextContent("Cancel");
    });
});
