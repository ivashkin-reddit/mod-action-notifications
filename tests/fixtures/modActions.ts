import type { ModAction } from "../../src/moderation/domain/modAction.js";
import { NOW } from "./app.js";

/**
 * A mod action as the moderation domain holds it: ModA removing Author's post in r/testsub at NOW, with nothing
 * added from the mod log or Redis. `fields` replaces any part.
 */
export function modAction(fields: Readonly<Partial<ModAction>> = {}): ModAction {
    return {
        id: "ModAction_1",
        type: "removelink",
        moderatorName: "ModA",
        subredditName: "testsub",
        target: {
            author: "Author",
            permalink: "/r/testsub/comments/abc/hello_world/",
            body: "Hello world",
            postId: "t3_abc",
            commentId: undefined,
        },
        description: undefined,
        details: undefined,
        occurredAt: NOW,
        isAutoModerator: false,
        banDuration: undefined,
        banDurationLabel: undefined,
        relatedAction: undefined,
        activitySpike: undefined,
        recentHistory: undefined,
        ...fields,
    };
}
