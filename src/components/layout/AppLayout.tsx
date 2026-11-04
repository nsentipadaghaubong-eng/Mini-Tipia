
import type { ReactNode } from "react";
import {
    Activity,
    Boxes,
    LayoutDashboard,
    Package,
    ShoppingCart,
    Truck,
} from "lucide-react";

interface AppLayoutProps {
    children: ReactNode;
    activePage: "products" | "inventory";
    onNavigate: (page: "products" | "inventory") => void;
}

export default function AppLayout({
    children,
    activePage,
    onNavigate
}: AppLayoutProps) {
    return (
        <div className="app-layout">
            <aside className="sidebar">
                <h2>Tipia</h2>

                <nav>
                    <a href="#">
                        <LayoutDashboard aria-hidden="true" />
                        <span>Dashboard</span>
                    </a>
                    <a
                        href="#products"
                        aria-current={activePage === "products" ? "page" : undefined}
                        onClick={() => onNavigate("products")}
                    >
                        <Package aria-hidden="true" />
                        <span>Products</span>
                    </a>
                    <a
                        href="#inventory"
                        aria-current={activePage === "inventory" ? "page" : undefined}
                        onClick={() => onNavigate("inventory")}
                    >
                        <Boxes aria-hidden="true" />
                        <span>Inventory</span>
                    </a>
                    <a href="#">
                        <Truck aria-hidden="true" />
                        <span>Receive Delivery</span>
                    </a>
                    <a href="#">
                        <ShoppingCart aria-hidden="true" />
                        <span>Sales</span>
                    </a>
                    <a href="#">
                        <Activity aria-hidden="true" />
                        <span>Activity</span>
                    </a>
                </nav>
            </aside>

            <div className="main-area">
                <header className="app-header">
                    <h1>Pharmacy Management</h1>
                </header>

                <main className="page-content">
                    {children}
                </main>
            </div>
        </div>
    );
}
