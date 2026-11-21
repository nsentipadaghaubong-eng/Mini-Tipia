import { ACTIVITY_TIME_ZONE } from "../activity/activityPresentation";

const millisecondsPerDay = 24 * 60 * 60 * 1000;

export type ExpiryClassification =
    | "normal"
    | "near-expiry"
    | "expires-today"
    | "expired";

export type ExpiryColorCategory =
    | "healthy"
    | "near-expiry"
    | "expired";

export interface ExpiryDisplay {
    dateLabel: string;
    daysRemaining: number;
    classification: ExpiryClassification;
    colorCategory: ExpiryColorCategory;
    remainingLabel: string;
}

function createUtcDate(
    year: number,
    month: number,
    day: number,
    hour = 0
): Date {
    const date = new Date(0);
    date.setUTCHours(hour, 0, 0, 0);
    date.setUTCFullYear(year, month, day);
    return date;
}

function parseExpiryDate(value: Date | string): Date {
    if (value instanceof Date) {
        if (!Number.isFinite(value.getTime())) {
            throw new Error("Expiry date must be a valid date.");
        }
        return value;
    }

    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    if (!match) {
        throw new Error("Expiry date must be a valid date in YYYY-MM-DD format.");
    }

    const [, yearText, monthText, dayText] = match;
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const date = createUtcDate(year, month - 1, day);
    if (
        date.getUTCFullYear() !== year ||
        date.getUTCMonth() !== month - 1 ||
        date.getUTCDate() !== day
    ) {
        throw new Error("Expiry date must be a valid calendar date.");
    }
    return date;
}

function utcDayNumber(date: Date): number {
    return Math.floor(createUtcDate(
        date.getUTCFullYear(),
        date.getUTCMonth(),
        date.getUTCDate()
    ).getTime() / millisecondsPerDay);
}

export function getExpiryDisplay(
    value: Date | string,
    today: Date = new Date()
): ExpiryDisplay {
    if (!Number.isFinite(today.getTime())) {
        throw new Error("Current date must be valid.");
    }

    const expiryDate = parseExpiryDate(value);
    const daysRemaining = utcDayNumber(expiryDate) - utcDayNumber(today);
    const classification: ExpiryClassification = daysRemaining < 0
        ? "expired"
        : daysRemaining === 0
            ? "expires-today"
            : daysRemaining <= 90
                ? "near-expiry"
                : "normal";
    const colorCategory: ExpiryColorCategory = classification === "normal"
        ? "healthy"
        : classification === "near-expiry"
                ? "near-expiry"
                : "expired";
    const remainingLabel = classification === "expired"
        ? `Expired ${Math.abs(daysRemaining)} ${daysRemaining === -1 ? "day" : "days"} ago`
        : classification === "expires-today"
            ? "Expires today"
            : `${daysRemaining} ${daysRemaining === 1 ? "day" : "days"} remaining`;
    const dateLabel = new Intl.DateTimeFormat("en-NG", {
        timeZone: ACTIVITY_TIME_ZONE,
        day: "numeric",
        month: "short",
        year: "numeric"
    }).format(createUtcDate(
        expiryDate.getUTCFullYear(),
        expiryDate.getUTCMonth(),
        expiryDate.getUTCDate(),
        12
    ));

    return {
        dateLabel,
        daysRemaining,
        classification,
        colorCategory,
        remainingLabel
    };
}
