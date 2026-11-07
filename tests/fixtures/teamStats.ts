import type { App } from "./app.js";

/** The lines of the team's report on how it responds: Show Team Stats and the weekly digest give them in this order. */
export const RESPONSE_LINES: readonly string[] = [
    "Time to act on the queue",
    "Reported items",
    "Filtered by AutoModerator",
    "Removals reversed",
    "Modmail replies",
];

/** Presses Show Team Stats, and returns its lines on how the team responds, by label. */
export async function responseLines(
    app: Readonly<Pick<App, "pressMenuItem" | "shownForm">>,
): Promise<Readonly<Record<string, unknown>>> {
    await app.pressMenuItem("Show Team Stats");
    return Object.fromEntries(
        app
            .shownForm()
            .definition.fields.filter((field): boolean => RESPONSE_LINES.includes(field.label ?? ""))
            .map((field): readonly [string, unknown] => [field.label ?? "", field.defaultValue]),
    );
}
