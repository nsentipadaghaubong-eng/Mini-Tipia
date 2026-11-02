
import type { ReactNode } from "react";

interface AppLayoutProps {
    children: ReactNode;
}

export default function AppLayout({ children }: AppLayoutProps) {
    return (
        <div className="app-layout">
            <aside className="sidebar">
                <h2>Tipia</h2>

                <nav>
                    <a href="#">Dashboard</a>
                    <a href="#">Products</a>
                    <a href="#">Inventory</a>
                    <a href="#">Receive Delivery</a>
                    <a href="#">Sales</a>
                    <a href="#">Activity</a>
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
