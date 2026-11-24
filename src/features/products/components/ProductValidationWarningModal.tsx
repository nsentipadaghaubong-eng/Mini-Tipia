import "./ProductValidationWarningModal.css";

interface ProductValidationWarningModalProps {
    title: string;
    description: string;
    errors: readonly string[];
    onCancel: () => void;
}

export default function ProductValidationWarningModal({
    title,
    description,
    errors,
    onCancel
}: ProductValidationWarningModalProps) {
    return (
        <div className="inventory-modal-overlay">
            <section
                aria-describedby="product-validation-warning-description"
                aria-labelledby="product-validation-warning-title"
                aria-modal="true"
                className="inventory-modal product-validation-warning-modal"
                role="alertdialog"
            >
                <div className="inventory-modal-header">
                    <h2 id="product-validation-warning-title">{title}</h2>
                </div>
                <div className="inventory-modal-content">
                    <p id="product-validation-warning-description">
                        {description}
                    </p>
                    <ul>
                        {errors.map((error, index) => (
                            <li key={`${index}-${error}`}>{error}</li>
                        ))}
                    </ul>
                </div>
                <footer className="product-validation-warning-actions">
                    <button
                        autoFocus
                        className="secondary-button"
                        onClick={onCancel}
                        type="button"
                    >
                        Cancel
                    </button>
                </footer>
            </section>
        </div>
    );
}
