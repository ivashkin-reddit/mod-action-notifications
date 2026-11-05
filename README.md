# Reddit Mod Action Slack Bot

A Reddit Devvit application that brings your subreddit's modlog activity straight into Slack. This open-source moderation tool announces moderator actions, flags unusual behavior, and helps your team stay aligned without constantly refreshing Reddit.

**Developer:** u/ivashkin  
**License:** MIT  
**Platform:** Reddit Devvit 0.15

## What You Get

- Live Slack alerts for the mod actions you choose (removals, bans, flair edits, and more).
- Automatic ban-duration context so unban events can be paired with the original discipline.
- Optional warnings whenever unknown accounts act on the subreddit. Actions by Reddit's own accounts (u/reddit for Crowd Control and Reddit's filters, Anti-Evil Operations for admin removals) are labelled as Reddit actions rather than security alerts.
- Modqueue monitoring: alerts when the modqueue grows too large, when content waits too long without a moderator reviewing it, and when reported content is old.
- Opt-in AutoModerator alerts if you want visibility into bot decisions.
- Heads-up when users delete high-score posts, plus an in-app simulator so you can preview formatting safely.

## Prerequisites

Before installing this app, you'll need:

- Moderator permissions on your subreddit
- A Slack workspace with an [Incoming Webhook URL](https://api.slack.com/messaging/webhooks)
- The [Devvit CLI](https://developers.reddit.com/docs/quickstart) installed (`npm install -g devvit`)

## Installation

### Option 1: Install from Source

1. **Clone this repository:**

    ```bash
    git clone https://github.com/ivashkin-reddit/mod-action-notifications.git
    cd mod-action-notifications
    ```

2. **Install dependencies:**

    ```bash
    npm install
    ```

3. **Login to Devvit:**

    ```bash
    devvit login
    ```

4. **Upload the app:**

    ```bash
    devvit upload
    ```

5. **Install to your subreddit:**
    ```bash
    devvit install <your-subreddit>
    ```

### Option 2: Install from Apps Directory

Once published, you can install directly from Reddit's Apps Directory by visiting your subreddit's moderation tools and searching for "Mod Action Slack Bot".

## Configuration

After installation, configure the app through Reddit:

1. Navigate to your subreddit's app settings
2. Paste your Slack Incoming Webhook URL
3. Choose which mod actions should trigger alerts (defaults cover removals and bans)
4. Optionally set different channels for regular notifications vs. elevated alerts
5. Configure modqueue monitoring thresholds if desired. Setting all three to 0 turns monitoring off; after turning it on or off, run the **Setup Modqueue Monitoring** menu item to schedule or cancel the monitor

The channel settings rely on Slack letting a message choose its channel, which only legacy incoming webhooks allow. A webhook created by a Slack app always posts to the channel picked when it was created, so with one, create a webhook per channel instead.

Once saved, perform any moderator action from the enabled list to confirm Slack is receiving notifications. Use the **Test Slack Connection** menu item for a test notification.

## Customization

Fine-tune the bot to match your team's workflow:

- **Modqueue Monitoring:** Adjust thresholds for modqueue size, how long content may wait unreviewed (Reddit's unmoderated listing), and how old reported content may be
- **AutoModerator Alerts:** Toggle on/off to control bot action visibility
- **Excluded Moderators:** Hide notifications from specific accounts (useful for bots)
- **Alert Channels:** Route high-priority alerts to a separate Slack channel (legacy incoming webhooks only; see above)
- **Mod Notes:** Reddit's mod-action events carry no note, so a note appears only on bans, read from the mod log
- **Action Filters:** Enable/disable specific mod actions (bans, removals, approvals, etc.)

## Development

### Local Setup

```bash
# Install dependencies
npm install

# Run the checks CI runs
npm run typecheck
npm run lint
npm run coverage
npm run format:check

# Upload to test subreddit
devvit upload

# View logs
devvit logs <your-subreddit>
```

### Testing

- Use the **Simulate Mod Action** menu item to preview Slack message formatting
- Use the **Test Slack Connection** menu item to verify webhook connectivity
- Use the **Show Bot Status** menu item to review current configuration

## Documentation

- **[Privacy Policy](./PRIVACY-POLICY.md)** - Data collection and usage practices
- **[Terms & Conditions](./TERMS-AND-CONDITIONS.md)** - Usage terms and limitations

## Data Privacy

This app:

- ✅ Only collects data necessary for Slack notifications
- ✅ Automatically deletes stored data within 1 hour to 90 days (Redis TTL; see the Privacy Policy)
- ✅ Does not share data with third parties (except Slack for notifications)
- ✅ Respects Reddit user deletions and privacy rights
- ✅ Stores webhook URLs securely in Reddit's infrastructure

See [PRIVACY-POLICY.md](./PRIVACY-POLICY.md) for complete details.

## Support

**Issues & Bugs:** [GitHub Issues](https://github.com/ivashkin-reddit/mod-action-notifications/issues)  
**Developer:** u/ivashkin  
**Devvit Documentation:** [developers.reddit.com](https://developers.reddit.com)

### Troubleshooting

**Slack not receiving alerts?**

- Verify webhook URL is correct in app settings
- Run the "Test Slack Connection" menu item
- Check webhook hasn't been revoked in Slack workspace settings

**Missing notifications?**

- Ensure mod action types are enabled in settings
- Check moderator isn't in the excluded list
- Review Devvit logs: `devvit logs <your-subreddit>`

**High latency?**

- Reddit API and Slack may experience occasional delays
- Slack takes about one message a second from a webhook, so during a burst of mod actions alerts are queued and delivered in order at that pace; anything one delivery run cannot send follows within a minute or so

## Contributing

Contributions are welcome! Please:

1. Fork this repository
2. Create a feature branch
3. Make your changes with clear commit messages
4. Make sure the checks in `.github/workflows/test.yml` pass locally
5. Submit a pull request

## License

MIT License - see repository for full license text.

This project is open source and available for modification and redistribution under the MIT License terms.
