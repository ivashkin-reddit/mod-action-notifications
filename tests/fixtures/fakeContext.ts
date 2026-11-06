import { vi } from "vitest";
import type { Mock } from "vitest";
import { createFakeReddit } from "./fakeReddit.js";
import type { FakeReddit } from "./fakeReddit.js";
import { createFakeRedis } from "./fakeRedis.js";
import type { FakeRedis } from "./fakeRedis.js";
import { createFakeScheduler } from "./fakeScheduler.js";
import type { FakeScheduler } from "./fakeScheduler.js";

/**
 * A stand-in for the Devvit context the app's handlers receive. It implements only the members the app uses, and
 * returns Reddit listings synchronously, as Devvit does. Every method is a vi.fn, so a test can make one fail
 * (`mockRejectedValueOnce`) or count its calls; a listing fails through its `all` mock.
 */

export const SUBREDDIT = "testsub";
export const BOT_TOKEN = "xoxb-test-token";
/** The channel alerts go to by default: the Notification Channel, as its ID. */
export const CHANNEL = "C0123MODS";

const DEFAULT_MODQUEUE_THRESHOLD = 50;
const DEFAULT_UNMODERATED_AGE_HOURS = 24;
const DEFAULT_REPORTED_CONTENT_AGE_HOURS = 24;
const DEFAULT_POST_DELETION_UPVOTE_THRESHOLD = 100;

/** Installation settings as a moderator would have saved them. Keys are the setting names the app registers. */
export interface Settings {
    /** The app-wide secret, which Devvit reads through the same settings client. */
    slackBotToken?: unknown;
    enabledActions?: unknown;
    excludedModerators?: unknown;
    flagUnknownModerators?: unknown;
    securityAlerts?: unknown;
    dormantModeratorDays?: unknown;
    includeModNote?: unknown;
    banHistoryDays?: unknown;
    notificationChannel?: unknown;
    alertChannel?: unknown;
    slackRetentionDays?: unknown;
    modqueueThreshold?: unknown;
    unmoderagedAgeHours?: unknown;
    reportedContentAgeHours?: unknown;
    spamQueueThreshold?: unknown;
    editedQueueThreshold?: unknown;
    modmailWaitHours?: unknown;
    urgentReportReasons?: unknown;
    reportPileUpThreshold?: unknown;
    adminModmailAlerts?: unknown;
    enableAutoModAlerts?: unknown;
    postDeletionUpvoteThreshold?: unknown;
    dailySummary?: unknown;
    weeklyStatistics?: unknown;
}

/** The app's own setting defaults, with Slack set up: a bot token and a notification channel. */
export function defaultSettings(): Settings {
    return {
        slackBotToken: BOT_TOKEN,
        notificationChannel: CHANNEL,
        enabledActions: ["removelink", "removecomment", "spamlink", "spamcomment", "banuser", "unbanuser"],
        flagUnknownModerators: true,
        includeModNote: true,
        modqueueThreshold: DEFAULT_MODQUEUE_THRESHOLD,
        unmoderagedAgeHours: DEFAULT_UNMODERATED_AGE_HOURS,
        reportedContentAgeHours: DEFAULT_REPORTED_CONTENT_AGE_HOURS,
        enableAutoModAlerts: false,
        postDeletionUpvoteThreshold: DEFAULT_POST_DELETION_UPVOTE_THRESHOLD,
    };
}

/** A modqueue entry. Posts have a title; comments do not. */
export interface Toast {
    readonly text: string;
    readonly appearance?: string;
}

export interface FakeContext {
    readonly subredditId: string;
    readonly subredditName: string;
    readonly appVersion: string;
    readonly settings: Readonly<{ get: Mock<(name: string) => Promise<unknown>> }>;
    readonly redis: FakeRedis;
    readonly reddit: FakeReddit;
    readonly scheduler: FakeScheduler;
    readonly ui: Readonly<{
        showToast: Mock<(toast: Toast) => void>;
        showForm: Mock<(formKey: string, data?: Readonly<Record<string, unknown>>) => void>;
    }>;
}

/** A form the app showed, and the data it showed it with. */
export type ShownForm = Readonly<{ key: string; data: Readonly<Record<string, unknown>> }>;

export interface CreatedContext {
    readonly context: FakeContext;
    readonly toasts: readonly Toast[];
    readonly shownForms: readonly ShownForm[];
}

/**
 * A context reading `settings`, which the test may change later. `subredditId` names the installation: one app
 * process can serve several.
 */
export function createFakeContext(settings: Readonly<Settings>, subredditId = "t5_testsub"): CreatedContext {
    const toasts: Toast[] = [];
    const shownForms: ShownForm[] = [];
    const settingValues: Readonly<Record<string, unknown>> = settings;
    return {
        context: {
            subredditId,
            subredditName: SUBREDDIT,
            appVersion: "1.2.3",
            settings: {
                get: vi.fn(async (name: string): Promise<unknown> => await Promise.resolve(settingValues[name])),
            },
            redis: createFakeRedis(),
            reddit: createFakeReddit(SUBREDDIT),
            scheduler: createFakeScheduler(),
            ui: {
                showToast: vi.fn((toast: Toast): void => {
                    toasts.push(toast);
                }),
                showForm: vi.fn((formKey: string, data: Readonly<Record<string, unknown>> = {}): void => {
                    shownForms.push({ key: formKey, data });
                }),
            },
        },
        toasts,
        shownForms,
    };
}
