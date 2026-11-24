import {
    Activity,
    ArrowLeftRight,
    Boxes,
    CirclePlus,
    Pencil,
    Search,
    ShoppingCart,
    Trash2,
    Truck,
    type LucideIcon
} from "lucide-react";
import { useMemo, useState } from "react";
import type { ActivityEvent } from "../../../activity/activity";
import {
    ACTIVITY_FILTER_OPTIONS,
    filterActivityEvents,
    formatActivityTime,
    getActivityPresentation,
    groupActivityEvents,
    type ActivityFilterValue
} from "../../../activity/activityPresentation";
import "./ActivityPage.css";

interface ActivityPageProps {
    activityEvents: readonly ActivityEvent[];
}

const eventIcons: Record<ActivityEvent["type"], LucideIcon> = {
    "product.created": CirclePlus,
    "product.updated": Pencil,
    "product.deleted": Trash2,
    "product.variant_added": CirclePlus,
    "product.variant_updated": Pencil,
    "product.variant_removed": Trash2,
    "product.packaging_added": CirclePlus,
    "product.packaging_updated": Pencil,
    "product.packaging_removed": Trash2,
    "inventory.batch_created": Boxes,
    "inventory.batch_updated": Pencil,
    "inventory.batch_removed": Trash2,
    "inventory.stock_adjusted": ArrowLeftRight,
    "delivery.received": Truck,
    "delivery.draft_cancelled": Trash2,
    "sale.completed": ShoppingCart
};

function ActivityEntry({ event }: { event: ActivityEvent }) {
    const presentation = getActivityPresentation(event);
    const Icon = eventIcons[event.type];
    const timestamp = Date.parse(event.occurredAt);

    return (
        <article className="activity-entry">
            <span className="activity-entry-icon" aria-hidden="true">
                <Icon />
            </span>
            <details className="activity-entry-details">
                <summary>
                    <span className="activity-entry-copy">
                        <span className="activity-entry-title">
                            {presentation.title}
                        </span>
                        {presentation.summary !== "" && (
                            <span className="activity-entry-summary">
                                {presentation.summary}
                            </span>
                        )}
                        {presentation.actor && (
                            <span className="activity-entry-actor">
                                {presentation.actor}
                            </span>
                        )}
                    </span>
                    <time
                        className="activity-entry-time"
                        dateTime={Number.isFinite(timestamp)
                            ? new Date(timestamp).toISOString()
                            : undefined}
                    >
                        {formatActivityTime(event.occurredAt)}
                    </time>
                    <span className="activity-entry-toggle">
                        View details
                    </span>
                </summary>
                <div className="activity-recorded-details">
                    <h3>Recorded details</h3>
                    {presentation.details.map((detailSection, sectionIndex) => (
                        <section
                            className="activity-detail-section"
                            key={`${detailSection.title}-${sectionIndex}`}
                        >
                            <h4>{detailSection.title}</h4>
                            <dl className="activity-detail-fields">
                                {detailSection.fields.map((detail, fieldIndex) => (
                                    <div key={`${detail.label}-${fieldIndex}`}>
                                        <dt>{detail.label}</dt>
                                        <dd>{detail.value}</dd>
                                    </div>
                                ))}
                            </dl>
                        </section>
                    ))}
                </div>
            </details>
        </article>
    );
}

export default function ActivityPage({ activityEvents }: ActivityPageProps) {
    const [searchTerm, setSearchTerm] = useState("");
    const [selectedFilter, setSelectedFilter] = useState<ActivityFilterValue>("all");
    const filteredEvents = useMemo(
        () => filterActivityEvents(activityEvents, selectedFilter, searchTerm),
        [activityEvents, selectedFilter, searchTerm]
    );
    const groups = groupActivityEvents(filteredEvents);

    return (
        <section className="activity-page" aria-labelledby="activity-heading">
            <header className="activity-page-header">
                <div>
                    <p className="activity-eyebrow">Audit trail</p>
                    <h2 id="activity-heading">Activity</h2>
                    <p>
                        Changes recorded during this session, shown newest first.
                    </p>
                </div>
                <span className="activity-session-note">
                    <Activity aria-hidden="true" />
                    Session activity
                </span>
            </header>

            <div className="activity-toolbar" aria-label="Activity filters">
                <label className="activity-search-field">
                    <span className="activity-search-label">Search</span>
                    <span className="activity-search-control">
                        <Search aria-hidden="true" />
                        <input
                            type="search"
                            aria-label="Search activity"
                            value={searchTerm}
                            onChange={(event) => setSearchTerm(event.target.value)}
                            placeholder="Product, variant, batch, supplier or customer"
                        />
                    </span>
                </label>
                <label className="activity-filter-field">
                    <span className="activity-filter-label">Activity type</span>
                    <select
                        aria-label="Filter activity type"
                        value={selectedFilter}
                        onChange={(event) =>
                            setSelectedFilter(event.target.value as ActivityFilterValue)
                        }
                    >
                        {ACTIVITY_FILTER_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>
                                {option.label}
                            </option>
                        ))}
                    </select>
                </label>
            </div>

            {activityEvents.length === 0 ? (
                <div className="activity-empty-state">
                    <span aria-hidden="true"><Activity /></span>
                    <h3>No activity recorded yet</h3>
                    <p>
                        Completed product, inventory, delivery, and sale actions
                        will appear here.
                    </p>
                </div>
            ) : groups.length === 0 ? (
                <div className="activity-empty-state">
                    <span aria-hidden="true"><Activity /></span>
                    <h3>No matching activity found</h3>
                    <p>
                        Try a different search or activity filter.
                    </p>
                </div>
            ) : (
                <div className="activity-timeline">
                    {groups.map((group) => (
                        <section
                            className="activity-date-group"
                            key={group.key}
                            aria-label={group.label}
                        >
                            <h3 className="activity-date-heading">
                                {group.label}
                            </h3>
                            <div className="activity-entry-list">
                                {group.events.map((event) => (
                                    <ActivityEntry
                                        key={event.eventId}
                                        event={event}
                                    />
                                ))}
                            </div>
                        </section>
                    ))}
                </div>
            )}
        </section>
    );
}
