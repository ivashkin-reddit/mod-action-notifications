import type { TriggerContext } from "@devvit/public-api";
import type { QueueDependencies } from "./drain.js";
import { escapeText, inChannel } from "./message.js";
import { CONTINUE_SOON_MS, scheduleDrain } from "./schedule.js";
import { checkToken, failureDetail, postDirectly } from "./webApi.js";
import type { Delivery, Posted, SlackApi } from "./webApi.js";

/**
 * The installation's connection to Slack: the bot token of the Slack app its moderators made in their own workspace
 * from slack-app/manifest.json, and the workspace's name. Kept, without expiry, until they connect another or
 * disconnect it, or uninstall the app. The token goes into a request's authorization header and nowhere else: no
 * form, log line or message shows it.
 */
const CONNECTION_KEY = "slack_connection";
/** A Slack app's bot token starts so; a user's (xoxp-) or an app-level token (xapp-) does not. */
const BOT_TOKEN_PREFIX = "xoxb-";

export type SlackConnection = Readonly<{ token: string; team: string }>;

export type ConnectionRedis = Readonly<Pick<TriggerContext["redis"], "get" | "set" | "del">>;

function isConnection(value: unknown): value is SlackConnection {
    return (
        typeof value === "object" &&
        value !== null &&
        "token" in value &&
        typeof value.token === "string" &&
        "team" in value &&
        typeof value.team === "string"
    );
}

/** The connection the moderators made; undefined when there is none, or what is stored is not this app's. */
export async function readConnection(redis: ConnectionRedis): Promise<SlackConnection | undefined> {
    const stored = await redis.get(CONNECTION_KEY);
    if (stored === undefined) {
        return undefined;
    }
    try {
        const connection: unknown = JSON.parse(stored);
        return isConnection(connection) ? connection : undefined;
    } catch {
        // Not JSON: not a connection this app stored.
        return undefined;
    }
}

/** How connecting went: connected to the named workspace, or why not, with Slack's error. */
export type Connecting =
    | Readonly<{ outcome: "connected"; team: string }>
    | Readonly<{ outcome: "not-a-bot-token" }>
    | Readonly<{ outcome: "token-refused"; detail: string }>
    | Readonly<{ outcome: "channel-refused"; channel: string; detail: string }>;

/**
 * A connection to make: Slack, called with the token to connect, the channels alerts go to, and the subreddit whose
 * alerts they are.
 */
export type ConnectRequest = Readonly<{ api: SlackApi; channels: readonly string[]; subredditName: string }>;

/** Posts to each channel that alerts will come there; the first channel Slack refused, if any. */
async function firstRefusal({ api, channels, subredditName }: ConnectRequest): Promise<Connecting | undefined> {
    const deliveries = await Promise.all(
        channels.map(
            async (channel: string): Promise<Delivery<Posted>> =>
                await postDirectly(
                    api,
                    inChannel(
                        { text: `🔗 Connected: r/${escapeText(subredditName)}'s alerts come to this channel.` },
                        channel,
                    ),
                ),
        ),
    );
    const index = deliveries.findIndex(
        ({ outcome }: Readonly<{ outcome: string }>): boolean => outcome !== "delivered",
    );
    const refused = deliveries[index];
    return refused === undefined || refused.outcome === "delivered"
        ? undefined
        : { outcome: "channel-refused", channel: channels[index] ?? "", detail: failureDetail(refused.failure) };
}

/**
 * Connects the installation to the workspace whose bot token this is. Slack is asked whose the token is, and posts to
 * each of the channels that alerts will come there; only then is the token kept, in place of any before it. A drain
 * then delivers what was queued: no drain delivers while Slack is not connected. Rejects only when Redis fails.
 */
/** The workspace whose bot token this is, as Slack says; why not, when it is not a bot token Slack takes. */
async function workspaceOf(api: SlackApi): Promise<Readonly<{ team: string }> | Connecting> {
    if (!api.token.startsWith(BOT_TOKEN_PREFIX)) {
        return { outcome: "not-a-bot-token" };
    }
    const checked = await checkToken(api);
    return checked.outcome === "delivered"
        ? checked.answer
        : { outcome: "token-refused", detail: failureDetail(checked.failure) };
}

export async function connectSlack(queue: QueueDependencies, request: ConnectRequest): Promise<Connecting> {
    const checked = await workspaceOf(request.api);
    if ("outcome" in checked) {
        return checked;
    }
    const refused = await firstRefusal(request);
    if (refused !== undefined) {
        return refused;
    }
    const connection: SlackConnection = { token: request.api.token, team: checked.team };
    await queue.redis.set(CONNECTION_KEY, JSON.stringify(connection));
    await scheduleDrain(queue, CONTINUE_SOON_MS);
    return { outcome: "connected", team: connection.team };
}

/** Forgets the connection: no alerts are sent until one is made, and what was queued waits for it. */
export async function disconnectSlack(redis: ConnectionRedis): Promise<void> {
    await redis.del(CONNECTION_KEY);
}
