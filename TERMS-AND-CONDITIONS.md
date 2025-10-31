# Terms & Conditions

**Effective Date:** October 30, 2025  
**App Name:** Reddit Mod Action Slack Bot  
**Developer:** u/ivashkin  
**Intended Use:** Internal moderation tool for subreddit moderation teams

---

## 1. Acceptance of Terms

By installing, configuring, or using the Reddit Mod Action Slack Bot ("the Bot"), you (the moderators of your subreddit) agree to these Terms & Conditions. If you do not agree, do not install or use the Bot.

---

## 2. Scope & Purpose

### 2.1 Intended Use
This Bot is designed for internal use by subreddit moderation teams to:
- Receive real-time Slack notifications of moderation actions
- Monitor modqueue volume and unmoderated content
- Track when high-scoring posts are deleted by users
- Improve moderation team coordination and response times

### 2.2 Open Source Distribution
This Bot is provided as open source software under the MIT License. While originally built for a specific moderation workflow, it can be adapted for use by any subreddit.

### 2.3 Use At Your Own Risk
Subreddits that choose to install this Bot do so at their own risk. This is community-maintained software provided without warranties or guarantees.

---

## 3. Eligibility

### 3.1 Moderator Access Only
- Only moderators of your subreddit with appropriate permissions may install and configure the Bot
- The Bot requires moderator privileges to function
- Regular subreddit members cannot interact with or configure the Bot

### 3.2 Reddit Account Requirements
- You must have a valid Reddit account in good standing
- You must comply with Reddit's [User Agreement](https://www.redditinc.com/policies/) and [Content Policy](https://www.redditinc.com/policies/content-policy)
- Reddit reserves the right to disable the Bot if your account violates their terms

---

## 4. What the Bot Does

### 4.1 Core Functionality
The Bot provides the following features:
- **Mod Action Notifications:** Sends Slack alerts when moderators perform actions (remove posts, ban users, approve content, etc.)
- **Ban/Mute Context:** Pairs ban/unban and mute/unmute events to show related moderator actions
- **Rapid-Fire Detection:** Alerts when moderators perform multiple actions in quick succession
- **Modqueue Monitoring:** Sends alerts when modqueue exceeds configured thresholds or content remains unmoderated for too long
- **Post Deletion Tracking:** Notifies when users delete high-scoring posts
- **Unknown Moderator Flagging:** Alerts if actions are performed by accounts not on the moderator list

### 4.2 What the Bot Does NOT Do
The Bot **does not**:
- Take automatic moderation actions (it only sends notifications)
- Remove, approve, or modify any Reddit content
- Respond to user comments or posts
- Access or display private messages or modmail
- Store user data permanently (all data expires automatically)
- Share data with third parties beyond Slack

---

## 5. Your Responsibilities

### 5.1 Slack Webhook Security
You are responsible for:
- Keeping your Slack webhook URL confidential
- Ensuring only authorized moderators have access to the Slack channel
- Configuring Slack workspace permissions appropriately
- Immediately rotating the webhook URL if compromised

### 5.2 Configuration
You must:
- Configure the Bot settings accurately
- Review and update settings as needed
- Ensure AutoModerator alerts are enabled/disabled per team preference
- Set appropriate modqueue thresholds for your moderation needs

### 5.3 Compliance
You agree to:
- Use the Bot only for legitimate moderation purposes
- Not attempt to abuse, exploit, or reverse engineer the Bot
- Comply with all Reddit Terms & Policies
- Not use Bot notifications to harass or target users
- Respect user privacy and Reddit's content policies

---

## 6. Limitations & Disclaimers

### 6.1 No Guarantees
The Bot is provided **"AS IS" and "AS AVAILABLE"** without warranties of any kind:
- ❌ We do not guarantee 100% uptime or availability
- ❌ We do not guarantee all mod actions will trigger notifications
- ❌ We do not guarantee Slack delivery success
- ❌ We do not guarantee the Bot will meet all your needs

### 6.2 Platform Dependencies
The Bot relies on:
- Reddit's Devvit platform (may experience downtime)
- Slack's webhook infrastructure (may experience delays)
- Reddit API events (may have latency or missing events)
- Network connectivity (outside our control)

### 6.3 Rate Limits
- The Bot respects Slack's rate limits (may delay notifications if exceeded)
- Reddit's Devvit platform has scheduler and API limits
- High-volume subreddits may experience notification delays

---

## 7. Limitation of Liability

### 7.1 No Liability for Damages
To the fullest extent permitted by law, the developer (u/ivashkin) shall not be liable for:
- Lost moderation opportunities due to missed notifications
- Delays in Slack message delivery
- Data loss or corruption
- Security breaches of Slack webhooks
- Moderation decisions made based on Bot notifications
- Any indirect, incidental, special, or consequential damages

### 7.2 Maximum Liability
If any liability is found to exist, it shall not exceed the amount you paid to use the Bot (which is **$0.00**, as this is a free tool).

### 7.3 Reddit's Terms Apply
Reddit's limitation of liability provisions in their [Developer Terms](https://www.redditinc.com/policies/developer-terms) also apply to your use of this Bot.

---

## 8. Privacy & Data

### 8.1 Privacy Policy
Your use of the Bot is subject to our [Privacy Policy](./PRIVACY-POLICY.md), which describes:
- What data is collected
- How data is used
- How long data is stored
- Your rights regarding data

### 8.2 Data Minimization
We only collect data necessary for Bot functionality and automatically delete data after short retention periods (7-90 days).

### 8.3 No Sale of Data
We will never sell, license, or share your data with third parties beyond what is necessary for Slack notification delivery.

---

## 9. Modifications & Updates

### 9.1 Bot Updates
We may update the Bot at any time to:
- Fix bugs or security issues
- Add new features
- Improve performance
- Comply with Reddit/Devvit platform changes

### 9.2 Terms Updates
We may update these Terms & Conditions at any time. Material changes will be announced via:
- Bot's GitHub repository
- Updated "Effective Date" at the top of this document

### 9.3 Continued Use = Acceptance
Your continued use of the Bot after changes constitutes acceptance of updated terms.

---

## 10. Termination

### 10.1 You May Terminate
You may stop using the Bot at any time by:
- Uninstalling the Bot from your subreddit
- Disabling the Bot in Reddit app settings
- Removing the Slack webhook URL from configuration

### 10.2 We May Terminate
We reserve the right to:
- Discontinue the Bot at any time
- Revoke access if terms are violated
- Disable features that become unsupported
- Stop development or support

### 10.3 Effect of Termination
Upon termination:
- Bot stops collecting new data immediately
- Existing cached data expires per normal TTL (7-90 days)
- You lose access to Bot features
- No refunds (Bot is free)

---

## 11. Intellectual Property

### 11.1 Bot Code
- The Bot's source code is available on [GitHub](https://github.com/ivashkin-reddit/mod-action-notifications)
- Code is provided for transparency and community review
- Licensed under the MIT License

### 11.2 Reddit's IP
- All Reddit trademarks, logos, and content remain property of Reddit, Inc.
- The Bot does not claim ownership of any Reddit content or data
- Use of Reddit APIs is subject to Reddit's terms

### 11.3 Your Data
- You retain all rights to your moderation team's data
- The Bot does not claim ownership of Slack messages or Reddit content

---

## 12. Indemnification

You agree to indemnify and hold harmless the developer (u/ivashkin) from any claims, damages, losses, or expenses arising from:
- Your use or misuse of the Bot
- Your violation of these Terms
- Your violation of Reddit's policies
- Your configuration of Slack webhooks
- Moderation decisions made by your team

---

## 13. Support & Maintenance

### 13.1 Best Effort Support
We provide **best effort** community support, but make no guarantees regarding:
- Response times to issues
- Bug fix timelines
- Feature requests
- Ongoing maintenance

### 13.2 No Dedicated Support
This is a volunteer project. We do not provide:
- 24/7 support
- SLA guarantees
- Guaranteed bug fixes
- Guaranteed uptime

### 13.3 Community Support
For assistance:
- Check the [README](./README.md) documentation
- Open issues on [GitHub](https://github.com/ivashkin-reddit/mod-action-notifications/issues)
- Contact via GitHub issues or discussions

---

## 14. Governing Law

### 14.1 Jurisdiction
These Terms shall be governed by:
- Reddit's [Developer Terms](https://www.redditinc.com/policies/developer-terms)
- Applicable international data protection laws
- Laws of your jurisdiction

### 14.2 Disputes
Any disputes shall be resolved through:
1. Good faith negotiation via GitHub issues
2. Mediation if necessary
3. Courts of competent jurisdiction

---

## 15. Severability

If any provision of these Terms is found to be unenforceable or invalid, that provision shall be limited or eliminated to the minimum extent necessary, and the remaining provisions shall remain in full force and effect.

---

## 16. Entire Agreement

These Terms & Conditions, together with the [Privacy Policy](./PRIVACY-POLICY.md), constitute the entire agreement between you and the developer regarding the Bot.

---

## 17. No Assignment

You may not assign or transfer these Terms or your rights under them without prior written consent. We may assign our rights and obligations without restriction.

---

## 18. Waiver

No waiver of any term shall be deemed a further or continuing waiver of such term or any other term.

---

## 19. Contact Information

For questions, concerns, or notices regarding these Terms:

- **GitHub:** [Open an issue](https://github.com/ivashkin-reddit/mod-action-notifications/issues)
- **Developer:** u/ivashkin

---

## 20. Acknowledgment

By using the Bot, you acknowledge that you have read, understood, and agree to be bound by these Terms & Conditions and the Privacy Policy.

---

**Last Updated:** October 30, 2025
