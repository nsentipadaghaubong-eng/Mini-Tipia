import type { packagingLevel } from "../packaging/packagingHierarchy";

export interface productStructure {
    id: string;
    name: string;
    variant: variant[]
}

export interface variant {
    id: string;
    variantName: string;
    batches: batch[];
    packagingHierarchy: packagingLevel[]

}

export interface batch{
    batchId: string;
    batchNumber: string|null;
    expiryDate:Date;
}