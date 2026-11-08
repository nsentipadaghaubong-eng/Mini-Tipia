import {
    addStock,
    adjustStock,
    breakdownPackaging,
    buildUpPackaging,
    createInventory,
    getStockQuantity,
    removeStock
} from "./inventoryStock.ts";
import { products } from "../products/productList.ts";
import { demoInventoryBatches } from "./inventoryBatchList.ts";

// Create inventory for Panadol
const panadolInventory = createInventory(
    products.id,
    products.variant[0].id,
    demoInventoryBatches[0].batchId,
    [
        { packagingLevelId: "box", quantity: 2 },
        { packagingLevelId: "pack", quantity: 3 },
        { packagingLevelId: "card", quantity: 7 }
    ]
);


const updatedPanadolInventory = addStock(
    products,
    panadolInventory,
    "card",
    5
);

const packagingBreakdown = breakdownPackaging(
    products,
    panadolInventory,
    "box",
    "pack",
    1
);

const deductedPanadolInventory = removeStock(
    products,
    packagingBreakdown,
    "pack",
    2
);
const testInventory = createInventory(
    products.id,
    products.variant[0].id,
    demoInventoryBatches[0].batchId,
    [
        { packagingLevelId: "box", quantity: 2 },
        { packagingLevelId: "pack", quantity: 17 },
        { packagingLevelId: "card", quantity: 4 }
    ]
);

const builtUpInventory = buildUpPackaging(
    products,
    testInventory,
    "box",
    "pack"
);

const adjustedPanadolInventory = adjustStock(
    products,
    testInventory,
    "card",
    2
);


const packagingLevelId = "pack";
const quantityLeft = getStockQuantity(
    deductedPanadolInventory,
    packagingLevelId
);

console.log("Original inventory:");
console.log(panadolInventory);

console.log("Updated inventory:");
console.log(updatedPanadolInventory);


console.log(
    `Packaging level: ${packagingLevelId}, quantity left: ${quantityLeft}`
);



console.log("Packaging Breakdown:");
console.log(packagingBreakdown);

console.log("Deducted inventory:");
console.log(deductedPanadolInventory);

console.log("Before build-up:", testInventory);
console.log("After build-up:", builtUpInventory);

console.log("Before adjustment:", testInventory);
console.log("After adjustment:", adjustedPanadolInventory);