import { alertsConfigured, configOf, modmailPorts, outboxOf } from "./composition.js";
import type { AppContext } from "./composition.js";
import { alertOnAdminModmail, messageFromEvent } from "./modmail/index.js";
import type { ModmailEvent } from "./modmail/index.js";
import {
    alertOnReport,
    createRedisReportClaims,
    createSlackReportAlerts,
    reportFromCommentEvent,
    reportFromPostEvent,
} from "./reports/index.js";
import type { CommentReportEvent, ContentReport, PostReportEvent } from "./reports/index.js";

/**
 * The composition root's triggers for what the community does, rather than its moderators: reports and modmail.
 * main.ts registers them; triggers.ts does the mod action and deletion triggers.
 */

/** Alerts on a report while Slack is set up: an urgent reason at once, and reports piling up. */
async function alertOn(report: ContentReport, context: AppContext): Promise<void> {
    const config = await configOf(context);
    if (!alertsConfigured(config)) {
        return;
    }
    await alertOnReport(
        report,
        { urgentReasons: config.urgentReportReasons, pileUpThreshold: config.reportPileUpThreshold },
        {
            claims: createRedisReportClaims(context.redis),
            alerts: createSlackReportAlerts(outboxOf(context, config).send, config.alertChannel),
        },
    );
}

export async function onPostReport(event: PostReportEvent, context: AppContext): Promise<void> {
    await alertOn(reportFromPostEvent(event), context);
}

export async function onCommentReport(event: CommentReportEvent, context: AppContext): Promise<void> {
    await alertOn(reportFromCommentEvent(event), context);
}

/** Alerts on a Reddit admin's modmail while the setting is on and Slack is set up. */
export async function onModMail(event: ModmailEvent, context: AppContext): Promise<void> {
    const config = await configOf(context);
    if (!config.adminModmailAlerts || !alertsConfigured(config)) {
        return;
    }
    await alertOnAdminModmail(messageFromEvent(event), modmailPorts(context, config));
}
