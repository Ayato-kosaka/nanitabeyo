// app-expo/hooks/__tests__/useLocationSearch.test.ts
//
// Test for useLocationSearch hook session token functionality
//

import { renderHook, act } from "@testing-library/react-hooks";
import { useLocationSearch } from "../useLocationSearch";

// Mock the required dependencies
jest.mock("../useAPICall");
jest.mock("../useLogger");
jest.mock("../useLocale");
jest.mock("expo-location");
jest.mock("uuid");

const mockCallBackend = jest.fn();
const mockLogFrontendEvent = jest.fn();
const mockLocale = "en";
const mockUuidv4 = jest.fn();

jest.mock("../useAPICall", () => ({
	useAPICall: () => ({ callBackend: mockCallBackend }),
}));

jest.mock("../useLogger", () => ({
	useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }),
}));

jest.mock("../useLocale", () => ({
	useLocale: () => mockLocale,
}));

jest.mock("uuid", () => ({
	v4: mockUuidv4,
}));

describe("useLocationSearch", () => {
	beforeEach(() => {
		jest.clearAllMocks();
		mockUuidv4.mockReturnValue("12345678-1234-5678-9012-123456789012");
		// Mock Buffer for session token generation
		global.Buffer = {
			from: jest.fn().mockReturnValue({
				toString: jest.fn().mockReturnValue("dGVzdC10b2tlbg=="),
			}),
		} as any;
	});

	it("should generate session token for autocomplete", async () => {
		const { result } = renderHook(() => useLocationSearch());

		mockCallBackend.mockResolvedValue([
			{
				place_id: "test-place-id",
				text: "Tokyo, Japan",
				mainText: "Tokyo",
				secondaryText: "Japan",
				types: ["locality"],
			},
		]);

		await act(async () => {
			await result.current.searchLocations("Tokyo");
		});

		expect(mockCallBackend).toHaveBeenCalledWith("v1/locations/autocomplete", {
			method: "GET",
			requestPayload: {
				q: "Tokyo",
				languageCode: "en",
				sessionToken: expect.any(String),
			},
		});
	});

	it("should use session token for location details and clear it after", async () => {
		const { result } = renderHook(() => useLocationSearch());

		// Mock the details API response
		mockCallBackend.mockResolvedValue({
			location: { latitude: 35.6762, longitude: 139.6503 },
			viewport: {
				low: { latitude: 35.617, longitude: 139.5703 },
				high: { latitude: 35.7354, longitude: 139.7303 },
			},
			address: "Tokyo, Japan",
			regionCode: "JP",
		});

		const mockPrediction = {
			place_id: "test-place-id",
			text: "Tokyo, Japan",
			mainText: "Tokyo",
			secondaryText: "Japan",
			types: ["locality"],
		};

		// First, trigger autocomplete to generate session token
		await act(async () => {
			await result.current.searchLocations("Tokyo");
		});

		// Reset mock to verify details call
		mockCallBackend.mockClear();

		await act(async () => {
			await result.current.getLocationDetails(mockPrediction);
		});

		expect(mockCallBackend).toHaveBeenCalledWith("v1/locations/details", {
			method: "GET",
			requestPayload: {
				placeId: "test-place-id",
				languageCode: "en",
				sessionToken: expect.any(String),
			},
		});
	});

	it("should handle getLocationDetails API error and fallback to mock data", async () => {
		const { result } = renderHook(() => useLocationSearch());

		// Mock API error
		mockCallBackend.mockRejectedValue(new Error("API Error"));

		const mockPrediction = {
			place_id: "test-place-id",
			text: "Tokyo, Japan",
			mainText: "Tokyo",
			secondaryText: "Japan",
			types: ["locality"],
		};

		let locationDetails;
		await act(async () => {
			locationDetails = await result.current.getLocationDetails(mockPrediction);
		});

		// Should fallback to mock data
		expect(locationDetails).toEqual({
			latitude: 35.658,
			longitude: 139.7016,
			address: "Tokyo",
		});

		// Should log error
		expect(mockLogFrontendEvent).toHaveBeenCalledWith({
			event_name: "location_details_failed",
			error_level: "error",
			payload: {
				placeId: "test-place-id",
				error: "Error: API Error",
			},
		});
	});
});
