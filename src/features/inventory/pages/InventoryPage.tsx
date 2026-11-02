export default function InventoryPage() {
    return (
        <section className="inventory-page">
            <div className="page-heading">
                <div>
                    <h2>Inventory</h2>
                    <p>Manage and monitor your pharmacy stock.</p>
                </div>

                <button>
                    Adjust Stock
                </button>
            </div>

            <div className="inventory-toolbar">
                <input
                    type="text"
                    placeholder="Search products..."
                />

                <select defaultValue="all">
                    <option value="all">All stock</option>
                    <option value="in-stock">In stock</option>
                    <option value="low-stock">Low stock</option>
                    <option value="out-of-stock">Out of stock</option>
                </select>
            </div>

            <div className="inventory-table-container">
                <table>
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
                        <tr>
                            <td colSpan={6}>
                                No inventory records to display.
                            </td>
                        </tr>
                    </tbody>
                </table>
            </div>
        </section>
    );
}