import type { ApplicationState } from "../applicationState";
import type {
    ApplicationStateHydration,
    HydratedRecord
} from "./applicationStateHydration";

function availableDomainValues<TSource, TDomain>(
    records: readonly HydratedRecord<TSource, TDomain>[]
): TDomain[] {
    return records.flatMap(({ domainProjection }) =>
        domainProjection.status === "available"
            ? [domainProjection.value]
            : []
    );
}

export function createApplicationStateFromHydration(
    hydration: ApplicationStateHydration
): ApplicationState {
    return {
        products: availableDomainValues(hydration.products),
        inventoryRecords: availableDomainValues(hydration.inventoryRecords),
        inventoryBatches: availableDomainValues(hydration.inventoryBatches),
        activityEvents: availableDomainValues(hydration.activityEvents),
        sales: availableDomainValues(hydration.completedSales),
        saleDrafts: availableDomainValues(hydration.activeSaleDrafts),
        deliveryDrafts: availableDomainValues(hydration.activeDeliveryDrafts)
    };
}
