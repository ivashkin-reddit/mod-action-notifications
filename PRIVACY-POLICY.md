# Privacy Policy

**Effective Date:** October 30, 2025  
**App Name:** Reddit Mod Action Slack Bot  
**Developer:** u/ivashkin  
**Intended Use:** Internal moderation tool for subreddit moderation teams

---

## 1. Overview

This Privacy Policy describes how the Reddit Mod Action Slack Bot ("the Bot") collects, uses, and shares data when installed and used by subreddit moderators.

**Important:** This bot is designed for internal use by subreddit moderation teams to improve moderation workflow and team coordination.

---

## 2. What Data We Collect

The Bot only collects data necessary to send moderation action notifications to your configured Slack workspace:

### 2.1 Moderation Action Data
- **Moderator username** (who performed the action)
- **Action type** (e.g., removed post, banned user, approved comment)
- **Target user** (if applicable - username only, no personal information)
- **Content metadata** (post/comment titles, permalinks)
- **Timestamps** (when actions occurred)
- **Mod notes** (if included by moderators)

### 2.2 Post Deletion Monitoring Data
- **Post scores** (upvote counts)
- **Post titles**
- **Post authors** (usernames only)
- **Post permalinks**

### 2.3 Configuration Data
- **Slack webhook URL** (stored securely in Reddit's Devvit platform)
- **Bot settings** (enabled actions, excluded moderators, notification preferences)

---

## 3. What Data We Do NOT Collect

- ❌ User IP addresses
- ❌ Email addresses
- ❌ Real names or personal identifiable information (PII)
- ❌ Private messages or modmail content
- ❌ User passwords or credentials
- ❌ Location data
- ❌ Device information
- ❌ Browsing history

---

## 4. How We Use Data

### 4.1 Primary Purpose
All data is used **solely** to send real-time notifications to your subreddit's moderation team via Slack when moderation actions occur.

### 4.2 Specific Uses
- Send Slack alerts when moderators perform actions
- Pair ban/unban events to show context
- Detect rapid-fire moderation activity
- Alert on high modqueue volume
- Notify when high-scoring posts are deleted

### 4.3 No Secondary Uses
We **do not**:
- Sell or share data with third parties
- Use data for advertising or marketing
- Train AI/ML models
- Profile or track users
- Analyze user behavior for any purpose beyond notifications

---

## 5. Where Data Is Sent

### 5.1 Slack Integration
- Moderation notifications are sent to your configured Slack webhook URL
- Data is transmitted over HTTPS (encrypted in transit)
- Only the Slack workspace you configure receives notifications
- Slack's data handling is governed by [Slack's Privacy Policy](https://slack.com/trust/privacy/privacy-policy)

### 5.2 Reddit's Devvit Platform
- Configuration settings are stored in Reddit's secure Devvit infrastructure
- We do not operate any external servers or databases
- All processing occurs within Reddit's controlled environment

---

## 6. How Long We Store Data

All data is stored temporarily in Reddit's Redis infrastructure with automatic expiration:

| Data Type | Retention Period | Purpose |
|-----------|-----------------|---------|
| Ban/mute context | 90 days | Pair with unban/unmute events |
| Post score cache | 7 days | Track high-scoring deletions |
| Moderator activity | 1 hour | Detect rapid-fire actions |
| Alert throttling | 1 hour | Prevent notification spam |
| Scheduler failures | 1 hour | Track monitoring issues |

**Important:** Data is automatically deleted after these periods. We do not maintain long-term archives.

---

## 7. Data Security

### 7.1 Security Measures
- All data stored in Reddit's secure infrastructure
- Webhook URLs encrypted at rest
- HTTPS-only communication with Slack
- No plaintext credentials in code
- Input sanitization to prevent injection attacks

### 7.2 Access Control
- Only subreddit moderators with bot configuration access can view settings
- Webhook URL is stored securely and not exposed in logs
- Reddit controls all infrastructure security

---

## 8. User Rights & Deletions

### 8.1 Respecting Reddit Deletions
When users delete their posts, comments, or accounts on Reddit:
- Post/comment content is removed from our cache within 7-90 days (automatic TTL expiration)
- Account deletions: User IDs are removed from all stored data
- The bot respects Reddit's PostDelete and CommentDelete events

### 8.2 Opting Out
- Subreddit moderators can disable or uninstall the bot at any time via Reddit's app settings
- Specific moderators can be excluded from notifications via bot settings
- Uninstalling the bot immediately stops all data collection

---

## 9. Third-Party Services

### 9.1 Slack
- We send notifications to Slack via webhooks
- Slack's data handling is governed by their own privacy policy
- We recommend reviewing [Slack's Privacy Policy](https://slack.com/trust/privacy/privacy-policy)
- You control who has access to your Slack workspace

### 9.2 No Other Third Parties
We do not integrate with any services other than Slack and Reddit's Devvit platform.

---

## 10. Children's Privacy

This bot is designed for use by subreddit moderators (Reddit requires users to be 13+). We do not knowingly collect data from anyone under 13, and Reddit's terms prohibit users under 13 from using the platform.

---

## 11. International Users

- Data is processed on Reddit's infrastructure (location subject to Reddit's data policies)
- Slack webhook delivery follows Slack's infrastructure routing
- This bot complies with GDPR and other international data protection regulations

---

## 12. Changes to This Policy

We may update this Privacy Policy to reflect changes in:
- Bot functionality
- Data practices
- Legal requirements
- Reddit/Devvit platform updates

**Notification:** Material changes will be announced via the bot's GitHub repository.

---

## 13. Data Controller

**Developer:** u/ivashkin  
**Platform:** Reddit Devvit  
**Contact:** Via GitHub issues at the repository

---

## 14. Legal Compliance

This bot complies with:
- ✅ Reddit's [Developer Terms](https://www.redditinc.com/policies/developer-terms)
- ✅ Reddit's [Developer Data Protection Addendum](https://www.redditinc.com/policies/developer-dpa)
- ✅ Reddit's [Privacy Policy](https://www.reddit.com/policies/privacy-policy)
- ✅ GDPR (General Data Protection Regulation)
- ✅ UK Data Protection Act 2018
- ✅ Devvit Rules and Guidelines

---

## 15. Your Consent

By installing and using this bot, your subreddit's moderation team consents to the data practices described in this policy.

---

## 16. Contact & Questions

For questions about this Privacy Policy or the bot's data practices:

- **GitHub:** [Open an issue](https://github.com/ivashkin-reddit/mod-action-notifications/issues)
- **Developer:** u/ivashkin

---

**Last Updated:** October 30, 2025
