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
// #1375 実機確認: `ReviewForm` は投稿ボタンの下端に system inset を足すため
// `useSafeAreaInsets()` を読む。このテストは `SafeAreaProvider` を張らずに
// コンポーネント単体を描くので、ライブラリ公式の jest mock（インセットは全て 0）を使う。
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
}));

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
// #1750 `recoverPendingMedia`（Android の保留結果の復帰）も本体の surface に入った。
// ここへ足さないと undefined を呼ぶことになり、選択そのものが起きない
jest.mock("@/lib/mediaSelection", () => ({ selectMedia: jest.fn(), recoverPendingMedia: jest.fn(async () => null) }));
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
	buildCurrencyChoices: () => ["JPY", "USD"],
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
// #1560 新規写真投稿の経路を通すため、アップロードの戻り値をテストから差し込めるようにする
const mockUploadFile = jest.fn();
jest.mock("@/hooks/useFileUploader", () => ({ useFileUploader: () => ({ uploadFile: mockUploadFile }) }));
const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));
jest.mock("@/features/profile/hooks/useEnsureOwnProfileLoaded", () => ({ useEnsureOwnProfileLoaded: jest.fn() }));
jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: (selector: (state: unknown) => unknown) => selector({ profile: { display_name: "テスト太郎" } }),
}));
// #1398 R2 「写真なしではストアを触らない」を観測するため、呼び出しごとに作り直さず
// モジュールスコープの安定した jest.fn() を返す（jest.mock のファクトリからは `mock` 始まりだけ参照できる）
const mockUpsertDishMediaEntries = jest.fn();
const mockUpdateReviewIdsByKey = jest.fn();
const mockUpdateMediaIdsByKey = jest.fn();
jest.mock("@/stores/useDishMediaEntriesStore", () => ({
	useDishMediaEntriesStore: {
		getState: () => ({
			upsertDishMediaEntries: mockUpsertDishMediaEntries,
			updateReviewIdsByKey: mockUpdateReviewIdsByKey,
			updateMediaIdsByKey: mockUpdateMediaIdsByKey,
		}),
	},
}));

import { ReviewForm } from "./ReviewForm";
import { selectMedia } from "@/lib/mediaSelection";
import { useDishCategorySelectionStore } from "../stores/useDishCategorySelectionStore";

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

// #1398 【設計】写真なし（status:"none"）での投稿を固定するテスト。
//
// 背景（Issue #1398 / 設計 §1 (c-2)・§2 B4・R2）:
// 完全新規の「食べた」記録には写真が無いことがある。写真なしのときは
//   POST /v1/dishes（get-or-create） → POST /v1/dish-reviews
// の **2 本だけ**を叩き、アップロードと POST /v1/dish-media は丸ごと飛ばす。
// `createdDishMediaId` は送らない（DTO 上すでに任意で、API は未指定なら NULL を書く）。
//
// さらに R2 が本丸で、**ストアを 1 つも触らないこと**を固定する。`useDishMediaEntriesStore` の
// エントリは dish_media が在ることを前提にしているため、写真なしで upsert すると
// 不正なエントリが入り全画面 Feed が壊れる。
describe("ReviewForm の写真なし投稿（#1398 B4 / R2）", () => {
	let tree: TestRenderer.ReactTestRenderer;
	const onSuccess = jest.fn();

	/**
	 * 写真なし（status:"none"）かつ入力が揃った状態でマウントする。
	 *
	 * 到達経路は実物と同じ「マウント時のピッカーをキャンセル」だけ（設計 B2）。
	 * 料理カテゴリは選択画面からの «戻り値» の箱（#1386）経由で確定させる。
	 */
	const mountNoMediaReadyToSubmit = async () => {
		(selectMedia as jest.Mock).mockResolvedValue({ success: false, error: "cancelled" });
		await act(async () => {
			tree = TestRenderer.create(
				<ReviewForm
					restaurant={restaurant}
					allowNoMedia
					onCancel={noop}
					onSuccess={onSuccess}
					initialPrice="1000"
					initialReviewText="とてもおいしかった"
					initialRating={5}
				/>,
			);
		});
		await act(async () => {
			useDishCategorySelectionStore
				.getState()
				.setResult({ status: "selected", dishCategoryId: "dish-category-1", label: "からあげ" });
		});
	};

	const pressSubmit = () => {
		const pressable = tree.root
			.findAllByProps({ testID: "review-submit-button" })
			.find((node) => node.props.android_ripple !== undefined && typeof node.props.onPress === "function");
		if (!pressable) throw new Error("投稿ボタンの Pressable が見つかりません");
		act(() => pressable.props.onPress({}));
	};

	/** callBackend が叩かれたエンドポイントの列（順序込み） */
	const calledEndpoints = () => mockCallBackend.mock.calls.map(([endpoint]) => endpoint);
	/** 指定エンドポイントへ渡された requestPayload */
	const payloadOf = (endpoint: string) =>
		mockCallBackend.mock.calls.find(([called]) => called === endpoint)?.[1]?.requestPayload;

	/** 写真なしの投稿を最後まで流す（v1/dishes → /v1/dish-reviews の 2 本が解決する） */
	const submitNoMedia = async () => {
		mockCallBackend.mockResolvedValueOnce({
			id: "dish-1",
			restaurant_id: "restaurant-1",
			category_id: "dish-category-1",
		});
		mockCallBackend.mockResolvedValueOnce({ id: "dish-review-1" });
		pressSubmit();
		await act(async () => {});
	};

	afterEach(() => {
		act(() => tree?.unmount());
		useDishCategorySelectionStore.getState().clear();
	});

	it("写真なしでも投稿ボタンが押せる（isValid は写真の有無に依存しない）", async () => {
		await mountNoMediaReadyToSubmit();

		const submitButton = tree.root
			.findAllByProps({ testID: "review-submit-button" })
			.filter((node) => typeof node.type === "string");
		expect(submitButton[submitButton.length - 1].props.accessibilityState).toEqual({ disabled: false, busy: false });
	});

	it("POST /v1/dishes → POST /v1/dish-reviews の 2 本だけを叩き、v1/dish-media は叩かない", async () => {
		await mountNoMediaReadyToSubmit();
		await submitNoMedia();

		// #1398 (c-2) dish が無いとレビューが書けないので v1/dishes だけは写真ありと同じく必要
		expect(calledEndpoints()).toEqual(["v1/dishes", "/v1/dish-reviews"]);
		expect(calledEndpoints()).not.toContain("v1/dish-media");
		expect(payloadOf("v1/dishes")).toEqual({ restaurantId: "restaurant-1", dishCategoryId: "dish-category-1" });
	});

	it("createdDishMediaId を送らない（API 側で created_dish_media_id = NULL になる）", async () => {
		await mountNoMediaReadyToSubmit();
		await submitNoMedia();

		const payload = payloadOf("/v1/dish-reviews");
		// キーごと載せない。undefined を明示的に載せる実装だと、将来 JSON 化の都合で null が飛びうる
		expect(Object.keys(payload)).not.toContain("createdDishMediaId");
		// レビューは get-or-create で得た dish に紐づく
		expect(payload.dishId).toBe("dish-1");
		expect(payload).toMatchObject({ comment: "とてもおいしかった", priceCents: 1000, rating: 5 });
	});

	it("R2 ストアを 1 つも触らない（不正なエントリが入ると全画面 Feed が壊れる）", async () => {
		await mountNoMediaReadyToSubmit();
		await submitNoMedia();

		expect(mockUpsertDishMediaEntries).not.toHaveBeenCalled();
		expect(mockUpdateMediaIdsByKey).not.toHaveBeenCalled();
		// 実体の無いレビュー id を一覧へ積むだけなので、これも呼ばない
		expect(mockUpdateReviewIdsByKey).not.toHaveBeenCalled();
	});

	it("allowNoMedia を渡さない従来経路（prefilledMedia）は、これまでどおりストアへ反映する", async () => {
		// R2 の «呼ばない» 側だけを固定すると、丸ごと呼ばなくしても緑になってしまう。
		// 既存経路がストアを更新し続けることを対で押さえる
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

		mockCallBackend.mockResolvedValueOnce({ id: "dish-review-1" });
		pressSubmit();
		await act(async () => {});

		expect(calledEndpoints()).toEqual(["/v1/dish-reviews"]);
		expect(payloadOf("/v1/dish-reviews").createdDishMediaId).toBe("dish-media-1");
		expect(mockUpsertDishMediaEntries).toHaveBeenCalledTimes(1);
		expect(mockUpdateReviewIdsByKey).toHaveBeenCalledTimes(1);
		// prefilledMedia のときは元から呼ばない（既存挙動）
		expect(mockUpdateMediaIdsByKey).not.toHaveBeenCalled();
	});

	it("onSuccess へ dishMedia: null を渡す（呼び出し元が /post/[id] への遷移を抑止できる）", async () => {
		await mountNoMediaReadyToSubmit();
		await submitNoMedia();

		expect(onSuccess).toHaveBeenCalledWith({ dishMedia: null, dishReviewId: "dish-review-1" });
	});
});

/*
#1560 【回帰】新規写真投稿を **1 本の HTTP** で終わらせる。

分かれていた頃は `POST /v1/dish-media` → `POST /v1/dish-reviews` の 2 本立てで、
1 本目が成功して 2 本目が落ちる（通信断・5xx）と写真だけが残った。
`GET /v1/users/me/dishes` の候補集合は want（reactions）と eaten（dish_reviews）の
2 系統しか無く **dish_media を起点にした系統が無い**ため、その行は一覧にもピンにも出ず、
本人が到達する導線が消える。#1513 の「投稿を削除」でも消せない。

ここで固定するのは «2 本目を投げないこと» そのものである。投げてしまえば、
サーバーが 1 トランザクションにしても部分成功の窓は閉じない。
*/
describe("ReviewForm の新規写真投稿（#1560 1 トランザクション化）", () => {
	let tree: TestRenderer.ReactTestRenderer;

	const mountWithNewPhoto = async () => {
		(selectMedia as jest.Mock).mockResolvedValue({
			success: true,
			media: { type: "image", uri: "file:///tmp/pic.jpg", mimeType: "image/jpeg" },
		});
		mockUploadFile.mockResolvedValue("users/u1/dish-1-media.jpg");
		await act(async () => {
			tree = TestRenderer.create(
				<ReviewForm
					restaurant={restaurant}
					onCancel={noop}
					onSuccess={jest.fn()}
					initialPrice="1000"
					initialReviewText="とてもおいしかった"
					initialRating={5}
				/>,
			);
		});
		await act(async () => {
			useDishCategorySelectionStore
				.getState()
				.setResult({ status: "selected", dishCategoryId: "dish-category-1", label: "からあげ" });
		});
	};

	const pressSubmit = () => {
		const pressable = tree.root
			.findAllByProps({ testID: "review-submit-button" })
			.find((node) => node.props.android_ripple !== undefined && typeof node.props.onPress === "function");
		if (!pressable) throw new Error("投稿ボタンの Pressable が見つかりません");
		act(() => pressable.props.onPress({}));
	};

	const calledEndpoints = () => mockCallBackend.mock.calls.map(([endpoint]) => endpoint);
	const payloadOf = (endpoint: string) =>
		mockCallBackend.mock.calls.find(([called]) => called === endpoint)?.[1]?.requestPayload;

	beforeEach(() => {
		mockCallBackend.mockReset();
		mockUploadFile.mockReset();
	});

	afterEach(() => {
		if (tree) act(() => tree.unmount());
	});

	it("v1/dish-media がレビュー本体を同梱して 1 本で終わり、/v1/dish-reviews を叩かない", async () => {
		await mountWithNewPhoto();
		// v1/dishes（get-or-create）→ v1/dish-media（レビュー同梱）
		mockCallBackend.mockResolvedValueOnce({ id: "dish-1", restaurant_id: "restaurant-1", category_id: "c-1" });
		mockCallBackend.mockResolvedValueOnce({
			id: "dish-media-1",
			dish_id: "dish-1",
			dishReview: { id: "dish-review-1" },
		});
		pressSubmit();
		await act(async () => {});

		expect(calledEndpoints()).toEqual(["v1/dishes", "v1/dish-media"]);
		expect(calledEndpoints()).not.toContain("/v1/dish-reviews");

		const payload = payloadOf("v1/dish-media");
		expect(payload.review).toEqual({
			comment: "とてもおいしかった",
			languageCode: "ja-JP",
			priceCents: 1000,
			currencyCode: "JPY",
			rating: 5,
		});
		// dishId / createdDishMediaId はサーバーが決める（クライアントに決めさせない）
		expect(payload.review).not.toHaveProperty("dishId");
		expect(payload.review).not.toHaveProperty("createdDishMediaId");
	});

	it("サーバーがレビューを返さなければ、従来どおり /v1/dish-reviews を投げる（後方互換）", async () => {
		await mountWithNewPhoto();
		mockCallBackend.mockResolvedValueOnce({ id: "dish-1", restaurant_id: "restaurant-1", category_id: "c-1" });
		// dishReview を返さない旧 API を模す
		mockCallBackend.mockResolvedValueOnce({ id: "dish-media-1", dish_id: "dish-1" });
		mockCallBackend.mockResolvedValueOnce({ id: "dish-review-1" });
		pressSubmit();
		await act(async () => {});

		expect(calledEndpoints()).toEqual(["v1/dishes", "v1/dish-media", "/v1/dish-reviews"]);
		expect(payloadOf("/v1/dish-reviews").createdDishMediaId).toBe("dish-media-1");
	});
});
