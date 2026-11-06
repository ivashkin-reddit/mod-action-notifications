# The Slack app

Mod Action Notifications posts its alerts to Slack through a Slack app of your own. [manifest.json](./manifest.json) defines it. You create the app once in your Slack workspace from the manifest. You then give the Devvit app the Slack app's bot token, and add the Slack app to the channels its alerts go to.

The person who deploys the Devvit app does this; it takes about ten minutes. You need to be allowed to install apps in the Slack workspace, or a workspace admin to approve the install.

## What the app is allowed to do

The manifest asks Slack for two permissions (scopes), and nothing else:

| Scope                  | Why                                                                                                                                          |
| ---------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `chat:write`           | To post alerts in the channels the app has been added to, and to edit or delete its own alerts when content they quote is deleted on Reddit. |
| `chat:write.customize` | To post under the name Mod Action Notifications, with each kind of alert's own emoji icon.                                                   |

The app can't read any channel or message, see who is in the workspace, or post to a channel it hasn't been added to.

The manifest turns token rotation off. A rotating token expires and has to be refreshed, which the Devvit app doesn't do, so alerts would stop.

## Deploying it

1. **Create the app.** Open [api.slack.com/apps](https://api.slack.com/apps?new_app=1) and choose **Create New App**, then **From a manifest**. Pick your workspace, paste the contents of [manifest.json](./manifest.json), and select **Next**, then **Create**.
2. **Install it to your workspace.** In the app's settings, open **Install App** and select **Install to Workspace**, then **Allow**. If your workspace needs an admin to approve apps, Slack sends them a request instead; continue once it's approved.
3. **Copy the bot token.** The **Install App** page, and **OAuth & Permissions**, show the **Bot User OAuth Token**. It starts `xoxb-`. Anyone who has it can post as the app, so don't paste it anywhere else.
4. **Give the token to the Devvit app.** The Devvit app has to be installed on at least one subreddit first. Then, from this repository's folder:

    ```bash
    npx devvit settings set slackBotToken
    ```

    Paste the token when asked. It's an app-wide secret: Devvit encrypts it, every installation of the Devvit app uses it, and moderators never see it. So every subreddit the app is installed on posts to this one workspace.

5. **Add the app to each channel.** In each channel alerts should go to, type `/invite @mod-action-notifications` and send it. Private channels need this. Public channels need it too, as the app doesn't ask for the permission to post where it hasn't been added.
6. **Copy each channel's ID.** Click the channel's name at the top of the channel. The channel ID is at the bottom of the window that opens, and starts with `C`. A public channel's name works as well, but an ID still works after the channel is renamed, and a private channel needs one.
7. **Set the channels in the Devvit app.** In the subreddit's mod tools, open the app's settings. Enter the channel ID in **Notification Channel**, and in **Alert Channel** if security, modqueue and deleted-post alerts should go to a different channel.
8. **Set how long the alert channels keep messages.** Reddit doesn't tell apps when an account is deleted, so the channels' message retention is what takes a deleted account's username out of the alerts. Reddit recommends deleting data about redditors within 30 days. Keep messages for 90 days at most: the app takes content deleted on Reddit out of alerts for 90 days after sending them, and can't edit older ones.
    - **On a paid plan** (Pro, Business+ or Enterprise), set each alert channel to 30 days. Click the channel's name at the top of the channel, open **Settings**, hover over **Message history** and select **Edit**. Choose **Delete messages after a specific time period**, pick the period, and select **Save Changes** ([Slack's guide](https://slack.com/help/articles/115005393586-Edit-message-retention-settings-for-specific-conversations)).
    - If a channel has no such option, a Workspace Owner first has to let conversations override the workspace's retention, under **Data retention** in the workspace settings ([Slack's guide](https://slack.com/help/articles/203457187-Customize-data-retention-in-Slack)). Where your organization sets retention for all its workspaces, ask its Org Owner.
    - **On the free plan**, a channel can't have a setting of its own. A Workspace Owner sets the whole workspace to **Delete messages after 90 days**, under **Data retention** in the workspace settings; the other choice keeps messages for a year, longer than the app can edit them. As this applies to every channel, a workspace for the mod team alone suits it best.

    Slack deletes old messages once a day, and what it deletes can't be recovered.

9. **Check it works.** From the subreddit's mod tools menu, choose **Test Slack Connection**. A test message should arrive in the notification channel.

## Changing it

To change the app, edit [manifest.json](./manifest.json) here first, then paste it into the app's settings under **App Manifest**. Slack asks you to reinstall the app when its scopes change. If the token changes, set it again with `npx devvit settings set slackBotToken`.

## Replacing a token that leaked

On **OAuth & Permissions**, revoke the app's tokens, then reinstall the app (step 2) and set the new token (step 4). Until you do, alerts are refused, and Show Bot Status and a modmail notice say that Slack is refusing alerts (`invalid_auth` or `token_revoked`).

## Removing it

Delete the app from its settings, on **Basic Information**. The Devvit app can't post to Slack after that. The messages it posted stay in Slack until your workspace's retention settings remove them, or someone deletes them.
