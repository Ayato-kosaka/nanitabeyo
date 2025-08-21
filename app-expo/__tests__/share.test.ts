import { generateShareUrl } from "../lib/share";

// Mock the Env module
jest.mock("../constants/Env", () => ({
	Env: {
		WEB_BASE_URL: "https://example.com",
	},
}));

describe("Share functionality", () => {
	describe("generateShareUrl", () => {
		it("should generate correct URL from pathname", () => {
			const pathname = "/en/spot/123";
			const result = generateShareUrl(pathname);
			expect(result).toBe("https://example.com/en/spot/123");
		});

		it("should handle pathname without leading slash", () => {
			const pathname = "en/spot/123";
			const result = generateShareUrl(pathname);
			expect(result).toBe("https://example.com/en/spot/123");
		});

		it("should handle root pathname", () => {
			const pathname = "/";
			const result = generateShareUrl(pathname);
			expect(result).toBe("https://example.com/");
		});

		it("should use fallback URL when WEB_BASE_URL is not set", () => {
			// Override the mock for this test
			jest.doMock("../constants/Env", () => ({
				Env: {
					WEB_BASE_URL: undefined,
				},
			}));

			const { generateShareUrl: testGenerateShareUrl } = require("../lib/share");
			const pathname = "/en/spot/123";
			const result = testGenerateShareUrl(pathname);
			expect(result).toBe("https://example.com/en/spot/123");
		});
	});
});
