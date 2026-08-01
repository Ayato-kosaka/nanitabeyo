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
// 依存配列に onCancel を戻す / mountedRef の再武装を消すと、いずれも失敗する。
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
jest.mock("expo-image", () => ({
	Image: function MockExpoImage() {
		return null;
	},
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
jest.mock("@/features/map/components/DishCategorySearchForm", () => ({ DishCategorySearchForm: () => null }));
jest.mock("@/features/settings/components/LegalDocument", () => ({ LegalDocument: () => null }));
jest.mock("@/components/PrimaryButton", () => ({ PrimaryButton: () => null }));
jest.mock("@/features/blurModal/hooks/useBlurModal", () => ({
	useBlurModal: () => ({ BlurModal: () => null, open: jest.fn(), close: jest.fn() }),
}));
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

/** ParentHarness を親側の state 更新で再レンダーさせる */
let rerenderParent: () => void;

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
