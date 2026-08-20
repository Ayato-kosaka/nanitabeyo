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
import { Text } from "react-native";
import TestRenderer, { type ReactTestInstance } from "react-test-renderer";

import type { MediaData } from "@/lib/mediaSelection";

// ---- 観測対象（selectMedia の呼ばれ方と結果の反映）以外はすべてスタブ化する ----
// lucide のアイコンは名前ごとに export されるため Proxy で一括スタブ化する（searchScreenPreload.test.tsx と同じ）
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
jest.mock("@/hooks/useLogger", () => {
	const logFrontendEvent = jest.fn();
	return { useLogger: () => ({ logFrontendEvent }) };
});
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
const logFrontendEventMock = useLogger().logFrontendEvent as jest.MockedFunction<
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
		mediaUrl,
		thumbnailImageUrl: "https://cdn.example.test/thumb.jpg",
		dish: { name: "からあげ", category_id: "dish-category-1" },
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

		await resolveSelection({ success: false, error: "permission_denied" });
		expect(findTextNodes(tree.root, "Map.media.permissionDenied")).toHaveLength(1);

		// 再試行は同じ実行本体（ref 経由・同時実行ガード）を通る
		const retry = deferSelectMedia();
		act(() => findPressHandler(tree.root, "Common.retry")());
		expect(selectMediaMock).toHaveBeenCalledTimes(2);

		await retry({ success: true, media: stubMedia });
		expect(tree.root.findByProps({ testID: "initial-media-preview" }).props.children).toBe(stubMedia.uri);
	});

	it("選択が進行中のあいだは、再試行を押しても selectMedia を二重に起動しない", async () => {
		const resolveSelection = deferSelectMedia();
		mount();

		await resolveSelection({ success: false, error: "permission_denied" });

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

		await resolveSelection({ success: false, error: "permission_denied" });

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
		// 「写真なしでも記録できる」ことが画面に出ている（機能欠落に見せない。設計 §4-1）
		expect(findTextNodes(tree.root, "MyDishes.record.noPhotoHint")).toHaveLength(1);
		// フォームは開いたまま = 既存の入力欄がそのまま使える
		expect(tree.root.findAllByProps({ testID: "review-comment-input" }).length).toBeGreaterThan(0);
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
