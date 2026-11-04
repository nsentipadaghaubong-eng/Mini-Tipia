export interface packagingLevel{
    id: string;
    name: string;
    costPrice: number|null;
    sellingPrice: number|null;
    quantityofNextLevel:number|null;
    nextLevelId: string|null;

}