// #1136 【設計】レビュー投稿中のローディング表示を固定するテスト。
//
// 背景（Issue #1136）:
// レビュー投稿はメディア／サムネイルのアップロードと 3 本の API 呼び出し（v1/dishes →
// v1/dish-media → /v1/dish-reviews）を直列で回すため完了まで数秒〜数十秒かかる。
// にもかかわらず、投稿中であることが UI に一切出ていなかった。
// 投稿ボタンは `disabled={isProcessing || !isValid}` で操作不可にはなるものの、
// 未入力時（!isValid）の見た目と同じ opacity 0.4 になるだけなので、
// 「押せたのか分からない」まま待たされる状態だった。
//
// このテストは以下を赤で守る。
//   - 投稿中は投稿ボタンが disabled かつ busy で、ボタン内にローディングが出る
//   - 失敗しても（例外・API エラー）ローディングは必ず解除され、再投稿できる
//   - 成功時も解除される
//   - 投稿中の連打で API が二重に走らない（#1090 の同期ガードの回帰も兼ねる）
//
// PrimaryButton は**本物を使う**こと。`loading` が disabled を兼ねる
//（`isDisabled = disabled || loading`）という契約ごと固定したいため、モックへ差し替えると
// ReviewForm 側が loading を渡すのをやめても気付けなくなる。
import React, { act } from "react";
import { Text } from "react-native";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";

// ---- 観測対象（投稿ボタンの状態と callBackend の呼ばれ方）以外はすべてスタブ化する ----
// lucide のアイコンは名前ごとに export されるため Proxy で一括スタブ化する（ReviewForm.test.tsx と同じ）
jest.mock(
	"lucide-react-native",
	() =>
		new Proxy(
			{},
			{
				get: (_target, prop) =>
					prop === "__esModule"
						? true
						: function MockIcon() {
								return null;
							},
			},
		),
);
jest.mock("@/lib/mediaSelection", () => ({ selectMedia: jest.fn() }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("expo-image", () => ({
	Image: Object.assign(
		function MockExpoImage() {
			return null;
		},
		{ prefetch: () => Promise.resolve(true) },
	),
}));
// LinearGradient は native view なので、素の View へ落として PrimaryButton を描画できるようにする
jest.mock("expo-linear-gradient", () => {
	const { View: RNView } = require("react-native");
	return { LinearGradient: RNView };
});
// PrimaryButton 内のスピナー（Lottie）を観測可能なホスト要素へ置き換える。
// PrimaryButton は "./LoadingIndicator" 相対で読むが、解決先は同一モジュールなのでこのモックが効く
jest.mock("@/components/LoadingIndicator", () => {
	const ReactModule = require("react");
	const { Text: RNText } = require("react-native");
	return {
		LoadingIndicator: ({ size }: { size?: string }) =>
			ReactModule.createElement(RNText, { testID: "loading-indicator" }, size ?? "large"),
	};
});
jest.mock("react-native-gesture-handler", () => {
	const { ScrollView: RNScrollView } = require("react-native");
	return { ScrollView: RNScrollView };
});
jest.mock("@/features/map/components/InitialMediaPreview", () => ({ InitialMediaPreview: () => null }));
// #1386 ReviewForm はもう BlurModal も LegalDocument も持たない（料理カテゴリ選択と法務ドキュメントは
// ルートへ push する）。押した先の検証は __tests__/reviewFormRoutes.test.tsx が持つので、
// ここでは router を «何もしないスタブ» へ落として遷移を起こさないだけにする
jest.mock("expo-router", () => {
	const stub = { push: () => {}, replace: () => {}, back: () => {}, canGoBack: () => true };
	return { router: stub, useRouter: () => stub, useLocalSearchParams: () => ({}), useGlobalSearchParams: () => ({}) };
});
jest.mock("@/lib/googlePlaces", () => ({
	getCurrencyCodeFromRestaurant: () => "JPY",
	resolveCurrencySymbol: () => "¥",
	parseAmountString: (value: string) => Number(value),
	toMinorAmountInteger: (value: number) => value,
}));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => {
	// useHaptics は useCallback([]) で安定した参照を返す実装なので、テスト側でもそれに揃える
	const lightImpact = jest.fn();
	const mediumImpact = jest.fn();
	return { useHaptics: () => ({ lightImpact, mediumImpact }) };
});
jest.mock("@/hooks/useLogger", () => {
	const logFrontendEvent = jest.fn();
	return { useLogger: () => ({ logFrontendEvent }) };
});
// jest.mock のファクトリから参照できるのは `mock` 始まりの変数だけ
const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/hooks/useDishCategorySearch", () => ({
	useDishCategorySearch: () => ({ createDishCategoryVariant: jest.fn() }),
}));
jest.mock("@/hooks/useFileUploader", () => ({ useFileUploader: () => ({ uploadFile: jest.fn() }) }));
const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));
jest.mock("@/features/profile/hooks/useEnsureOwnProfileLoaded", () => ({ useEnsureOwnProfileLoaded: jest.fn() }));
jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: (selector: (state: unknown) => unknown) => selector({ profile: { display_name: "テスト太郎" } }),
}));
jest.mock("@/stores/useDishMediaEntriesStore", () => ({
	useDishMediaEntriesStore: {
		getState: () => ({
			upsertDishMediaEntries: jest.fn(),
			updateReviewIdsByKey: jest.fn(),
			updateMediaIdsByKey: jest.fn(),
		}),
	},
}));

import { ReviewForm } from "./ReviewForm";

// React 19 では初期描画がスケジューラのタスクへ回されるため、act() で包む必要がある
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** ReviewForm が要求する SupabaseRestaurants のうち、このテストで参照される最小限だけを持つダミー */
const restaurant = { id: "restaurant-1", name: "テスト飯店" } as never;

/**
 * プレビュー専用モード（既存メディアへのレビュー追加）のダミー。
 *
 * このモードを使うのは、メディア選択とアップロードを迂回して
 * 「投稿ボタンを押せる状態」へ最短で到達するため。投稿中フラグの立ち下がりは
 * `handleSubmit` の try..finally が握っており、アップロードの有無では変わらない。
 */
const prefilledMedia = {
	id: "dish-media-1",
	dish_id: "dish-1",
	media_type: "image",
	mediaUrl: "https://cdn.example.test/media.jpg",
	thumbnailImageUrl: "https://cdn.example.test/thumb.jpg",
	dish: { name: "からあげ", category_id: "dish-category-1" },
} as never;

const noop = () => {};

describe("ReviewForm のレビュー投稿中ローディング（#1136）", () => {
	let tree: TestRenderer.ReactTestRenderer;

	/** 入力が揃った（isValid === true）状態でマウントし、プレビューの解決まで流し切る */
	const mountReadyToSubmit = async () => {
		await act(async () => {
			tree = TestRenderer.create(
				<ReviewForm
					restaurant={restaurant}
					onCancel={noop}
					prefilledMedia={prefilledMedia}
					initialPrice="1000"
					initialReviewText="とてもおいしかった"
					initialRating={5}
				/>,
			);
		});
	};

	/** testID を持つノードのうち、実 DOM に相当するホスト要素（type が文字列）の最下層 */
	const hostByTestID = (testID: string): ReactTestInstance => {
		const hosts = tree.root.findAllByProps({ testID }).filter((node) => typeof node.type === "string");
		if (hosts.length === 0) throw new Error(`ホスト要素が見つかりません: ${testID}`);
		return hosts[hosts.length - 1];
	};

	/**
	 * 投稿ボタンの押下ハンドラ。PrimaryButton 内部の Pressable のものを取る（`android_ripple` で一意に特定）。
	 * ReviewForm の handleSubmit を直接呼ぶのではなく、PrimaryButton の isDisabled ガードごと通す。
	 */
	const pressSubmit = () => {
		const pressable = tree.root
			.findAllByProps({ testID: "review-submit-button" })
			.find((node) => node.props.android_ripple !== undefined && typeof node.props.onPress === "function");
		if (!pressable) throw new Error("投稿ボタンの Pressable が見つかりません");
		act(() => pressable.props.onPress({}));
	};

	/** 投稿ボタンが支援技術・react-native-web へ伝える状態 */
	const submitButtonState = () => hostByTestID("review-submit-button").props.accessibilityState;

	/** ボタン内にローディングが出ているか */
	const hasSpinner = () => tree.root.findAllByProps({ testID: "loading-indicator" }).length > 0;

	/** callBackend を保留させ、テスト側から解決／棄却できるようにする */
	const deferSubmit = () => {
		let resolveSubmit!: (value: unknown) => void;
		let rejectSubmit!: (reason: unknown) => void;
		mockCallBackend.mockImplementationOnce(
			() =>
				new Promise((resolve, reject) => {
					resolveSubmit = resolve;
					rejectSubmit = reject;
				}),
		);
		return {
			resolve: (value: unknown) => act(async () => resolveSubmit(value)),
			reject: (reason: unknown) => act(async () => rejectSubmit(reason)),
		};
	};

	afterEach(() => {
		act(() => tree?.unmount());
	});

	it("押す前は disabled でもローディングでもない", async () => {
		await mountReadyToSubmit();

		expect(submitButtonState()).toEqual({ disabled: false, busy: false });
		expect(hasSpinner()).toBe(false);
	});

	it("投稿中は投稿ボタンが disabled になり、ボタン内にローディングが出る", async () => {
		await mountReadyToSubmit();
		const submit = deferSubmit();

		pressSubmit();

		// #1136 これが本丸。disabled だけだと未入力時（!isValid）と見分けが付かないので busy + スピナーまで見る
		expect(submitButtonState()).toEqual({ disabled: true, busy: true });
		expect(hasSpinner()).toBe(true);

		await submit.resolve({ id: "dish-review-1" });
	});

	it("投稿が失敗してもローディングは解除され、再投稿できる", async () => {
		await mountReadyToSubmit();
		const failing = deferSubmit();

		pressSubmit();
		expect(hasSpinner()).toBe(true);

		await failing.reject(new Error("network down"));

		// #1136 解除は handleSubmit の finally が握る。try 側の return 直前へ散らすと
		// 例外経路で解除漏れが起き、スピナー固着で二度と投稿できなくなる
		expect(submitButtonState()).toEqual({ disabled: false, busy: false });
		expect(hasSpinner()).toBe(false);
		expect(mockShowSnackbar).toHaveBeenCalledWith("Map.errors.reviewSubmitFailed");

		// 解除後は同期ガード（isSubmittingRef）も外れており、押し直せる
		const retry = deferSubmit();
		pressSubmit();
		expect(hasSpinner()).toBe(true);
		await retry.resolve({ id: "dish-review-1" });
	});

	it("投稿が成功したときもローディングは解除される", async () => {
		await mountReadyToSubmit();
		const submit = deferSubmit();

		pressSubmit();
		expect(hasSpinner()).toBe(true);

		await submit.resolve({ id: "dish-review-1" });

		expect(submitButtonState()).toEqual({ disabled: false, busy: false });
		expect(hasSpinner()).toBe(false);
	});

	it("投稿中に連打しても API は二重に走らない（#1090 の同期ガード）", async () => {
		await mountReadyToSubmit();
		const submit = deferSubmit();

		pressSubmit();
		pressSubmit();
		pressSubmit();

		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		await submit.resolve({ id: "dish-review-1" });
	});
});
