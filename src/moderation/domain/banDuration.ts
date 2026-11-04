import { isBlank } from "./modAction.js";
import type { ModAction } from "./modAction.js";

const DECIMAL = 10;
/** Banning moderators and banned users are matched within two minutes of the action. */
const BAN_LOG_MATCH_WINDOW_MS = 120_000;

export interface BanDuration {
    /** Days, 0 when permanent; undefined when the text gives no number. */
    readonly days: number | undefined;
    /** How the length reads; undefined when there is no text. */
    readonly label: string | undefined;
}

/** A ban in the subreddit's mod log. */
export interface BanLogEntry {
    readonly id: string;
    readonly moderatorName: string | undefined;
    readonly createdAt: Date;
    readonly details: string | undefined;
    readonly description: string | undefined;
    readonly targetAuthor: string | undefined;
}

export function daysLabel(days: number): string {
    return `${String(days)} day${days === 1 ? "" : "s"}`;
}

export function banLengthLabel(days: number): string {
    return days === 0 ? "Permanent Ban" : daysLabel(days);
}

/**
 * Reads a ban length from free text: "permanent" anywhere, or a number of days ("7 day", "7d"). The pattern does
 * not match a plural "days", so such text is kept as the label, verbatim.
 */
export function parseBanDuration(text: string | undefined): BanDuration {
    const normalized = text?.trim() ?? "";
    if (normalized === "") {
        return { days: undefined, label: undefined };
    }
    if (normalized.toLowerCase().includes("permanent")) {
        return { days: 0, label: "Permanent Ban" };
    }
    // A match starts only at the first digit of a run: the leftmost match does anyway, and it keeps the search linear.
    const dayCount = /(?<!\d)(?<days>\d+)\s*(?:d|day)\b/iu.exec(normalized)?.groups?.["days"];
    if (dayCount === undefined) {
        return { days: undefined, label: normalized };
    }
    const days = Number.parseInt(dayCount, DECIMAL);
    return { days, label: daysLabel(days) };
}

/** Whether a ban says anything about its length; when not, the mod log is consulted. */
export function hasBanDurationMetadata(modAction: ModAction): boolean {
    return (
        modAction.banDuration !== undefined ||
        (modAction.banDurationLabel ?? "").trim() !== "" ||
        (modAction.details ?? "").trim() !== ""
    );
}

/** How a ban's length reads in an alert. */
export function banDurationText(modAction: ModAction): string {
    if (modAction.banDuration !== undefined) {
        return banLengthLabel(modAction.banDuration);
    }
    if (!isBlank(modAction.banDurationLabel)) {
        return modAction.banDurationLabel;
    }
    const details = modAction.details?.trim() ?? "";
    if (details !== "") {
        return details;
    }
    return (
        (isBlank(modAction.description) ? undefined : parseBanDuration(modAction.description).label) ??
        "Unknown Duration"
    );
}

/** Lower-cased, or undefined for no text. */
function comparable(name: string | undefined): string | undefined {
    return isBlank(name) ? undefined : name.toLowerCase();
}

/**
 * The first entry describing this ban: the one with its ID; else one for the same user by the same moderator (or
 * by anyone, when the action names no moderator); else one by the same moderator when the action names no user;
 * else one within two minutes of it for the same user (or for anyone, when the action names no user).
 */
export function matchBanLogEntry(entries: readonly BanLogEntry[], modAction: ModAction): BanLogEntry | undefined {
    const target = comparable(modAction.target?.author);
    const moderator = comparable(modAction.moderatorName);
    const occurredAt = modAction.occurredAt.getTime();

    return entries.find((entry: BanLogEntry): boolean => {
        const entryTarget = comparable(entry.targetAuthor);
        const entryModerator = comparable(entry.moderatorName);
        const withinWindow = Math.abs(entry.createdAt.getTime() - occurredAt) <= BAN_LOG_MATCH_WINDOW_MS;
        return (
            (!isBlank(modAction.id) && entry.id === modAction.id) ||
            (target !== undefined &&
                entryTarget === target &&
                (moderator === undefined || entryModerator === moderator)) ||
            (moderator !== undefined && entryModerator === moderator && target === undefined) ||
            (withinWindow && (target === undefined || entryTarget === target))
        );
    });
}

/** `value`, or `fallback` when `value` is blank and `fallback` is not. */
function unlessBlank(value: string | undefined, fallback: string | undefined): string | undefined {
    return isBlank(value) && !isBlank(fallback) ? fallback : value;
}

/** The ban, completed from its mod log entry: details and reason it lacks, and the length the entry gives. */
export function withBanLogEntry(modAction: ModAction, entry: BanLogEntry): ModAction {
    const parsed = parseBanDuration(entry.details ?? entry.description);
    const fromEntry =
        parsed.days === undefined
            ? { banDurationLabel: unlessBlank(modAction.banDurationLabel, parsed.label) }
            : { banDuration: parsed.days, banDurationLabel: parsed.label ?? modAction.banDurationLabel };
    return {
        ...modAction,
        details: unlessBlank(modAction.details, entry.details),
        description: unlessBlank(modAction.description, entry.description),
        ...fromEntry,
    };
}
