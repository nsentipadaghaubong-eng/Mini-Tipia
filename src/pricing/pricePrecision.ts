export function hasAtMostTwoDecimalPlaces(value: number): boolean {
    return Number.isFinite(value) &&
        Math.round(value * 100) / 100 === value;
}
