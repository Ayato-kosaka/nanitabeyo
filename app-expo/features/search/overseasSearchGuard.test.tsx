// #1196 【設計】検索ボタン押下時の 2 段ガード（壊れた address / 海外の地点）のテスト。
//
// 背景: 料理カテゴリ推薦 API (`GET /v1/dish-categories/recommendations`) は address を
// カンマ分割して `region:` を前置し、`dish_category_features(feature_type='gate')` の
// `feature_key` と照合する。ホワイトリストにあるのは `region:country:JP` と
// `region:scope:global` だけなので、
//   - "大阪市" のような壊れた address  → どのゲートにも当たらず候補 0 件
//   - "country:US, ..." のような海外    → 日本向けゲートに当たらず候補が痩せる
// のどちらも Claude フォールバックへ落ちる（本番で 1日 1,445件 / 204ユーザー — #1196）。
// サーバは仕様どおり動いているので、**呼ぶ前に止めるのはクライアントの責務**である。
//
// このガードは「router.push させない」ことが本体なので、addressFormat の単体テストでは
// 絶対に捕まえられない（関数は正しくても handleSearch から呼ばれなければ意味がない — #1129 と同じ構図）。
// ここで「JP は通る / それ以外は通らない」という配線を固定する。
import React from "react";
import TestRenderer from "react-test-renderer";
import type { RecentLocation } from "@/features/search/hooks/useRecentLocations";

// 周辺依存のスタブ方針は searchScreenPreload.test.tsx / recentLocationReselect.test.tsx と同じ
// (検索画面は AuthProvider → lib/supabase → constants/Env まで芋づるに読み込むため、
//  断ち切らないと suite ごと落ちる)
jest.mock("expo-image", () => ({ Image: function MockExpoImage() {} }));
jest.mock(
	"lucide-react-native",
	() =>
		new Proxy(
			{},
			{
				get: (_target, prop) => (prop === "__esModule" ? true : function MockIcon() {}),
			},
		),
);
jest.mock("@react-navigation/native", () => ({ useIsFocused: () => true }));
jest.mock("react-native-safe-area-context", () => {
	const { View: RNView } = require("react-native");
	return { SafeAreaView: RNView };
});
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }) }));
jest.mock("@/hooks/useScreenTrace", () => ({ useScreenTrace: jest.fn() }));
jest.mock("@/hooks/useContentWidth", () => ({ useContentWidth: () => 390 }));
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ user: null }) }));
jest.mock("@/hooks/useLocationSearch", () => ({
	useLocationSearch: () => ({
		getCurrentLocation: () => Promise.resolve(null),
		getLocationDetails: () => Promise.resolve(null),
	}),
}));
jest.mock("@/features/search/hooks/useAutoCurrentLocation", () => ({
	useAutoCurrentLocation: () => ({ requestAutoCurrentLocation: jest.fn() }),
}));
// #1486 既読済みにしておく。未読だとオンボーディングへ router.push が走り、
// これらのテストが見たい «検索画面そのもの» の検証にノイズが乗る
jest.mock("@/features/onboarding/hooks/useOnboardingSeen", () => ({
	useOnboardingSeen: () => true,
}));
jest.mock("@/features/search/hooks/useRecentLocations", () => ({
	useRecentLocations: () => ({ recentLocations: [], addRecentLocation: jest.fn(), clearRecentLocations: jest.fn() }),
}));
jest.mock("@/features/search/components/DistanceSlider", () => ({ DistanceSlider: () => null }));
jest.mock("@/features/search/components/PriceLevelsMultiSelect", () => ({ PriceLevelsMultiSelect: () => null }));
jest.mock("@/features/search/components/SelectableGridItem", () => ({ SelectableGridItem: () => null }));
jest.mock("@/features/search/components/SelectableChip", () => ({ SelectableChip: () => null }));

// jest.mock のファクトリはホイストされるため、外側の変数は `mock` プレフィックスのものしか参照できない。
// 検証対象（push / ログ / ダイアログ / スナックバー）はすべてここで掴む。
const mockRouterPush = jest.fn();
// ⚠️ `push: mockRouterPush` と直接書かないこと。ファクトリはモジュール読み込み時（= 下の
// `import SearchScreen` が巻き上げられて require された時点）に評価されるが、`const mockRouterPush`
// の初期化はそれより後に走る。babel-preset-expo は const を var へ落とすため TDZ エラーにはならず、
// **undefined が焼き付いた router.push** が出来上がって "router.push is not a function" で落ちる。
// 他のモック（useLogger 等）はフック内で参照するので遅延評価となり、この問題が起きない。
jest.mock("expo-router", () => ({
	router: { push: (...args: unknown[]) => mockRouterPush(...args), replace: jest.fn() },
}));

const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));

const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));

// 海外未対応の案内は confirm（OK 単独ボタン）で出す。showCancel: false を渡していることまで見る
const mockConfirm = jest.fn(() => Promise.resolve(true));
jest.mock("@/contexts/DialogProvider", () => ({
	useDialog: () => ({
		showDialog: jest.fn(),
		confirm: (...args: unknown[]) => mockConfirm(...(args as [])),
		prompt: jest.fn(),
		hideDialog: jest.fn(),
	}),
}));

// 検索画面から渡されたハンドラを直接掴む（コンポーネント内部の表示条件には依存させない）:
// - LocationAutocomplete.onSelectRecentLocation … 地点を選んだ状態を作る
// - PrimaryButton.onPress                       … 検索ボタンを押す
let onSelectRecentLocation: ((location: RecentLocation) => void) | undefined;
jest.mock("@/components/LocationAutocomplete", () => ({
	LocationAutocomplete: (props: { onSelectRecentLocation?: (location: RecentLocation) => void }) => {
		onSelectRecentLocation = props.onSelectRecentLocation;
		return null;
	},
}));

let onPressSearch: (() => void) | undefined;
jest.mock("@/components/PrimaryButton", () => ({
	PrimaryButton: (props: { onPress?: () => void }) => {
		onPressSearch = props.onPress;
		return null;
	},
}));

import SearchScreen from "@/app/[locale]/(tabs)/search/index";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** 指定の address を持つ地点を選んだうえで検索ボタンを押す */
function selectLocationAndSearch(address: string): TestRenderer.ReactTestRenderer {
	let tree: TestRenderer.ReactTestRenderer | undefined;
	TestRenderer.act(() => {
		tree = TestRenderer.create(<SearchScreen />);
	});

	expect(onSelectRecentLocation).toBeDefined();
	TestRenderer.act(() => {
		onSelectRecentLocation!({
			location: { latitude: 34.6937, longitude: 135.5023 },
			address,
			localLanguageCode: "ja",
			locationQuery: "テスト地点",
		});
	});

	expect(onPressSearch).toBeDefined();
	TestRenderer.act(() => {
		onPressSearch!();
	});

	return tree!;
}

/** event_name で logFrontendEvent の呼び出しを 1 件取り出す */
function findLoggedEvent(eventName: string) {
	return mockLogFrontendEvent.mock.calls.map(([arg]) => arg).find((arg) => arg?.event_name === eventName);
}

describe("#1196 検索実行前の地点ガード", () => {
	let tree: TestRenderer.ReactTestRenderer | undefined;

	beforeEach(() => {
		// handleSearch は多重検索防止フラグを 1 秒後に戻す setTimeout を張る。
		// 実タイマーのままだと suite 終了後まで残り、jest が worker を強制終了する
		jest.useFakeTimers();
		jest.clearAllMocks();
		onSelectRecentLocation = undefined;
		onPressSearch = undefined;
	});

	afterEach(() => {
		if (tree) {
			TestRenderer.act(() => tree!.unmount());
			tree = undefined;
		}
		jest.runOnlyPendingTimers();
		jest.useRealTimers();
	});

	it("country:JP の地点では検索が実行される（ガードが正常系を止めていないこと）", () => {
		tree = selectLocationAndSearch("country:JP, administrative_area_level_1:大阪府, locality:大阪市");

		expect(mockRouterPush).toHaveBeenCalledTimes(1);
		expect(findLoggedEvent("search_started")).toBeDefined();
		// 正常系でガードのログ・案内が漏れ出していないこと
		expect(findLoggedEvent("search_blocked_malformed_address")).toBeUndefined();
		expect(findLoggedEvent("search_blocked_unsupported_country")).toBeUndefined();
		expect(mockConfirm).not.toHaveBeenCalled();
	});

	it("country:US の地点では推薦 API を呼ばず、ダイアログで海外未対応を案内して warn で記録する", () => {
		tree = selectLocationAndSearch("country:US, administrative_area_level_1:CA, locality:San Francisco");

		// ここが通ってしまうと候補が痩せて Claude フォールバックへ落ちる（課金だけ発生する）
		expect(mockRouterPush).not.toHaveBeenCalled();
		expect(findLoggedEvent("search_started")).toBeUndefined();

		// 数秒で消えるスナックバーではなく、確実に読めるダイアログで案内する
		expect(mockConfirm).toHaveBeenCalledTimes(1);
		expect(mockConfirm).toHaveBeenCalledWith(
			expect.objectContaining({
				title: "Search.unsupportedRegion.title",
				message: "Search.unsupportedRegion.message",
				// 選択肢の無い告知なので OK 単独。ここが true（既定値）に戻ると
				// 「キャンセル」が並び、何を選ばせたいのか分からないダイアログになる
				showCancel: false,
			}),
		);

		// 海外からの利用は想定内で、案内できている（= 回復済み）ため warn。
		// ただし新しいビルドでの海外アクセス量を可視化したいので、握り潰さず必ず記録する
		const logged = findLoggedEvent("search_blocked_unsupported_country");
		expect(logged).toMatchObject({
			error_level: "warn",
			payload: expect.objectContaining({ country_code: "US" }),
		});
	});

	it("壊れた address（市区町村名単体）では推薦 API を呼ばず、error で記録して選び直しを促す", () => {
		tree = selectLocationAndSearch("大阪市");

		expect(mockRouterPush).not.toHaveBeenCalled();
		expect(findLoggedEvent("search_started")).toBeUndefined();

		// 正規形式でない address は自クライアントが壊れた値を作ったということで、
		// 設計上は起きてはならず回復不能。エンジニアの対応が必要なので ERROR
		const logged = findLoggedEvent("search_blocked_malformed_address");
		expect(logged).toMatchObject({
			error_level: "error",
			payload: expect.objectContaining({ address: "大阪市", locationQuery: "テスト地点" }),
		});

		// 海外案内のダイアログは出さない（原因が違うので文言も導線も別）
		expect(mockConfirm).not.toHaveBeenCalled();
		expect(mockShowSnackbar).toHaveBeenCalledWith("Search.errors.malformedAddress");
	});

	it("海外の地点で連打しても、告知ダイアログとログは 1 回ずつしか積まれない", () => {
		// 多重検索防止の isSearchingRef はガードより後段にあり、この経路には効かない。
		// DialogProvider はキューなので、素通しすると連打した回数だけ同じ告知を閉じさせることになる
		tree = selectLocationAndSearch("country:US, administrative_area_level_1:CA");

		TestRenderer.act(() => {
			onPressSearch!();
			onPressSearch!();
		});

		expect(mockConfirm).toHaveBeenCalledTimes(1);
		expect(
			mockLogFrontendEvent.mock.calls
				.map(([arg]) => arg)
				.filter((arg) => arg?.event_name === "search_blocked_unsupported_country"),
		).toHaveLength(1);
		expect(mockRouterPush).not.toHaveBeenCalled();
	});

	it("告知が reject されても unhandled rejection にならず、ガードは解放される", async () => {
		// DialogProvider は unmount 時に未解決の confirm を reject する（「unmount 時の掃除」の effect）。
		// `.finally` は理由をそのまま通すので、受けないと画面遷移のたびに unhandled rejection になる
		mockConfirm.mockImplementationOnce(() => Promise.reject(new Error("DialogProvider unmounted")));

		tree = selectLocationAndSearch("country:US, administrative_area_level_1:CA");
		expect(mockConfirm).toHaveBeenCalledTimes(1);

		// reject の伝播（.finally → .catch）を流し切る
		await TestRenderer.act(async () => {
			await Promise.resolve();
		});

		// ガードが解放されているので、押し直せば再び告知が出る
		TestRenderer.act(() => {
			onPressSearch!();
		});
		expect(mockConfirm).toHaveBeenCalledTimes(2);
		expect(mockRouterPush).not.toHaveBeenCalled();
	});

	it("小文字の国コードは JP 扱いにせず、壊れた address として止める", () => {
		// #1196 サーバの照合は `dcf.feature_key = ANY(...)`（Postgres の完全一致 = 大小文字区別あり）で、
		// `region:country:jp` はホワイトリストの `region:country:JP` に当たらない。
		// ここを素通しすると「ガードは通ったのにサーバでは 0 件」という最も気づきにくい形で #1196 が再発する
		tree = selectLocationAndSearch("country:jp, administrative_area_level_1:Osaka");

		expect(mockRouterPush).not.toHaveBeenCalled();
		expect(findLoggedEvent("search_blocked_malformed_address")).toMatchObject({ error_level: "error" });
	});
});
