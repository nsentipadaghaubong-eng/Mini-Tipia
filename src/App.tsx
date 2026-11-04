
import { useState } from "react";
import AppLayout from "./components/layout/AppLayout";
import InventoryPage from "./features/inventory/pages/InventoryPage";
import ProductsPage from "./features/products/pages/ProductsPage";
import type { inventory } from "./inventory/inventoryStock";
import { demoInventory } from "./data/demoInventory";

function App() {
    const [activePage, setActivePage] =
        useState<"products" | "inventory">("inventory");
    const [inventoryRecords, setInventoryRecords] =
        useState<inventory[]>(() => demoInventory);

    return (
        <AppLayout
            activePage={activePage}
            onNavigate={setActivePage}
        >
            <div hidden={activePage !== "products"}>
                <ProductsPage inventoryRecords={inventoryRecords} />
            </div>
            <div hidden={activePage !== "inventory"}>
                <InventoryPage
                    inventoryRecords={inventoryRecords}
                    onInventoryChange={setInventoryRecords}
                />
            </div>
        </AppLayout>
    );
}

export default App;
