import { describe, expect, it, vi } from "vitest";
import { directToChannel, inChannel, toChannel, withoutTitle } from "./message.js";
import type { DirectSlackSender, SlackSender } from "./message.js";

const TEST_OPTIONS = { timeout: 1000 };

describe("a message sent to a channel", (): void => {
    it.each([
        ["a channel ID as it is", "C0123ABCD", "C0123ABCD"],
        ["an older private channel's ID as it is", "G0123ABCD", "G0123ABCD"],
        ["a name with a #", "mod-log", "#mod-log"],
        ["a name that has its # as it is", "#mod-log", "#mod-log"],
        ["a lower-case name that starts like an ID with a #", "c0123abcd", "#c0123abcd"],
    ])("names %s", TEST_OPTIONS, (_label: string, channel: string, expected: string): void => {
        expect.hasAssertions();

        expect(inChannel({ text: "hello" }, channel)).toStrictEqual({ text: "hello", channel: expected });
    });

    it("is left as it was for no channel", TEST_OPTIONS, (): void => {
        expect.hasAssertions();

        expect(inChannel({ text: "hello" }, "")).toStrictEqual({ text: "hello" });
    });
});

describe("a sender tied to a channel", (): void => {
    it("puts the message and its version without quotes in the channel", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const send = vi.fn<SlackSender>(async (): Promise<void> => {
            await Promise.resolve();
        });

        await toChannel("alerts", send)({ text: "quoting" }, { contentIds: ["t1_a"], withoutQuotes: { text: "bare" } });

        expect(send).toHaveBeenCalledExactlyOnceWith(
            { text: "quoting", channel: "#alerts" },
            { contentIds: ["t1_a"], withoutQuotes: { text: "bare", channel: "#alerts" } },
        );
    });

    it("hands on a message that quotes nothing without quoting", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const send = vi.fn<SlackSender>(async (): Promise<void> => {
            await Promise.resolve();
        });

        await toChannel("C0123ABCD", send)({ text: "plain" });

        expect(send).toHaveBeenCalledExactlyOnceWith({ text: "plain", channel: "C0123ABCD" });
    });

    it("sends straight to the channel, and answers as Slack did", TEST_OPTIONS, async (): Promise<void> => {
        expect.hasAssertions();

        const send = vi.fn<DirectSlackSender>(async (): Promise<boolean> => await Promise.resolve(false));

        await expect(directToChannel("mod-log", send)({ text: "simulated" })).resolves.toBe(false);
        expect(send).toHaveBeenCalledExactlyOnceWith({ text: "simulated", channel: "#mod-log" });
    });
});

describe("a permalink without its title", (): void => {
    it.each([
        ["a post's", "/r/testsub/comments/abc/hello_world/", "/r/testsub/comments/abc/"],
        ["a post's with no trailing slash", "/r/testsub/comments/abc/hello_world", "/r/testsub/comments/abc/"],
        ["a comment's", "/r/testsub/comments/abc/hello_world/def/", "/r/testsub/comments/abc/_/def/"],
        [
            "a comment's with no trailing slash",
            "/r/testsub/comments/abc/hello_world/def",
            "/r/testsub/comments/abc/_/def/",
        ],
        [
            "a full link",
            "https://www.reddit.com/r/testsub/comments/abc/hello_world/",
            "https://www.reddit.com/r/testsub/comments/abc/",
        ],
    ])("leaves out the title from %s", TEST_OPTIONS, (_label: string, permalink: string, expected: string): void => {
        expect.hasAssertions();

        expect(withoutTitle(permalink)).toBe(expected);
    });

    it.each([
        ["a post link with no title", "/r/testsub/comments/abc/"],
        ["a comment link already without one", "/r/testsub/comments/abc/_/def/"],
        ["a link that is not to a post", "/r/testsub/about/"],
        ["a link with a query", "/r/testsub/comments/abc/hello_world/?context=3"],
    ])("leaves %s as it was", TEST_OPTIONS, (_label: string, permalink: string): void => {
        expect.hasAssertions();

        expect(withoutTitle(permalink)).toBe(permalink);
    });
});
