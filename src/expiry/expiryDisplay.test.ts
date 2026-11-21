import { describe, expect, it } from "vitest";
import { getExpiryDisplay } from "./expiryDisplay";

const today = new Date("2026-11-20T23:45:00.000Z");

describe("expiry display", () => {
    it.each([
        ["2027-02-19", 91, "normal", "healthy", "91 days remaining"],
        ["2027-02-18", 90, "near-expiry", "near-expiry", "90 days remaining"],
        ["2026-11-21", 1, "near-expiry", "near-expiry", "1 day remaining"],
        ["2026-11-20", 0, "expires-today", "expired", "Expires today"],
        ["2026-11-19", -1, "expired", "expired", "Expired 1 day ago"],
        ["2026-11-15", -5, "expired", "expired", "Expired 5 days ago"]
    ] as const)(
        "classifies %s as %s",
        (
            expiryDate,
            daysRemaining,
            classification,
            colorCategory,
            remainingLabel
        ) => {
            expect(getExpiryDisplay(expiryDate, today)).toMatchObject({
                daysRemaining,
                classification,
                colorCategory,
                remainingLabel
            });
        }
    );

    it("formats date-only expiry values without shifting their calendar day", () => {
        expect(getExpiryDisplay("2027-03-31", today).dateLabel)
            .toBe("31 Mar 2027");
    });
});
