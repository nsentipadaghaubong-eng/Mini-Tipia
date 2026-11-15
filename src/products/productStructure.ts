import type { packagingLevel } from "../packaging/packagingHierarchy";

export interface productStructure {
    id: string;
    name: string;
    description?: string;
    genericName?: string;
    manufacturer?: string;
    category?: string;
    variant: variant[]
}

export interface variant {
    id: string;
    variantName: string;
    nafdacRegistrationNumber?: string;
    packagingHierarchy: packagingLevel[]

}