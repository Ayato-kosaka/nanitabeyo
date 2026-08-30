// #1127 【設計】ReviewForm のマウント時メディア選択が、親の再レンダーに巻き込まれないことを固定するテスト。
//
// 背景（Issue #1127）:
// 旧実装はマウント時メディア選択 useEffect の依存配列に `onCancel` / `lightImpact` を並べていた。
// `onCancel` は呼び出し元（review.tsx）でインライン生成されるため、親が再レンダーするたびに
// effect が cleanup → 再実行される。cleanup は `mountedRef.current = false` を立てるだけで
// 再武装する処理がどこにも無く、**一度 false になると二度と true に戻らない**。
// その結果:
//   - `selectMedia()` が 1 回の押下で 2 回走る
//     （expo-image-picker の Android 実装は `if (isPickerOpen) return canceled` を持つため、
//      2 発目はピッカーを開かずに即 canceled を返す）
//   - すべての結果が `if (cancelled || !mountedRef.current) return;` で捨てられ、
//     `mediaState` は loading のまま固着し、`onCancel()` すら呼ばれず戻ることもできない
//
// このテストは「親を再レンダーしても selectMedia は 1 回だけ・結果は破棄されない」を赤で守る。
// 依存配列に onCancel を戻す / 世代カウンタ（mediaGenerationRef）による生死判定をやめると、いずれも失敗する。
//
// プレビュー専用モード（prefilledMedia）側の回帰は、下の 2 つ目の describe で別に固定している。
import React, { act, useState } from "react";
import { Dimensions, StyleSheet, Text } from "react-native";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";

import type { MediaData } from "@/lib/mediaSelection";

// ---- 観測対象（selectMedia の呼ばれ方と結果の反映）以外はすべてスタブ化する ----
// lucide のアイコンは名前ごとに export されるため Proxy で一括スタブ化する（searchScreenPreload.test.tsx と同じ）
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
jest.mock("@/lib/mediaSelection", () => ({ selectMedia: jest.fn() }));
// #1375（5 巡目）既存メディア一覧は自分で API を叩くので、ここでは «置かれているか» だけを見る器にする
/*
#1375（6 巡目）記録フローは «料理カテゴリー → 写真» の順になった。
1 歩目をモックして、テストから «選んだ» を起こせるようにする
（本物は API を引くので、ここでは順序と受け渡しだけを見る）。
*/
jest.mock("./DishCategoryStep", () => {
	const { View } = require("react-native");
	return {
		DishCategoryStep: (props: { onSelectExisting: (c: { dishCategoryId: string; label: string }) => void }) => (
			<View testID="review-dish-category-step-host" onPress={props.onSelectExisting} />
		),
	};
});

jest.mock("./ExistingDishMediaPicker", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	return {
		ExistingDishMediaPicker: ({ restaurantId }: { restaurantId: string }) =>
			ReactActual.createElement(RNView, { testID: "review-existing-dish-media-host", "data-restaurant": restaurantId }),
	};
});
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
// prefilledMedia（プレビュー専用モード）は Image.prefetch の解決を待ってから success へ倒すため、
// 解決タイミングをテストから握れるようにしておく。jest.mock のファクトリからは `mock` 始まりの変数だけ参照できる
const mockImagePrefetch = jest.fn((_url: string) => Promise.resolve(true));
jest.mock("expo-image", () => ({
	Image: Object.assign(
		function MockExpoImage() {
			return null;
		},
		// ファクトリ評価時点では mockImagePrefetch が未初期化なので、呼び出し時に解決する
		{ prefetch: (url: string) => mockImagePrefetch(url) },
	),
}));
jest.mock("react-native-gesture-handler", () => {
	const { ScrollView: RNScrollView } = require("react-native");
	return { ScrollView: RNScrollView };
});
jest.mock("@/features/map/components/InitialMediaPreview", () => {
	const ReactModule = require("react");
	const { Text: RNText } = require("react-native");
	return {
		// 選択結果がフォームまで届いたことを uri で観測できるようにする
		InitialMediaPreview: ({ media }: { media: { uri: string } }) =>
			ReactModule.createElement(RNText, { testID: "initial-media-preview" }, media.uri),
	};
});
jest.mock("@/components/PrimaryButton", () => ({ PrimaryButton: () => null }));
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
/*
  #1366 jest.fn をファクトリの内側に閉じ込めると、テストから取り出す手段が `useLogger()` を
  呼ぶことしか無くなる。差し替え後の useLogger は «毎回同じ jest.fn を返すただの関数» であって
  フックではないのだが、名前が use で始まるため rules-of-hooks は
  «トップレベルでのフック呼び出し» として error にする（この 1 件がまさにそれだった）。
  jest.fn をモジュールスコープへ出せば呼ぶ必要そのものが消える。
  変数名の `mock` 接頭辞は必須。babel-plugin-jest-hoist が jest.mock の巻き上げ後も
  参照を許すのはこの命名だけで、外すと «out-of-scope variables» で落ちる。
*/
const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: jest.fn() }) }));
jest.mock("@/hooks/useDishCategorySearch", () => ({
	useDishCategorySearch: () => ({ createDishCategoryVariant: jest.fn() }),
}));
jest.mock("@/hooks/useFileUploader", () => ({ useFileUploader: () => ({ uploadFile: jest.fn() }) }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
jest.mock("@/features/profile/hooks/useEnsureOwnProfileLoaded", () => ({ useEnsureOwnProfileLoaded: jest.fn() }));
jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: (selector: (state: unknown) => unknown) => selector({ profile: null }),
}));
jest.mock("@/stores/useDishMediaEntriesStore", () => ({
	useDishMediaEntriesStore: { getState: () => ({}) },
}));

import { ReviewForm } from "./ReviewForm";
import { selectMedia } from "@/lib/mediaSelection";
import { useLogger } from "@/hooks/useLogger";

// React 19 では初期描画がスケジューラのタスクへ回されるため、act() で包む必要がある
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const selectMediaMock = selectMedia as jest.MockedFunction<typeof selectMedia>;
const logFrontendEventMock = mockLogFrontendEvent as jest.MockedFunction<
	ReturnType<typeof useLogger>["logFrontendEvent"]
>;

/** ReviewForm が要求する SupabaseRestaurants のうち、このテストで参照される最小限だけを持つダミー */
const restaurant = { id: "restaurant-1", name: "テスト飯店" } as never;

const stubMedia: MediaData = { type: "image", uri: "file:///tmp/selected.jpg", mimeType: "image/jpeg" };

/**
 * 親が再レンダーするたびに `onCancel` を**インライン生成**するテスト用の親。
 * Issue #1127 で実際に踏んでいた review.tsx:150（`onCancel={() => router.back()}`）と同じ形。
 */
function ParentHarness({ onCancel }: { onCancel: () => void }) {
	const [, setTick] = useState(0);
	rerenderParent = () => setTick((tick) => tick + 1);
	// 毎レンダー新しい関数を渡す（= 修正前は effect が張り替わっていた条件）
	return <ReviewForm restaurant={restaurant} onCancel={() => onCancel()} />;
}

/** ParentHarness / PrefilledParentHarness を親側の state 更新で再レンダーさせる */
let rerenderParent: () => void;

/**
 * prefilledMedia のうち、プレビュー描画で実際に読まれるフィールドだけを持つダミー。
 * 呼ぶたびに**新しいオブジェクト**を返す（= 呼び出し元のインライン生成と同じ形）。
 */
const makePrefilledMedia = (mediaUrl: string | null) =>
	({
		id: "dish-media-1",
		media_type: "image",
		// #1629 既定は自ストレージの行。外部埋め込みは下の専用ファクトリで作る
		render_type: "stored",
		mediaUrl,
		thumbnailImageUrl: "https://cdn.example.test/thumb.jpg",
		dish: { name: "からあげ", category_id: "dish-category-1" },
	}) as never;

/**
 * #1629 取り込んだ SNS 投稿（`render_type='external_embed'`）の prefilledMedia。
 * **`mediaUrl` は常に null**（自ストレージに実体が無い）。
 */
const makeExternalEmbedMedia = (thumbnailImageUrl: string | null) =>
	({
		id: "dish-media-ig-1",
		media_type: "image",
		render_type: "external_embed",
		mediaUrl: null,
		thumbnailImageUrl,
		dish: { name: "ラーメン", category_id: "dish-category-2" },
	}) as never;

/**
 * 親が再レンダーするたびに `prefilledMedia` を**インライン生成**するテスト用の親。
 * Issue #1127 のレビューで検出した review-from-media/[dishMediaId].tsx:180
 * （`prefilledMedia={{ ...dishMedia.dish_media, dish: dishMedia.dish }}`）と同じ形。
 */
function PrefilledParentHarness({ initialMediaUrl }: { initialMediaUrl: string | null }) {
	const [, setTick] = useState(0);
	const [mediaUrl, setMediaUrl] = useState(initialMediaUrl);
	rerenderParent = () => setTick((tick) => tick + 1);
	setPrefilledMediaUrl = setMediaUrl;
	// 毎レンダー新しいオブジェクトを渡す（中身は mediaUrl 以外いっさい変わらない）
	return <ReviewForm restaurant={restaurant} onCancel={noop} prefilledMedia={makePrefilledMedia(mediaUrl)} />;
}

/** PrefilledParentHarness が渡す mediaUrl を差し替える（#511 の「加工中 → 完了」を再現する） */
let setPrefilledMediaUrl: (mediaUrl: string | null) => void;

const noop = () => {};

/** `selectMedia` の 1 回目の呼び出しを、テストから任意のタイミングで解決させる */
function deferSelectMedia() {
	let resolveSelection!: (result: Awaited<ReturnType<typeof selectMedia>>) => void;
	selectMediaMock.mockReturnValueOnce(
		new Promise((resolve) => {
			resolveSelection = resolve;
		}),
	);
	return (result: Awaited<ReturnType<typeof selectMedia>>) => act(async () => resolveSelection(result));
}

/** 指定テキストを表示している Text ノードを列挙する（host / composite の重複を排除する） */
const findTextNodes = (root: ReactTestInstance, label: string) =>
	root.findAll((node) => node.type === Text && node.props.children === label);

/** 表示テキストから、それを内包するボタンの onPress ハンドラを取り出す */
function findPressHandler(root: ReactTestInstance, label: string): () => void {
	let node: ReactTestInstance | null = findTextNodes(root, label)[0];
	while (node && typeof node.props.onPress !== "function") node = node.parent;
	if (!node) throw new Error(`onPress を持つ祖先が見つかりません: ${label}`);
	return node.props.onPress;
}

/** logFrontendEvent へ渡された引数のうち、指定イベント名のものだけを取り出す */
const loggedEvents = (eventName: string) =>
	logFrontendEventMock.mock.calls.map(([arg]) => arg).filter((arg) => arg.event_name === eventName);

describe("ReviewForm のマウント時メディア選択（#1127）", () => {
	let tree: TestRenderer.ReactTestRenderer;

	const mount = (onCancel: () => void = jest.fn()) => {
		act(() => {
			tree = TestRenderer.create(<ParentHarness onCancel={onCancel} />);
		});
	};

	afterEach(() => {
		act(() => tree?.unmount());
	});

	it("親が再レンダーしても selectMedia は 1 回しか呼ばれない", () => {
		deferSelectMedia();
		mount();

		expect(selectMediaMock).toHaveBeenCalledTimes(1);

		act(() => rerenderParent());
		act(() => rerenderParent());

		// 修正前はここが 3 回になり、2 発目以降は native の isPickerOpen ガードに弾かれていた
		expect(selectMediaMock).toHaveBeenCalledTimes(1);
	});

	it("親が再レンダーしたあとに選択が完了しても、結果は破棄されずフォームへ反映される", async () => {
		const resolveSelection = deferSelectMedia();
		mount();

		// OS のフォトピッカーはアプリを background に落とすため、戻った瞬間に
		// TOKEN_REFRESHED → context 更新 → 親の再レンダーが走りうる（Issue #1127 の実際の経路）
		act(() => rerenderParent());

		await resolveSelection({ success: true, media: stubMedia });

		// 修正前は mountedRef が false のままで結果が捨てられ、loading のまま固着していた
		expect(tree.root.findByProps({ testID: "initial-media-preview" }).props.children).toBe(stubMedia.uri);
		expect(tree.root.findAll((node) => node.props.children === "Map.media.loadingMedia")).toHaveLength(0);
	});

	it("キャンセルで返ったときは、親の再レンダー後でも最新の onCancel が呼ばれる", async () => {
		const onCancel = jest.fn();
		const resolveSelection = deferSelectMedia();
		mount(onCancel);

		act(() => rerenderParent());

		await resolveSelection({ success: false, error: "cancelled" });

		// 修正前は mountedRef ガードの手前で捨てられ、戻ることもできない手詰まりになっていた
		expect(onCancel).toHaveBeenCalledTimes(1);
	});

	it("エラー種別ごとの文言分岐と再試行はこれまでどおり動く", async () => {
		const resolveSelection = deferSelectMedia();
		mount();

		// #1375 実機確認（3 巡目）: 権限拒否は「再試行」ではなく **「設定を開く」** を出す。
		// 再試行しても同じ結果にしかならないため（実機で «設定まで行くのが面倒» と指摘され、
		// Linking.openSettings で 1 タップ化した）
		await resolveSelection({ success: false, error: "permission_denied" });
		expect(findTextNodes(tree.root, "Map.media.permissionDenied")).toHaveLength(1);
		expect(findTextNodes(tree.root, "Map.media.openSettings")).toHaveLength(1);
		expect(findTextNodes(tree.root, "Common.retry")).toHaveLength(0);
	});

	it("権限以外のエラー（動画が長すぎる等）は従来どおり再試行が出て、同じ実行本体を通る", async () => {
		const resolveSelection = deferSelectMedia();
		mount();

		await resolveSelection({ success: false, error: "video_too_long" });
		expect(findTextNodes(tree.root, "Map.media.videoTooLong")).toHaveLength(1);

		const retry = deferSelectMedia();
		act(() => findPressHandler(tree.root, "Common.retry")());
		expect(selectMediaMock).toHaveBeenCalledTimes(2);

		await retry({ success: true, media: stubMedia });
		expect(tree.root.findByProps({ testID: "initial-media-preview" }).props.children).toBe(stubMedia.uri);
	});

	it("選択が進行中のあいだは、再試行を押しても selectMedia を二重に起動しない", async () => {
		const resolveSelection = deferSelectMedia();
		mount();

		await resolveSelection({ success: false, error: "video_too_long" });

		deferSelectMedia();
		// 押した瞬間に loading へ倒れて再試行ボタンが消えるため、ハンドラを掴んでから連打する
		//（実機では 1 フレーム内の連打がこれに相当する）
		const retryPress = findPressHandler(tree.root, "Common.retry");
		act(() => retryPress());
		expect(selectMediaMock).toHaveBeenCalledTimes(2);

		// 1 回目の再試行がまだ native 側で開いている状態での 2 発目。
		// JS 側で弾かないと Android の isPickerOpen ガードに落ちて即 canceled が返る
		act(() => retryPress());
		expect(selectMediaMock).toHaveBeenCalledTimes(2);
	});

	it("同時実行ガードで弾いた起動は review_media_selection_skipped として残る", async () => {
		const resolveSelection = deferSelectMedia();
		mount();

		await resolveSelection({ success: false, error: "video_too_long" });

		deferSelectMedia();
		const retryPress = findPressHandler(tree.root, "Common.retry");
		act(() => retryPress());
		// 1 回目の再試行がまだ進行中の状態での 2 発目。ここが黙って捨てられると
		// 「二重起動が起きた」という一番知りたい事実が nanitabeyo_logs_dev から追えない
		act(() => retryPress());

		expect(loggedEvents("review_media_selection_skipped")).toEqual([
			{ event_name: "review_media_selection_skipped", error_level: "warn", payload: { origin: "retry" } },
		]);
		// 弾かれた起動は attempt を消費しない（start は mount 1 回 + retry 1 回だけ）
		expect(loggedEvents("review_media_selection_start")).toHaveLength(2);
	});

	it("診断ログに起動回数・起点・成否・破棄有無が残る", async () => {
		const resolveSelection = deferSelectMedia();
		mount();

		expect(loggedEvents("review_media_selection_start")).toEqual([
			{ event_name: "review_media_selection_start", error_level: "log", payload: { attempt: 1, origin: "mount" } },
		]);

		await resolveSelection({ success: true, media: stubMedia });

		expect(loggedEvents("review_media_selection_finished")).toEqual([
			{
				event_name: "review_media_selection_finished",
				error_level: "log",
				payload: { attempt: 1, origin: "mount", success: true, discarded: false },
			},
		]);
		// #1127 【セキュリティ】payload にメディア URI を載せないこと
		for (const event of [
			...loggedEvents("review_media_selection_start"),
			...loggedEvents("review_media_selection_finished"),
		]) {
			expect(JSON.stringify(event.payload)).not.toContain(stubMedia.uri);
		}
	});
});

// #1398 【設計】写真なしモード（allowNoMedia）のテスト。
//
// 背景（Issue #1398 / 設計 §2 B2・B3・Q2）:
// 完全新規の「食べた」記録には写真が無いことがある。そこで `/restaurant/[id]/review` だけに
// `allowNoMedia` を渡し、**ピッカーのキャンセル = 写真なしで続行**へ倒す。
//
// ここで固定するのは 2 つ。
//   1. `allowNoMedia` を渡さなければ挙動は**完全に従来どおり**（キャンセル → onCancel → 画面が閉じる）
//   2. `allowNoMedia` のときはキャンセルで閉じず、写真なし（status:"none"）のプレースホルダへ倒れ、
//      そこから選び直して success へ戻れる（= 写真なしは行き止まりではない）
//
// 1 が落ちると `review-from-media` 経路（prefilledMedia モード）の退出動線ごと壊れる。
describe("ReviewForm の写真なしモード（#1398 B2 / B3）", () => {
	let tree: TestRenderer.ReactTestRenderer;

	/** allowNoMedia の有無を切り替えてマウントする（未指定 = 既定 false = 従来どおり） */
	const mount = ({ onCancel, allowNoMedia }: { onCancel: () => void; allowNoMedia?: boolean }) => {
		act(() => {
			tree = TestRenderer.create(
				<ReviewForm restaurant={restaurant} onCancel={onCancel} allowNoMedia={allowNoMedia} />,
			);
		});
	};

	/** 「写真を追加」プレースホルダのノード（composite + host が並ぶので長さは見ない） */
	const placeholderNodes = () => tree.root.findAllByProps({ testID: "review-add-photo-placeholder" });
	const hasPlaceholder = () => placeholderNodes().length > 0;

	const pressPlaceholder = () => {
		const node = placeholderNodes().find((candidate) => typeof candidate.props.onPress === "function");
		if (!node) throw new Error("プレースホルダの onPress が見つかりません");
		act(() => node.props.onPress());
	};

	afterEach(() => {
		act(() => tree?.unmount());
	});

	it("allowNoMedia を渡さないときのキャンセルは、従来どおり onCancel を呼ぶ", async () => {
		const onCancel = jest.fn();
		const resolveSelection = deferSelectMedia();
		mount({ onCancel });

		await resolveSelection({ success: false, error: "cancelled" });

		// #1398 ここが «写真なしの分岐が既存経路へ漏れていない» ことの本丸。
		// review-from-media も含めて allowNoMedia を渡さない呼び出し元はすべてこの経路を通る
		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(hasPlaceholder()).toBe(false);
	});

	it("allowNoMedia のときのキャンセルは onCancel を呼ばず、写真なしのプレースホルダへ倒れる", async () => {
		const onCancel = jest.fn();
		const resolveSelection = deferSelectMedia();
		mount({ onCancel, allowNoMedia: true });

		await resolveSelection({ success: false, error: "cancelled" });

		// 画面は閉じない（退出は ScreenHeader の戻るボタンで確保されている。設計 Q2）
		expect(onCancel).not.toHaveBeenCalled();
		expect(hasPlaceholder()).toBe(true);
		// ローディングのまま固着しないこと
		expect(findTextNodes(tree.root, "Map.media.loadingMedia")).toHaveLength(0);
		// 「写真なしでも記録できる」ことが画面に出ている（機能欠落に見せない。設計 §4-1）。
		// #1375（5 巡目）: 以前は押せない説明文（noPhotoHint）だったが、
		// «スキップ» は 1 タップで済むべき操作なので押せるボタンにした
		const skip = tree.root.findAll((node) => node.props?.testID === "review-skip-photo");
		expect(skip.length).toBeGreaterThan(0);
		expect(findTextNodes(tree.root, "MyDishes.record.skipPhoto").length).toBeGreaterThan(0);
		// フォームは開いたまま = 既存の入力欄がそのまま使える
		expect(tree.root.findAllByProps({ testID: "review-comment-input" }).length).toBeGreaterThan(0);
	});

	// #1375 4 巡目: 「ライブラリから選ぶ / 写真を撮る」の 2 択導線
	it("プレースホルダにはライブラリとカメラの導線があり、カメラは source: camera で起動する", async () => {
		const resolveSelection = deferSelectMedia();
		mount({ onCancel: jest.fn(), allowNoMedia: true });

		await resolveSelection({ success: false, error: "cancelled" });
		expect(hasPlaceholder()).toBe(true);
		expect(tree.root.findAllByProps({ testID: "review-pick-from-library" }).length).toBeGreaterThan(0);

		deferSelectMedia();
		const cameraNode = tree.root
			.findAllByProps({ testID: "review-shoot-with-camera" })
			.find((candidate) => typeof candidate.props.onPress === "function");
		if (!cameraNode) throw new Error("カメラ導線が見つかりません");
		act(() => cameraNode.props.onPress());

		expect(selectMediaMock).toHaveBeenCalledTimes(2);
		const [mediaTypes, options] = selectMediaMock.mock.calls[1];
		// カメラは写真のみ（NSMicrophoneUsageDescription が現行ビルドに無く、動画撮影は落ちる）
		expect(mediaTypes).toEqual(["images"]);
		expect(options).toMatchObject({ source: "camera" });
	});

	it("プレースホルダをタップすれば選び直せて、写真なしから写真ありへ戻れる", async () => {
		const resolveSelection = deferSelectMedia();
		mount({ onCancel: jest.fn(), allowNoMedia: true });

		await resolveSelection({ success: false, error: "cancelled" });
		expect(hasPlaceholder()).toBe(true);

		// 再選択は「再試行」と同じ実行本体（ref 経由・同時実行ガード・世代判定）を通る
		const retry = deferSelectMedia();
		pressPlaceholder();
		expect(selectMediaMock).toHaveBeenCalledTimes(2);

		await retry({ success: true, media: stubMedia });

		expect(tree.root.findByProps({ testID: "initial-media-preview" }).props.children).toBe(stubMedia.uri);
		expect(hasPlaceholder()).toBe(false);
	});

	// #1441 M-1 【レビュー対応】写真なしで ★・コメント・価格・カテゴリを入力した後にプレースホルダから
	// 再選択して失敗すると、以前はエラーカードの「閉じる」しか押せず、それが onCancel（= 画面を閉じる）
	// を呼んでいたため入力が丸ごと消えていた。allowNoMedia のときは「閉じる」でフォームへ戻し、
	// 入力を残す。allowNoMedia でないときの挙動（従来どおり onCancel）は変えていないことも対で固定する
	it("allowNoMedia のときはエラーカードの「閉じる」でフォームへ戻り、入力を残す", async () => {
		const onCancel = jest.fn();
		const resolveSelection = deferSelectMedia();
		mount({ onCancel, allowNoMedia: true });

		await resolveSelection({ success: false, error: "cancelled" });
		expect(hasPlaceholder()).toBe(true);

		const commentInput = tree.root.findByProps({ testID: "review-comment-input" });
		act(() => commentInput.props.onChangeText("美味しかった"));

		const retry = deferSelectMedia();
		pressPlaceholder();
		await retry({ success: false, error: "video_too_long" });
		expect(findTextNodes(tree.root, "Map.media.videoTooLong")).toHaveLength(1);

		act(() => findPressHandler(tree.root, "Common.close")());

		// 画面は閉じない（従来は onCancel → router.back() で入力が丸ごと消えていた）
		expect(onCancel).not.toHaveBeenCalled();
		// 写真なしのフォームへ戻る
		expect(hasPlaceholder()).toBe(true);
		// 入力済みのコメントは消えない
		expect(tree.root.findByProps({ testID: "review-comment-input" }).props.value).toBe("美味しかった");
	});

	it("allowNoMedia を渡さないときのエラーカードの「閉じる」は、従来どおり onCancel を呼ぶ", async () => {
		const onCancel = jest.fn();
		const resolveSelection = deferSelectMedia();
		mount({ onCancel });

		await resolveSelection({ success: false, error: "permission_denied" });
		expect(findTextNodes(tree.root, "Map.media.permissionDenied")).toHaveLength(1);

		act(() => findPressHandler(tree.root, "Common.close")());

		expect(onCancel).toHaveBeenCalledTimes(1);
	});
});

// #1127 【設計】プレビュー専用モード（prefilledMedia）のテスト。
//
// 背景（PR #1128 のレビュー指摘 Major-1）:
// 通常モードの本丸修正として effect 先頭で mountedRef を再武装したところ、prefilled ブランチの
// 先頭ガード（`if (!prefilledMedia || !mountedRef.current) return;`）を毎回通過するようになり、
// `media_type === "image"` では毎回 `setMediaState({ status: "loading" })` を踏むようになった。
// 呼び出し元 review-from-media/[dishMediaId].tsx は prefilledMedia をインラインのオブジェクト
// リテラルで渡すため、親が再レンダーするたびにプレビューがスピナーへ点滅していた。
//
// かといって `prefilledMedia?.id` だけを依存キーにすると、#511 の「mediaUrl が null（加工中）から
// 後追いで値ありへ変わる」経路が反映されなくなる。この 2 つを同時に固定する。
describe("ReviewForm のプレビュー専用モード（#1127 / #511）", () => {
	let tree: TestRenderer.ReactTestRenderer;

	/** prefilledMedia モードでマウントし、Image.prefetch の解決まで流し切る */
	const mountPrefilled = async (initialMediaUrl: string | null) => {
		await act(async () => {
			tree = TestRenderer.create(<PrefilledParentHarness initialMediaUrl={initialMediaUrl} />);
		});
	};

	/** プレビューへ届いた uri（InitialMediaPreview のモックが children に出す） */
	const previewUri = () => tree.root.findByProps({ testID: "initial-media-preview" }).props.children;

	afterEach(() => {
		act(() => tree?.unmount());
	});

	it("同じ中身の prefilledMedia を新しいオブジェクトで渡し直されても、プレビューが loading へ巻き戻らない", async () => {
		const mediaUrl = "https://cdn.example.test/media.jpg";
		await mountPrefilled(mediaUrl);

		expect(previewUri()).toBe(mediaUrl);
		const prefetchCallsBeforeRerender = mockImagePrefetch.mock.calls.length;

		// [dishMediaId].tsx は useAPICall() → useAuth() 経由で AuthContext を購読しているため、
		// トークンリフレッシュ等で親の再レンダーが頻繁に起きる（Issue #1127 が土壌として挙げた経路）
		act(() => rerenderParent());

		// 修正前はここで effect が張り替わり、同期的に loading へ倒れてスピナーが点滅していた
		expect(findTextNodes(tree.root, "Map.media.loadingMedia")).toHaveLength(0);
		expect(previewUri()).toBe(mediaUrl);
		// 中身が変わっていない以上、prefetch もやり直さない
		expect(mockImagePrefetch.mock.calls.length).toBe(prefetchCallsBeforeRerender);
	});

	it("#511 mediaUrl が null（加工中）から値ありへ変わったら、プレビューへ反映される", async () => {
		await mountPrefilled(null);

		// 加工中はプレビューを出さず loading のまま（#511 の早期 return）
		expect(tree.root.findAllByProps({ testID: "initial-media-preview" })).toHaveLength(0);
		expect(findTextNodes(tree.root, "Map.media.loadingMedia")).toHaveLength(1);
		expect(mockImagePrefetch).not.toHaveBeenCalled();

		const processedUrl = "https://cdn.example.test/processed.jpg";
		await act(async () => setPrefilledMediaUrl(processedUrl));

		// identity ではなく**中身**で張り替えるので、ここは確実に再実行されなければならない
		expect(previewUri()).toBe(processedUrl);
		expect(mockImagePrefetch).toHaveBeenCalledWith(processedUrl);
	});
});

/*
#1375 実機確認（5 巡目）: 記録フローの ③ メディア選択。

オーナー指定は「上部に «自分で撮影して追加»、その下にライブラリ、スキップは小さく」。
そして **いきなり OS のピッカーが立ち上がらない**こと — 何を選ばされているのか分からないため。

守るのは 3 つ。
1. `mediaPickerMode="manual"` ではマウント時に `selectMedia` を呼ばない
2. その状態でも «写真なし» として始まり、画面の中のボタンから選べる
3. スキップは押せる（説明文ではない）
*/
describe("#1375 ReviewForm のメディア選択モード", () => {
	let tree: TestRenderer.ReactTestRenderer;

	const mount = (props: { mediaPickerMode?: "auto" | "manual"; allowNoMedia?: boolean }) => {
		act(() => {
			tree = TestRenderer.create(<ReviewForm restaurant={restaurant} onCancel={jest.fn()} {...props} />);
		});
	};

	/**
	 * #1375（6 巡目）記録フローの 1 歩目（料理カテゴリー）を済ませる。
	 * manual では、これを通すまで写真の選択肢は出ない（それ自体を下の 1 本目が固定している）。
	 */
	const chooseDishCategory = () => {
		const step = tree.root
			.findAll((candidate) => candidate.props?.testID === "review-dish-category-step-host")
			.find((candidate) => typeof candidate.props.onPress === "function");
		if (!step) throw new Error("料理カテゴリーの 1 歩目が出ていません");
		act(() => step.props.onPress({ dishCategoryId: "cat-1", label: "ラーメン" }));
	};

	const pressableWithTestID = (testID: string) => {
		const node = tree.root
			.findAll((candidate) => candidate.props?.testID === testID)
			.find((candidate) => typeof candidate.props.onPress === "function");
		if (!node) throw new Error(`${testID} の onPress が見つかりません`);
		return node;
	};

	afterEach(() => {
		act(() => tree?.unmount());
	});

	it("既定（auto）は従来どおりマウント時にピッカーを開く", () => {
		mount({});
		expect(selectMedia).toHaveBeenCalledTimes(1);
	});

	/**
	 * #1375（6 巡目・オーナー指示）**写真より先に料理カテゴリーを選ばせる。**
	 * 先に料理が決まっていれば «その料理の、この店の写真» を出せる。
	 */
	it("manual は料理カテゴリーから始まり、決まるまで写真の選択肢を出さない", () => {
		mount({ mediaPickerMode: "manual", allowNoMedia: true });
		expect(selectMedia).not.toHaveBeenCalled();
		expect(tree.root.findAll((n) => n.props?.testID === "review-dish-category-step-host").length).toBeGreaterThan(0);
		// この時点では写真の入口もコメント欄も出ていない
		expect(tree.root.findAllByProps({ testID: "review-add-photo-placeholder" })).toHaveLength(0);
		expect(tree.root.findAllByProps({ testID: "review-comment-input" })).toHaveLength(0);
	});

	/*
	#1375（オーナー指示 7 巡目）**写真の選択も «1 歩» にする。**

	以前はここで «写真の入口» と «コメント・料理・価格・星» が同時に出ていた。
	最初に目に入るものが多すぎて何をすればよいか読み取れない、という指摘への対処。
	お店 → 料理カテゴリー → **写真** → 入力、の順に 1 歩ずつ出す。
	*/
	it("料理カテゴリーが決まると «写真を選ぶ» だけが出る（入力欄はまだ出さない）", () => {
		mount({ mediaPickerMode: "manual", allowNoMedia: true });
		chooseDishCategory();
		expect(selectMedia).not.toHaveBeenCalled();
		expect(tree.root.findAllByProps({ testID: "review-add-photo-placeholder" }).length).toBeGreaterThan(0);
		expect(tree.root.findAllByProps({ testID: "review-comment-input" })).toHaveLength(0);
	});

	it("写真を «選ばない» と決めると、そこで初めて入力欄が出る", () => {
		mount({ mediaPickerMode: "manual", allowNoMedia: true });
		chooseDishCategory();
		act(() => pressableWithTestID("review-skip-photo").props.onPress());
		expect(tree.root.findAllByProps({ testID: "review-comment-input" }).length).toBeGreaterThan(0);
		// 決めたあとは «既存から選ぶ» の一覧とスキップは畳む（入力の邪魔にしない）
		expect(tree.root.findAllByProps({ testID: "review-skip-photo" })).toHaveLength(0);
	});

	// ⚠️ 押した時点でプレースホルダは «読み込み中» へ変わって消えるので、
	// 2 つのボタンを 1 回のマウントで続けて押せない。別々に立てて確かめる
	it("«自分で撮影して追加» はカメラ（画像のみ）で開く", () => {
		mount({ mediaPickerMode: "manual", allowNoMedia: true });
		chooseDishCategory();
		act(() => pressableWithTestID("review-shoot-with-camera").props.onPress());
		expect(selectMedia).toHaveBeenCalledTimes(1);
		expect((selectMedia as jest.Mock).mock.calls[0][0]).toEqual(["images"]);
	});

	it("«ライブラリから選ぶ» は画像と動画の両方で開く", () => {
		mount({ mediaPickerMode: "manual", allowNoMedia: true });
		chooseDishCategory();
		act(() => pressableWithTestID("review-pick-from-library").props.onPress());
		expect(selectMedia).toHaveBeenCalledTimes(1);
		expect((selectMedia as jest.Mock).mock.calls[0][0]).toEqual(["images", "videos"]);
	});

	it("スキップは押せる。押してもピッカーは開かず、写真なしのまま", () => {
		mount({ mediaPickerMode: "manual", allowNoMedia: true });
		chooseDishCategory();
		act(() => pressableWithTestID("review-skip-photo").props.onPress());
		expect(selectMedia).not.toHaveBeenCalled();
		expect(tree.root.findAllByProps({ testID: "review-comment-input" }).length).toBeGreaterThan(0);
	});

	it("allowNoMedia でない画面にはスキップを出さない（写真なしでは投稿できないため）", () => {
		mount({ mediaPickerMode: "manual" });
		chooseDishCategory();
		expect(tree.root.findAll((n) => n.props?.testID === "review-skip-photo")).toHaveLength(0);
	});

	/*
	#1629【33】オーナー実機報告「食べたを記録で画像を選ぶとめちゃくちゃ小さく表示される」。

	`InitialMediaPreview` は自分の寸法を 1 つも持たない（`height: "100%"` + `aspectRatio` +
	絶対配置の画像）。したがって **枠が確定した高さを持っていること**が表示条件そのものである。
	記録フロー（manual）だけ枠が `{ marginTop: 16 }` で高さ無しだったため、写真が潰れていた。

	スナップショットではなく **寸法を数値で表明する**（潰れているかどうかは «高さがあるか» でしか分からない）。
	*/
	const mediaSlotStyle = (): { height?: number; marginTop?: number } => {
		const slot = tree.root.findAll((n) => n.props?.testID === "review-media-slot");
		if (slot.length === 0) throw new Error("メディア枠（review-media-slot）が出ていません");
		return StyleSheet.flatten(slot[0].props.style) as { height?: number; marginTop?: number };
	};

	/** ReviewForm と同じ式（画面高 - フォーム - ボタン - 同意文 - バッファ） */
	const EXPECTED_MEDIA_HEIGHT = Dimensions.get("window").height - 370 - 60 - 36 - 120;

	it("記録フローで写真を選ぶと、プレビュー枠に確定した高さが入る", async () => {
		mount({ mediaPickerMode: "manual", allowNoMedia: true });
		chooseDishCategory();

		const resolveSelection = deferSelectMedia();
		act(() => pressableWithTestID("review-pick-from-library").props.onPress());
		await resolveSelection({ success: true, media: stubMedia });

		// 選んだ写真がプレビューまで届いている（届いていないと寸法の話にならない）
		expect(tree.root.findByProps({ testID: "initial-media-preview" }).props.children).toBe(stubMedia.uri);

		// 修正前はここが undefined（高さ無し）で、プレビューが数 px に潰れていた
		expect(mediaSlotStyle().height).toBe(EXPECTED_MEDIA_HEIGHT);
		expect(mediaSlotStyle().height).toBeGreaterThan(0);
	});

	it("写真なしプレースホルダーのときだけ枠の高さを外す（中身ぶんに伸ばすため）", () => {
		mount({ mediaPickerMode: "manual", allowNoMedia: true });
		chooseDishCategory();

		expect(tree.root.findAllByProps({ testID: "review-add-photo-placeholder" }).length).toBeGreaterThan(0);
		expect(mediaSlotStyle().height).toBeUndefined();
		expect(mediaSlotStyle().marginTop).toBe(16);
	});
});

/*
#1375 実機確認（5 巡目）「③ は… その下に既存のディッシュメディアから選べるように配置」。

写真を持っていない人でも «その料理の顔» がある記録にできるようにする。
選んだメディアは親から渡された `prefilledMedia` と同じ扱いになり、
料理カテゴリーはそのメディアの料理に固定される（`review-from-media` と同じ仕組み）。
*/
describe("#1375 既存メディアから選ぶ", () => {
	let tree: TestRenderer.ReactTestRenderer;

	afterEach(() => {
		act(() => tree?.unmount());
	});

	const mount = (props: Record<string, unknown>) => {
		act(() => {
			tree = TestRenderer.create(<ReviewForm restaurant={restaurant} onCancel={jest.fn()} {...props} />);
		});
	};

	it("manual のときだけ既存メディアの一覧を出す", () => {
		mount({ mediaPickerMode: "manual", allowNoMedia: true });
		const step = tree.root
			.findAll((n) => n.props?.testID === "review-dish-category-step-host")
			.find((n) => typeof n.props.onPress === "function");
		act(() => step!.props.onPress({ dishCategoryId: "cat-1", label: "ラーメン" }));
		// 合成要素とホスト要素の両方に当たるので «存在するか» で見る（このファイルの他のテストと同じ作法）
		expect(tree.root.findAll((n) => n.props?.testID === "review-existing-dish-media-host").length).toBeGreaterThan(0);
	});

	it("親から prefilledMedia が来ている画面には出さない（そのメディアの記録と決まっているため）", () => {
		mount({
			mediaPickerMode: "manual",
			allowNoMedia: true,
			prefilledMedia: {
				id: "dm-1",
				media_type: "image",
				mediaUrl: "https://example.com/m.jpg",
				thumbnailImageUrl: "https://example.com/t.jpg",
				dish: { id: "dish-1", name: "唐揚げ", category_id: "cat-1" },
			},
		});
		expect(tree.root.findAll((n) => n.props?.testID === "review-existing-dish-media-host")).toHaveLength(0);
	});

	it("既定（auto）では出さない（ピッカーが開く画面なので）", () => {
		mount({});
		expect(tree.root.findAll((n) => n.props?.testID === "review-existing-dish-media-host")).toHaveLength(0);
	});
});

/*
#1629 【回帰】取り込んだ Instagram の投稿から «レビュー» を押すと、
「メディアを読み込み中…」から永久に進まなかった。

`render_type='external_embed'` の行は `mediaUrl` が **常に null** で、#511 の
早期 return（「加工中だから後で値が来る」前提）に吸い込まれて `loading` のまま
放置されていた。外部埋め込みではその «後で» が永久に来ない。

⚠️ この 2 本が赤くなったら、また «スピナーが回り続けて記録できない» に戻っている。
*/
describe("#1629 取り込んだ SNS 投稿からレビューを書く", () => {
	// ⚠️ 上の describe の `tree` はそちらのスコープに閉じているので、ここは自前で持つ
	let embedTree: TestRenderer.ReactTestRenderer;

	afterEach(() => {
		embedTree?.unmount();
	});

	/** プレビューに実際に出ている URI（上の describe と同じ testID を見る） */
	const previewUriOf = () => embedTree.root.findByProps({ testID: "initial-media-preview" }).props.children;

	it("サムネイルがあれば、それをプレビューにして先へ進める（loading で止まらない）", async () => {
		const thumbnail = "https://scontent.example.test/ig-thumb.jpg";
		await act(async () => {
			embedTree = TestRenderer.create(
				<ReviewForm restaurant={restaurant} onCancel={noop} prefilledMedia={makeExternalEmbedMedia(thumbnail)} />,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		expect(findTextNodes(embedTree.root, "Map.media.loadingMedia")).toHaveLength(0);
		expect(previewUriOf()).toBe(thumbnail);
	});

	it("サムネイルすら無い provider でも «写真なし» として画面が使える（loading で止まらない）", async () => {
		await act(async () => {
			embedTree = TestRenderer.create(
				<ReviewForm restaurant={restaurant} onCancel={noop} prefilledMedia={makeExternalEmbedMedia(null)} />,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		expect(findTextNodes(embedTree.root, "Map.media.loadingMedia")).toHaveLength(0);
	});
});

/*
#1629【オーナー実機報告】「食べたを押すと、料理カテゴリにラーメンが表示されなくてレビューが書けない」。

dev の実ログ（2026-08-30 10:14 / 麦と麺助）で確定した筋道:

  1. SNS から取り込んだ投稿は `dishes.name` が空のことがある（キャプションから拾えなかった）
  2. `review-from-media` はその投稿を `prefilledMedia` として渡す
  3. 表示名の初期値が `prefilledMedia.dish.name` の直読みだったので **料理カテゴリー欄が空欄**
  4. 投稿の可否条件が «表示名が空でないこと» を含んでいたので **ボタンが押せない**
  5. その行は写真が決まっていると押せない ＝ **自分で埋める手段が無い**（行き止まり）

実ログのその投稿は `categoryLabels` に日本語を持っていた（Q234646 = ラーメン）ので、
表示名の規則（`labels[言語] → labels["en"] → name`）どおり解決すれば «ラーメン» が出る。
*/
describe("#1629 取り込んだ投稿から «食べた» を記録するとき", () => {
	/** `dishes.name` が空で、カテゴリの多言語表記だけを持つ投稿（実ログと同じ形） */
	const makeImportedMedia = () =>
		({
			id: "dish-media-imported",
			media_type: "image",
			render_type: "external_embed",
			mediaUrl: null,
			thumbnailImageUrl: "https://cdn.example.test/thumb.jpg",
			dish: {
				name: "",
				category_id: "Q234646",
				categoryLabels: { ja: "ラーメン", en: "Ramen" },
			},
		}) as never;

	// ★ ここが本命。空欄のまま «レビューが書けない» を二度と作らない
	it("店での呼び名が空でも、料理カテゴリーに «ラーメン» が出る", async () => {
		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(
				<ReviewForm restaurant={restaurant} onCancel={noop} prefilledMedia={makeImportedMedia()} />,
			);
		});
		await act(async () => {
			await Promise.resolve();
		});

		expect(findTextNodes(tree.root, "ラーメン").length).toBeGreaterThan(0);
	});
});

/*
#1629【オーナー指示】投稿ボタンが押せない理由を画面に出す。

無効なボタンが灰色で置いてあるだけだと «何が足りないのか» が読めない。
足りないものを名指しし、**埋まったら消える**ことを固定する。
*/
describe("#1629 投稿できないときは «何が足りないか» を出す", () => {
	/*
	⚠️ 写真が決まっていない状態（既定の auto）では、このファイルのモックだと
	   メディア選択が失敗してエラーカードへ倒れ、フォーム本体が描かれない。
	   «足りないもの» の 1 行はフォーム本体の下に出るので、写真が決まっている形で見る。
	*/
	const makeMedia = () =>
		({
			id: "dish-media-hint",
			media_type: "image",
			render_type: "external_embed",
			mediaUrl: null,
			thumbnailImageUrl: "https://cdn.example.test/thumb.jpg",
			dish: { name: "", category_id: "Q234646", categoryLabels: { ja: "ラーメン" } },
		}) as never;

	/** そのまま投稿できる状態まで埋める（写真は prefilledMedia で決まっている） */
	const fillAll = async (tree: TestRenderer.ReactTestRenderer) => {
		await act(async () => {
			tree.root.find((n) => n.props?.testID === "review-comment-input").props.onChangeText("うまかった");
		});
		await act(async () => {
			tree.root.findAll((n) => n.props?.testID === "review-price-input")[0].props.onChangeText("800");
		});
		await act(async () => {
			tree.root.find((n) => n.props?.testID === "review-star-5").props.onPress();
		});
	};

	it("足りないあいだは出て、埋まったら消える", async () => {
		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<ReviewForm restaurant={restaurant} onCancel={noop} prefilledMedia={makeMedia()} />);
		});
		await act(async () => {
			await Promise.resolve();
		});

		// ⚠️ このファイルは `PrimaryButton` を null にモックしているので、**ボタン本体は数えられない**。
		//    見るのはボタンの上に出る «足りないもの» の 1 行だけにする。
		//    また `i18n.t` のモックは補間値を返さないので、**行の有無**で判定する
		const hintCount = () =>
			tree.root.findAll((node) => node.props?.testID === "review-submit-hint", { deep: true }).length;

		expect(hintCount()).toBeGreaterThan(0);

		await fillAll(tree);

		expect(hintCount()).toBe(0);
	});
});
