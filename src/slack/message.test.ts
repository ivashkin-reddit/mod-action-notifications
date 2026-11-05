import { describe, expect, it } from "vitest";
import { withoutTitle } from "./message.js";

const TEST_OPTIONS = { timeout: 1000 };

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
