import { describe, expect, it } from "vitest";
import { NOW } from "../../../tests/fixtures/app.js";
import {
    atLeastHoursOld,
    countByKind,
    hoursWaiting,
    isAlertOn,
    isMonitoringEnabled,
    isQueueTooLong,
} from "./monitoring.js";
import type { MonitorThresholds, QueueItem } from "./monitoring.js";

const TEST_OPTIONS = { timeout: 1000 };
const HOUR = 3_600_000;

/** An item created `hoursAgo` hours before NOW. */
function item(kind: QueueItem["kind"], hoursAgo: number, permalink = `/${kind}/${String(hoursAgo)}`): QueueItem {
    return { kind, id: "t3_p", postId: "t3_p", createdAt: new Date(NOW.getTime() - hoursAgo * HOUR), permalink };
}

const OFF: MonitorThresholds = { queueSizeThreshold: 0, unmoderatedAgeHours: 0, reportedAgeHours: 0 };

describe("an alert's threshold", (): void => {
    it("turns the alert off at 0 and on above it", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect([isAlertOn(0), isAlertOn(1), isAlertOn(24)]).toStrictEqual([false, true, true]);
    });
});

describe("monitoring", (): void => {
    it.each([
        ["no alert is on", OFF, false],
        ["the queue size alert is on", { ...OFF, queueSizeThreshold: 50 }, true],
        ["the unmoderated age alert is on", { ...OFF, unmoderatedAgeHours: 24 }, true],
        ["the reported age alert is on", { ...OFF, reportedAgeHours: 24 }, true],
    ])(
        "is enabled when %s: %j",
        TEST_OPTIONS,
        (_label: string, thresholds: MonitorThresholds, enabled: boolean): void => {
            expect.hasAssertions();

            expect(isMonitoringEnabled(thresholds)).toBe(enabled);
        },
    );
});

describe("a modqueue that is too long", (): void => {
    it.each([
        [49, 50, false],
        [50, 50, true],
        [500, 50, true],
        [500, 0, false],
    ])(
        "holds %i items against a threshold of %i: %j",
        TEST_OPTIONS,
        (size: number, threshold: number, tooLong: boolean): void => {
            expect.hasAssertions();

            expect(isQueueTooLong(size, threshold)).toBe(tooLong);
        },
    );
});

describe("counting queued items", (): void => {
    it("counts posts and comments apart", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(countByKind([item("post", 1), item("comment", 2), item("comment", 3)])).toStrictEqual({
            posts: 1,
            comments: 2,
        });
    });

    it("counts none in an empty queue", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(countByKind([])).toStrictEqual({ posts: 0, comments: 0 });
    });
});

describe("how long an item has waited", (): void => {
    it("is in whole hours, rounded down", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const waited: QueueItem = {
            kind: "post",
            id: "t3_p",
            postId: "t3_p",
            createdAt: new Date(NOW.getTime() - 2 * HOUR - 59 * 60_000),
            permalink: "/p",
        };

        expect(hoursWaiting(waited, NOW.getTime())).toBe(2);
    });
});

describe("items at least an age old", (): void => {
    it("include those exactly that old, oldest first", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const items = [item("post", 30), item("comment", 23), item("post", 24), item("comment", 48)];

        expect(atLeastHoursOld(items, 24, NOW.getTime()).map((old: QueueItem): string => old.permalink)).toStrictEqual([
            "/comment/48",
            "/post/30",
            "/post/24",
        ]);
    });

    it("leave the given list as it was", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        const items = [item("post", 30), item("post", 48)];
        atLeastHoursOld(items, 24, NOW.getTime());

        expect(items.map((listed: QueueItem): string => listed.permalink)).toStrictEqual(["/post/30", "/post/48"]);
    });

    it("are none when nothing has waited long enough", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(atLeastHoursOld([item("post", 1)], 24, NOW.getTime())).toStrictEqual([]);
    });
});
