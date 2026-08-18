import { describe, test, expect } from "bun:test";
import { generateCode } from "./code-gen";

describe("generateCode", () => {
    test("uppercases and joins words with underscore", () => {
        expect(generateCode("Cleaning Supplies")).toBe("CLEANING_SUPPLIES");
    });

    test("strips special characters before collapsing whitespace", () => {
        // Punctuation adjacent to spaces must not leave a double underscore.
        expect(generateCode("Feed - Type")).toBe("FEED_TYPE");
    });

    test("strips punctuation with no adjacent whitespace", () => {
        expect(generateCode("Cleaning  Supplies!!")).toBe("CLEANING_SUPPLIES");
    });

    test("trims leading and trailing whitespace", () => {
        expect(generateCode("  Feed  ")).toBe("FEED");
    });

    test("collapses multiple internal spaces into one underscore", () => {
        expect(generateCode("Bank   Transfer")).toBe("BANK_TRANSFER");
    });

    test("returns empty string when label has no letters or digits", () => {
        expect(generateCode("!!! ---")).toBe("");
    });

    test("keeps digits", () => {
        expect(generateCode("Grade A2")).toBe("GRADE_A2");
    });
});
