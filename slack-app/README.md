# The Slack app

Mod Action Notifications posts its alerts to Slack through a Slack app of your own. [manifest.json](./manifest.json) defines it. You create the app once in your Slack workspace from the manifest, and add it to the channels its alerts go to. Then a moderator connects the Devvit app to it with **Connect Slack**, giving it the Slack app's bot token.

Each subreddit does this for its own workspace; it takes about ten minutes. You need to be a moderator of the subreddit, and to be allowed to install apps in the Slack workspace, or a workspace admin to approve the install.

## What the app is allowed to do

The manifest asks Slack for one permission (scope), and nothing else:

| Scope        | Why                                                                                                                                          |
| ------------ | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat:write` | To post alerts in the channels the app has been added to, and to edit or delete its own alerts when content they quote is deleted on Reddit. |

The app can't read any channel or message, see who is in the workspace, or post to a channel it hasn't been added to. Alerts appear under the Slack app's name, Mod Action Notifications; an icon added on the app's **Basic Information** page shows beside them.

The manifest turns token rotation off. A rotating token expires and has to be refreshed, which the Devvit app doesn't do, so alerts would stop.

## Deploying it

1. **Create the app.** Open [api.slack.com/apps](https://api.slack.com/apps?new_app=1) and choose **Create New App**, then **From a manifest**. Pick your workspace, paste the contents of [manifest.json](./manifest.json), and select **Next**, then **Create**.
2. **Install it to your workspace.** In the app's settings, open **Install App** and select **Install to Workspace**, then **Allow**. If your workspace needs an admin to approve apps, Slack sends them a request instead; continue once it's approved.
3. **Add the app to each channel.** In each channel alerts should go to, type `/invite @mod-action-notifications` and send it. Private channels need this. Public channels need it too, as the app doesn't ask for the permission to post where it hasn't been added.
4. **Copy each channel's ID.** Click the channel's name at the top of the channel. The channel ID is at the bottom of the window that opens, and starts with `C`. A public channel's name works as well, but an ID still works after the channel is renamed, and a private channel needs one.
5. **Set the channels in the Devvit app.** In the subreddit's mod tools, open the app's settings. Enter the channel ID in **Notification Channel**, and in **Alert Channel** if security, modqueue and deleted-post alerts should go to a different channel.
6. **Set how long the alert channels keep messages.** Reddit doesn't tell apps when an account is deleted, so the channels' message retention is what takes a deleted account's username out of the alerts. Reddit recommends deleting data about redditors within 30 days. Keep messages for 90 days at most: the app takes content deleted on Reddit out of alerts for 90 days after sending them, and can't edit older ones.
    - **On a paid plan** (Pro, Business+ or Enterprise), set each alert channel to 30 days. Click the channel's name at the top of the channel, open **Settings**, hover over **Message history** and select **Edit**. Choose **Delete messages after a specific time period**, pick the period, and select **Save Changes** ([Slack's guide](https://slack.com/help/articles/115005393586-Edit-message-retention-settings-for-specific-conversations)).
    - If a channel has no such option, a Workspace Owner first has to let conversations override the workspace's retention, under **Data retention** in the workspace settings ([Slack's guide](https://slack.com/help/articles/203457187-Customize-data-retention-in-Slack)). Where your organization sets retention for all its workspaces, ask its Org Owner.
    - **On the free plan**, a channel can't have a setting of its own. A Workspace Owner sets the whole workspace to **Delete messages after 90 days**, under **Data retention** in the workspace settings; the other choice keeps messages for a year, longer than the app can edit them. As this applies to every channel, a workspace for the mod team alone suits it best.

    Then set **Slack Message Retention (Days)** in the Devvit app's settings to the same number of days, so the app forgets where its alerts are when Slack deletes them. Slack deletes old messages once a day, and what it deletes can't be recovered.

7. **Copy the bot token.** The **Install App** page, and **OAuth & Permissions**, show the **Bot User OAuth Token**. It starts `xoxb-`. Anyone who has it can post as the app, so paste it only into Connect Slack.
8. **Connect Slack.** From the subreddit's mod tools menu, choose **Connect Slack**, paste the token and select **Connect**. The Devvit app asks Slack whose the token is, and posts a message in each alert channel saying alerts come there. Only then does it keep the token, and it never shows it again. If Slack refuses, the message says why: `invalid_auth` for a token it doesn't know, `not_in_channel` for a channel the app hasn't been added to.
9. **Check it works.** Choose **Test Slack Connection**. A test message should arrive in the notification channel, and **Show Bot Status** names your workspace.

## Changing it

To change the app, edit [manifest.json](./manifest.json) here first, then paste it into the app's settings under **App Manifest**. Slack asks you to reinstall the app when its scopes change. If the token changes, connect again with **Connect Slack**.

## Replacing a token that leaked

On **OAuth & Permissions**, revoke the app's tokens, then reinstall the app (step 2) and connect again with the new token (step 8). Until you do, alerts are refused, and Show Bot Status and a modmail notice say that Slack is refusing alerts (`invalid_auth` or `token_revoked`).

## Removing it

Choose **Connect Slack** and leave the token empty to disconnect, then delete the app from its settings, on **Basic Information**. The Devvit app can't post to Slack after that. The messages it posted stay in Slack until your workspace's retention settings remove them, or someone deletes them.
