import type { productStructure } from "./productStructure";
import type { inventoryBatch } from "../inventory/inventoryBatch";

export type ProductFilter =
    | "all"
    | "single-variant"
    | "multiple-variants"
    | "with-batches"
    | "without-batches";

export function isProductFilter(value: string): value is ProductFilter {
    return value === "all" ||
        value === "single-variant" ||
        value === "multiple-variants" ||
        value === "with-batches" ||
        value === "without-batches";
}

function normalizeSearchValue(value: string | undefined): string {
    return value?.trim().toLowerCase() ?? "";
}

export function searchProducts(
    products: productStructure[],
    searchTerm: string
): productStructure[] {
    const query = normalizeSearchValue(searchTerm);
    if (query === "") {
        return products;
    }

    return products.filter((product) => {
        const productFields = [
            product.name,
            product.genericName,
            product.manufacturer
        ];

        return productFields.some((value) =>
            normalizeSearchValue(value).includes(query)
        ) || product.variant.some((productVariant) =>
            [
                productVariant.variantName,
                productVariant.nafdacRegistrationNumber
            ].some((value) => normalizeSearchValue(value).includes(query))
        );
    });
}

export function filterProducts(
    products: productStructure[],
    filter: ProductFilter,
    batches: inventoryBatch[]
): productStructure[] {
    switch (filter) {
        case "all":
            return products;
        case "single-variant":
            return products.filter((product) => product.variant.length === 1);
        case "multiple-variants":
            return products.filter((product) => product.variant.length > 1);
        case "with-batches":
            return products.filter((product) =>
                product.variant.some((productVariant) =>
                    batches.some((batch) =>
                        batch.productId === product.id &&
                        batch.variantId === productVariant.id
                    )
                )
            );
        case "without-batches":
            return products.filter((product) =>
                product.variant.every((productVariant) =>
                    !batches.some((batch) =>
                        batch.productId === product.id &&
                        batch.variantId === productVariant.id
                    )
                )
            );
    }
}

export function getProductEmptyState(
    totalProducts: number,
    searchMatchCount: number,
    resultCount: number,
    searchTerm: string,
    filter: ProductFilter
): string | undefined {
    if (totalProducts === 0) {
        return "No products yet. Create a product to get started.";
    }

    if (resultCount > 0) {
        return undefined;
    }

    const query = searchTerm.trim();
    if (query !== "" && searchMatchCount === 0) {
        return `No products match "${query}".`;
    }

    const filterLabel = filter === "all"
        ? "All products"
        : filter === "single-variant"
            ? "Single variant"
            : filter === "multiple-variants"
                ? "Multiple variants"
                : filter === "with-batches"
                    ? "With batches"
                    : "Without batches";

    return `No products match the ${filterLabel.toLowerCase()} filter.`;
}
