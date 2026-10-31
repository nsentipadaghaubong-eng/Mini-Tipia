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

// Create inventory for Panadol
const panadolInventory = createInventory(
    products.id,
    products.variant[0].id,
     products.variant[0].batches[0].batchNumber,
    [
        { packagingLevelId: "box", quantity: 2 },
        { packagingLevelId: "pack", quantity: 3 },
        { packagingLevelId: "card", quantity: 7 }
    ]
);


const updatedPanadolInventory = addStock(
    panadolInventory,
    "card",
    5
);

const packagingBreakdown = breakdownPackaging(
    panadolInventory,
    "box",
    "pack",
    5,
    1
);

const deductedPanadolInventory = removeStock(
    packagingBreakdown,
    "pack",
    2
);
const testInventory = createInventory(
    products.id,
    products.variant[0].id,
    products.variant[0].batches[0].batchNumber,
    [
        { packagingLevelId: "box", quantity: 2 },
        { packagingLevelId: "pack", quantity: 17 },
        { packagingLevelId: "card", quantity: 4 }
    ]
);

const builtUpInventory = buildUpPackaging(
    testInventory,
    "box",
    "pack",
    5
);

const adjustedPanadolInventory = adjustStock(
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