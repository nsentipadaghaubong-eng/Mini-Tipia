import { useState } from "react";
import { getAllInventoryDisplay } from "../../../inventory/inventoryLookup";
import "./InventoryPage.css";

export default function InventoryPage() {
    const [searchTerm, setSearchTerm] = useState("");

    const inventoryRecords = getAllInventoryDisplay();

    const filteredRecords = inventoryRecords.filter((record) =>
        record.productName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        record.variantName.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (record.batchNumber ?? "").toLowerCase().includes(searchTerm.toLowerCase())
    );

    return (
        <section className="inventory-page">
            <div className="page-heading">
                <div>
                    <h2>Inventory management</h2>
                    <p>Manage pharmacy products, batches, and stock levels.</p>
                </div>

                <button className="primary-button" type="button">
                    Adjust Stock
                </button>
            </div>

            <div className="inventory-toolbar">
                <label className="inventory-search">
                    <span className="visually-hidden">Search inventory</span>
                    <input
                        type="search"
                        placeholder="Search products, variants, or batches"
                        value={searchTerm}
                        onChange={(event) => setSearchTerm(event.target.value)}
                    />
                </label>

                <label className="visually-hidden" htmlFor="stock-filter">
                    Filter by stock level
                </label>
                <select id="stock-filter" defaultValue="all">
                    <option value="all">All stock</option>
                    <option value="in-stock">In stock</option>
                    <option value="low-stock">Low stock</option>
                    <option value="out-of-stock">Out of stock</option>
                </select>
            </div>

            <div className="inventory-table-container">
                <table className="inventory-table">
                    <thead>
                        <tr>
                            <th>Product</th>
                            <th>Variant</th>
                            <th>Batch</th>
                            <th>Expiry Date</th>
                            <th>Stock</th>
                            <th>Action</th>
                        </tr>
                    </thead>

                    <tbody>
                        {filteredRecords.length === 0 ? (
                            <tr>
                                <td className="empty-state" colSpan={6}>
                                    <strong>No inventory found</strong>
                                    No inventory records to display.
                                </td>
                            </tr>
                        ) : (
                            filteredRecords.map((record) => (
                                <tr
                                    key={`${record.productName}-${record.variantName}-${record.batchNumber}`}
                                >
                                    <td className="product-name">{record.productName}</td>

                                    <td><span className="variant-pill">{record.variantName}</span></td>

                                    <td className="batch-number">{record.batchNumber ?? "N/A"}</td>

                                    <td>
                                        {record.expiryDate.toLocaleDateString()}
                                    </td>

                                    <td>
                                        {record.stockQuantities.map((stock) => {
                                            const packagingLevel =
                                                record.packagingLevels.find(
                                                    (level) =>
                                                        level.id === stock.packagingLevelId
                                                );

                                            return (
                                                <div className="stock-item" key={stock.packagingLevelId}>
                                                    <span className="stock-quantity">{stock.quantity}</span>
                                                    <span>{packagingLevel?.name ?? "Unknown"}</span>
                                                </div>
                                            );
                                        })}
                                    </td>

                                    <td>
                                        <button className="secondary-button" type="button">View</button>
                                    </td>
                                </tr>
                            ))
                        )}
                    </tbody>
                </table>
            </div>
        </section>
    );
}