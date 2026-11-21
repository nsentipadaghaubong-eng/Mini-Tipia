import { describe, expect, it } from "vitest";
import {
    getExpiryDisplay,
    isExpiryDateExpired
} from "./expiryDisplay";

const today = new Date("2026-11-20T22:30:00.000Z");

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

    it("uses the Africa/Lagos calendar day at midnight boundaries", () => {
        expect(getExpiryDisplay(
            "2026-11-20",
            new Date("2026-11-19T23:30:00.000Z")
        ).classification).toBe("expires-today");

        expect(getExpiryDisplay(
            "2026-11-20",
            new Date("2026-11-20T22:30:00.000Z")
        ).classification).toBe("expires-today");

        expect(getExpiryDisplay(
            "2026-11-20",
            new Date("2026-11-20T23:30:00.000Z")
        ).classification).toBe("expired");
    });

    it("preserves one and ninety-one day boundaries", () => {
        const lagosToday = new Date("2026-11-20T22:30:00.000Z");

        expect(getExpiryDisplay("2026-11-19", lagosToday).remainingLabel)
            .toBe("Expired 1 day ago");
        expect(getExpiryDisplay("2026-11-21", lagosToday).daysRemaining)
            .toBe(1);
        expect(getExpiryDisplay("2027-02-18", lagosToday).daysRemaining)
            .toBe(90);
        expect(getExpiryDisplay("2027-02-19", lagosToday).daysRemaining)
            .toBe(91);
    });

    it("handles month, year, and leap-year boundaries", () => {
        expect(getExpiryDisplay(
            "2027-01-01",
            new Date("2026-12-31T22:30:00.000Z")
        ).daysRemaining).toBe(1);
        expect(getExpiryDisplay(
            "2028-02-29",
            new Date("2028-02-28T22:30:00.000Z")
        ).daysRemaining).toBe(1);
    });

    it("classifies date-only and UTC-midnight Date values identically", () => {
        const lagosToday = new Date("2026-11-20T22:30:00.000Z");
        const dateOnly = getExpiryDisplay("2026-11-20", lagosToday);
        const utcDate = getExpiryDisplay(
            new Date("2026-11-20T00:00:00.000Z"),
            lagosToday
        );

        expect(utcDate).toEqual(dateOnly);
        expect(isExpiryDateExpired(
            new Date("2026-11-20T00:00:00.000Z"),
            new Date("2026-11-20T23:30:00.000Z")
        )).toBe(true);
    });
});
