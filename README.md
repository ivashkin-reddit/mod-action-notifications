# Reddit Mod Action Slack Bot

Bring the activity from your subreddit’s modlog straight into Slack. Once installed, this Devvit app announces moderator actions, flags unusual behavior, and helps the team stay aligned without refreshing Reddit all day.

## What You Get
- Live Slack alerts for the mod actions you choose (removals, bans, flair edits, and more).
- Automatic ban-duration context so unban events can be paired with the original discipline.
- Optional warnings whenever unknown accounts act on the subreddit, or when the modqueue grows too large or too old.
- Opt-in AutoModerator alerts if you want visibility into bot decisions.
- Heads-up when users delete high-score posts, plus an in-app simulator so you can preview formatting safely.

## How to Install
1. Upload the bundle to your subreddit via the Reddit Developer Platform.
2. Open the app’s settings and paste the Slack Incoming Webhook URL you want to use.
3. Choose which mod actions should produce alerts (defaults cover removals and bans).
4. Optionally set different channels for regular notifications and elevated alerts.
5. Grant the app moderator permissions so it can read the modlog and post menu items.

Once saved, perform any moderator action from the enabled list to confirm Slack is receiving notifications. Use the **Test Slack Connection** menu item if you prefer a dry run.

## Customize Alerts
- Adjust thresholds for the modqueue (total size and oldest item age) to match your team’s workload.
- Leave the AutoModerator toggle off if you only want human actions in Slack.
- Use the excluded-moderator list for bots or accounts you never want to broadcast.
- Keep the alert channel blank to post everything in the webhook’s default Slack destination.

Full setting descriptions live in [CONFIGURATION.md](./CONFIGURATION.md). For engineering details or local development instructions, see [TECHNICAL.md](./TECHNICAL.md).

## Need a Hand?
If Slack stops receiving alerts, revalidate the webhook URL or rerun the “Test Slack Connection” menu entry. Reddit API hiccups are logged to the Devvit console; revisit the Developer Platform to inspect recent runs and errors.
