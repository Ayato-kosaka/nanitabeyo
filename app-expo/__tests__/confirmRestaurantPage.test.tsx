/*
#1671 【設計】確認ページの不変条件を固定する。

このチケットの完了条件のうち、画面側で機械的に押さえられるのは次の 3 つ。

| 完了条件 | ここで見ること |
| --- | --- |
| POI から店を作るとき、ユーザー確認を必ず挟む | 開いた時点では `POST v1/restaurants` を投げない |
| 確認を経ずに店舗マスターへ保存しない | 「この内容で登録」を押して初めて投げる |
| 確認された値が保存される | 直した店名・住所が **リクエストに載る** |

⚠️ **«下読みが表示された» だけを見ないこと。** 表示は出ているのに確定時に
Google の値を送っていた、という壊れ方をそれでは検出できない。
アサーションは **`POST v1/restaurants` の中身**へ置く。

`app/` 配下に置いたテストは expo-router がルートとして拾ってしまうため、ここに置いている
（selectRestaurantRoute.test.tsx と同じ理由）。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockPush = jest.fn();
const mockReplace = jest.fn();
const mockBack = jest.fn();
const mockRouteParams: { current: Record<string, string> } = { current: {} };

// ⚠️ スタブ本体をファクトリの «外» に置かないこと（import 巻き上げで undefined になる）
jest.mock("expo-router", () => {
	const stub = {
		push: (href: unknown) => mockPush(href),
		replace: (href: unknown) => mockReplace(href),
		back: () => mockBack(),
		canGoBack: () => true,
	};
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => mockRouteParams.current,
		useGlobalSearchParams: () => ({}),
		useFocusEffect: () => {},
		useNavigation: () => ({ addListener: () => () => {} }),
	};
});

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({
	useAPICall: () => ({ callBackend: mockCallBackend }),
	ApiError: class ApiError extends Error {},
}));

const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({
	useSnackbar: () => ({ showSnackbar: mockShowSnackbar }),
}));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));
jest.mock("@/components/MapView", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: ReactActual.forwardRef(({ children }: { children?: React.ReactNode }, _ref: unknown) =>
			ReactActual.createElement(RNView, { testID: "map-view" }, children),
		),
	};
});
jest.mock("react-native-maps", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		__esModule: true,
		default: class {},
		Marker: ({ children }: { children?: React.ReactNode }) =>
			ReactActual.createElement(RNView, { testID: "marker" }, children),
	};
});

const mockUpsert = jest.fn();
jest.mock("@/stores/useRestaurantStore", () => ({
	useRestaurantStore: { getState: () => ({ upsert: mockUpsert }) },
}));
const mockSetPicked = jest.fn();
jest.mock("@/features/restaurantPicker/stores/usePickedRestaurantStore", () => ({
	usePickedRestaurantStore: { getState: () => ({ setPicked: mockSetPicked }) },
}));

import ConfirmRestaurantScreen from "@/app/[locale]/(tabs)/my-dishes/confirm-restaurant";

const PLACE_ID = "ChIJplace1";

/** サーバが返す «Google 由来の既定値» */
const DRAFT = {
	draft: {
		googlePlaceId: PLACE_ID,
		name: "Google が返した店名",
		nameLanguageCode: "ja",
		latitude: 35.6,
		longitude: 139.7,
		addressComponents: [],
		address: "東京都渋谷区神南1-2-3",
		countryCode: "JP",
	},
	draftToken: "rdt1.signed.token",
};

const CREATED = {
	restaurant: { id: "restaurant-uuid", name: "確認した店名" },
	meta: { reviewCount: 0, averageRating: 0, totalCents: 0, maxEndDate: null },
};

const render = async (element: React.ReactElement) => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(element);
	});
	await act(async () => {});
	return tree;
};

const findByTestId = (tree: TestRenderer.ReactTestRenderer, testID: string) =>
	tree.root.findAll((n) => n.props?.testID === testID && typeof n.type !== "string")[0] ??
	tree.root.findAll((n) => n.props?.testID === testID)[0];

const typeInto = async (tree: TestRenderer.ReactTestRenderer, testID: string, text: string) => {
	const input = findByTestId(tree, testID);
	await act(async () => {
		input.props.onChangeText(text);
	});
};

const pressSubmit = async (tree: TestRenderer.ReactTestRenderer) => {
	const button = findByTestId(tree, "confirm-restaurant-submit");
	await act(async () => {
		await button.props.onPress({});
	});
};

/** POST v1/restaurants に渡された requestPayload を取り出す */
const createdPayload = () => {
	const call = mockCallBackend.mock.calls.find(([path]) => path === "v1/restaurants");
	return call?.[1]?.requestPayload;
};

beforeEach(() => {
	jest.clearAllMocks();
	mockRouteParams.current = { locale: "ja-JP", googlePlaceId: PLACE_ID };
	mockCallBackend.mockImplementation((path: string) => {
		if (path === "v1/restaurants/draft") return Promise.resolve(DRAFT);
		if (path === "v1/restaurants") return Promise.resolve(CREATED);
		return Promise.resolve({});
	});
});

describe("#1671 新規店舗の確認ページ", () => {
	it("開いた時点では下読みだけを呼び、店を作らない", async () => {
		await render(<ConfirmRestaurantScreen />);

		expect(mockCallBackend).toHaveBeenCalledWith(
			"v1/restaurants/draft",
			expect.objectContaining({ method: "POST", requestPayload: { googlePlaceId: PLACE_ID } }),
		);
		// ⚠️ ここが緑のままだと «確認» になっていない
		expect(mockCallBackend).not.toHaveBeenCalledWith("v1/restaurants", expect.anything());
	});

	it("店名・住所・国の初期値に Google 由来の値が入る", async () => {
		const tree = await render(<ConfirmRestaurantScreen />);

		expect(findByTestId(tree, "confirm-restaurant-name").props.value).toBe(DRAFT.draft.name);
		expect(findByTestId(tree, "confirm-restaurant-address").props.value).toBe(DRAFT.draft.address);
		expect(findByTestId(tree, "confirm-restaurant-country").props.children).toBe("JP");
	});

	it("「この内容で登録」を押して初めて店ができる", async () => {
		const tree = await render(<ConfirmRestaurantScreen />);
		await pressSubmit(tree);

		expect(mockCallBackend).toHaveBeenCalledWith("v1/restaurants", expect.objectContaining({ method: "POST" }));
	});

	it("⚠️ ユーザーが直した店名・住所が送られる（Google の値ではない）", async () => {
		const tree = await render(<ConfirmRestaurantScreen />);

		await typeInto(tree, "confirm-restaurant-name", "ユーザーが直した店名");
		await typeInto(tree, "confirm-restaurant-address", "東京都渋谷区神南9-9-9");
		await pressSubmit(tree);

		expect(createdPayload()).toMatchObject({
			name: "ユーザーが直した店名",
			address: "東京都渋谷区神南9-9-9",
		});
	});

	it("⚠️ 下読みで受け取った draftToken をそのまま返す（サーバが差分を検知できる）", async () => {
		const tree = await render(<ConfirmRestaurantScreen />);
		await pressSubmit(tree);

		expect(createdPayload()).toMatchObject({ draftToken: DRAFT.draftToken });
	});

	it("座標・国コードは下読みの値をそのまま送る", async () => {
		const tree = await render(<ConfirmRestaurantScreen />);
		await pressSubmit(tree);

		expect(createdPayload()).toMatchObject({
			latitude: DRAFT.draft.latitude,
			longitude: DRAFT.draft.longitude,
			countryCode: "JP",
		});
	});

	it("店名を空にすると登録できない（空の店を作らせない）", async () => {
		const tree = await render(<ConfirmRestaurantScreen />);

		await typeInto(tree, "confirm-restaurant-name", "   ");
		await pressSubmit(tree);

		expect(mockCallBackend).not.toHaveBeenCalledWith("v1/restaurants", expect.anything());
	});

	it("作成後は replace で店詳細へ進む（戻るで二重作成させない）", async () => {
		const tree = await render(<ConfirmRestaurantScreen />);
		await pressSubmit(tree);

		expect(mockReplace).toHaveBeenCalledWith({
			pathname: "/[locale]/restaurant/[restaurantId]",
			params: { locale: "ja-JP", restaurantId: "restaurant-uuid" },
		});
		expect(mockPush).not.toHaveBeenCalled();
	});

	it("pick モードでは選択として返して戻る（詳細画面へ行かない）", async () => {
		mockRouteParams.current = { locale: "ja-JP", googlePlaceId: PLACE_ID, pick: "1" };
		const tree = await render(<ConfirmRestaurantScreen />);
		await pressSubmit(tree);

		expect(mockSetPicked).toHaveBeenCalledWith(expect.objectContaining({ restaurantId: "restaurant-uuid" }));
		expect(mockBack).toHaveBeenCalled();
		expect(mockReplace).not.toHaveBeenCalled();
	});

	it("下読みに失敗したら、店を作らずに前の画面へ戻す", async () => {
		mockCallBackend.mockImplementation((path: string) => {
			if (path === "v1/restaurants/draft") return Promise.reject({ status: 404 });
			return Promise.resolve({});
		});

		await render(<ConfirmRestaurantScreen />);

		expect(mockBack).toHaveBeenCalled();
		expect(mockCallBackend).not.toHaveBeenCalledWith("v1/restaurants", expect.anything());
	});
});
