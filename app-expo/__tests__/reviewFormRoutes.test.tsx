/*
#1386 【設計】レビュー投稿フォームから出ていく 3 つの導線が «ルートへ push すること» を固定する。

## なぜ必要か
BlurModal 時代、この 3 つはどれも `open()` という boolean の切り替えだった。
押した先は型でも E2E でも表現されておらず、`docs/decisions/20260819-blur-modal-teardown.md` の
「モーダルは表示状態が遷移と無関係」がそのまま出ていた箇所である。
ルート化すると行き先は文字列になり、**間違えても型検査を通る**（typed routes は pathname の
綴りは見るが、locale や doc の «取り違え» までは見ない）。#1368 の教訓と同じで、
ガイドラインを押したら著作権が開く、は誰にも気付かれずに入りうる。

| 導線 | 旧実装 | 新しい行き先 |
| --- | --- | --- |
| 料理カテゴリ選択 | `DishCategoryModal`（既定 z1100・親は z1200 で **逆転**） | `.../[restaurantId]/dish-category` |
| ガイドライン / 著作権 | `LegalDocumentModal`（#1368 から引き渡された 1 件） | `/[locale]/legal/[doc]` |
| フィードの「この料理にレビューを書く」 | `ReviewFormModal`（フィードもモーダルの中 = 3 段目） | `.../review-from-media/[dishMediaId]` |

## portal を持たないこと
`Portal.Host` は `<Stack>` を包んでいる（app/[locale]/_layout.tsx）ので、BlurModal を開いたまま
push すると遷移先は portal の下に潜って見えず触れない（#1364 で実測）。#1368 がこの 1 件を
移せなかったのはそれが理由で、逆に «先に閉じる» と入力中のレビューと `mediaState`（#1127）が
丸ごと消えた。つまりこのフォームで守るべき不変条件は **「オーバーレイを 1 つも持たない」** こと。
react-native-paper の `<Portal>` のスタブを «描かれたら記録する» 形にして、それを固定する
（`__tests__/legalEntryPoints.test.tsx` と同じ形）。#1350 P6 で `features/blurModal` は
撤去済みなので、観測点はモジュール名ではなく機構そのものに置いてある。

## 料理カテゴリの «戻り値»
選択画面はルートなので、結果はストア 1 件経由で戻る
（`features/map/stores/useDishCategorySelectionStore.ts`）。ここでは
「候補を選んだ → そのまま入る」「候補に無い名前 → 新規作成の POST が走る」の 2 分岐と、
**読んだら消える**（次に開いたときに前回の選択が蘇らない）ことまで見る。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockPush = jest.fn();

// ⚠️ スタブ本体をファクトリの «外» に置かないこと（loginEntryPoints.test.tsx と同じ注意）
jest.mock("expo-router", () => {
	const stub = {
		push: (href: unknown) => mockPush(href),
		replace: () => {},
		back: () => {},
		canGoBack: () => true,
	};
	return {
		router: stub,
		useRouter: () => stub,
		useLocalSearchParams: () => ({}),
		useGlobalSearchParams: () => ({}),
	};
});

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("lucide-react-native", () => new Proxy({}, { get: () => () => null }));
jest.mock("expo-image", () => ({
	Image: Object.assign(
		function MockExpoImage() {
			return null;
		},
		{ prefetch: () => Promise.resolve(true) },
	),
}));
jest.mock("react-native-gesture-handler", () => {
	const { ScrollView: RNScrollView } = jest.requireActual("react-native");
	return { ScrollView: RNScrollView };
});
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
	useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 800 }),
}));
jest.mock("@/features/map/components/InitialMediaPreview", () => ({ InitialMediaPreview: () => null }));
jest.mock("@/components/PrimaryButton", () => {
	const ReactActual = jest.requireActual("react");
	const { View: RNView } = jest.requireActual("react-native");
	// フィードの CTA を押せる形で残す（testID はそのまま通す）
	return {
		PrimaryButton: ({ testID, onPress }: { testID?: string; onPress?: () => void }) =>
			ReactActual.createElement(RNView, { testID, onPress }),
	};
});
jest.mock("@/components/LoadingIndicator", () => ({ LoadingIndicator: () => null }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useHaptics", () => {
	const lightImpact = jest.fn();
	const mediumImpact = jest.fn();
	return { useHaptics: () => ({ lightImpact, mediumImpact }) };
});
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: jest.fn() }) }));
jest.mock("@/hooks/useFileUploader", () => ({ useFileUploader: () => ({ uploadFile: jest.fn() }) }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
jest.mock("@/contexts/AuthProvider", () => ({
	useAuth: () => ({ user: { id: "user-1", is_anonymous: false }, isAuthResolved: true }),
}));
jest.mock("@/features/profile/hooks/useEnsureOwnProfileLoaded", () => ({ useEnsureOwnProfileLoaded: jest.fn() }));
jest.mock("@/features/profile/stores/useProfileStore", () => ({
	useProfileStore: (selector: (state: unknown) => unknown) => selector({ profile: null }),
}));
jest.mock("@/lib/googlePlaces", () => ({
	getCurrencyCodeFromRestaurant: () => "JPY",
	buildCurrencyChoices: () => ["JPY", "USD"],
	resolveCurrencySymbol: () => "¥",
	parseAmountString: (value: string) => Number(value),
	toMinorAmountInteger: (value: number) => value,
}));

// メディア選択は「loading のまま止まっている」状態にする。フォーム本体（カテゴリ行・同意文言）は
// その間も描かれるので、押した先の検証には十分（error 状態にすると本体が消えるので使わない）
jest.mock("@/lib/mediaSelection", () => ({ selectMedia: () => new Promise(() => {}) }));

/** 候補に無い名前を入れて戻ったときに走る新規作成 POST */
const mockCreateDishCategoryVariant = jest.fn(async (_name: string) => ({ id: "created-category-1" }));
jest.mock("@/hooks/useDishCategorySearch", () => ({
	useDishCategorySearch: () => ({ createDishCategoryVariant: mockCreateDishCategoryVariant }),
}));

/** フィード（FeedDishMediaViewer）が読む正規化ストア。1 件だけ入っている状態にする */
const DISH_MEDIA_ID = "dish-media-7";
jest.mock("@/stores/useDishMediaEntriesStore", () => ({
	selectIdsByKey: () => () => ({ ids: [DISH_MEDIA_ID], isLoading: false, hasFetchedInitial: true }),
	useDishMediaEntriesStore: {
		getState: () => ({
			entriesByMediaId: { [DISH_MEDIA_ID]: { dish_media: { id: DISH_MEDIA_ID }, dish: { name: "ラーメン" } } },
		}),
	},
}));
jest.mock("@/features/dishMedia/components/DishMediaFeed", () => ({ __esModule: true, default: () => null }));

/**
 * `<Portal>` のスタブ。
 *
 * ⚠️ 描かれたこと «自体» が検証対象。#1350 P6 で `features/blurModal` を撤去したので、
 * この検査は «消えたモジュール名» ではなく BlurModal が使っていた **機構そのもの**
 * （react-native-paper の `<Portal>`）を見る。
 *
 * ⚠️ ここが守るのは «**開いた** オーバーレイを持たないこと» だけである（#1389 のレビューで実測）。
 * `{visible && <Portal>…}` のように閉じたまま置かれた Portal は描かれないので記録されない。
 * «そもそも Portal を import しないこと» は静的検査
 * （`scripts/assert-legacy-blur-modal-boundary.mjs` の許可リスト）が受け持つ。2 つで 1 組。
 */
const mockPortal = jest.fn();
jest.mock("react-native-paper", () => ({
	// Portal 以外は本物のまま通す。テーマ（constants/PaperTheme.ts の MD3DarkTheme）など、
	// この画面が «今は» 使っていないだけの export を undefined にすると、将来 useThemeColor を
	// 1 つ足しただけで «Portal と無関係な» TypeError で落ちるため
	...jest.requireActual("react-native-paper"),
	// children を返すのは #1358 の先例（DishCategoryGroupVoteResultScreen.test.tsx）に揃えたもの。
	// null を返すと、将来 Portal の中身へアサーションを置いたときに «赤くならずに要素が消える» 側へ倒れる
	Portal: ({ children }: { children?: unknown }) => {
		mockPortal();
		return children ?? null;
	},
}));

import { ReviewForm } from "@/features/map/components/ReviewForm";
import { FeedDishMediaViewer } from "@/features/map/components/FeedDishMediaViewer";
import { useDishCategorySelectionStore } from "@/features/map/stores/useDishCategorySelectionStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const RESTAURANT_ID = "restaurant-42";
/** ReviewForm が要求する SupabaseRestaurants のうち、このテストで参照される最小限だけを持つダミー */
const restaurant = { id: RESTAURANT_ID, name: "テスト飯店" } as never;

const mountedTrees: TestRenderer.ReactTestRenderer[] = [];
const render = async (element: React.ReactElement) => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(element);
	});
	mountedTrees.push(tree);
	return tree;
};

afterEach(async () => {
	await act(async () => {
		mountedTrees.splice(0).forEach((tree) => tree.unmount());
	});
});

/** 指定 testID の要素を押す */
const press = async (tree: TestRenderer.ReactTestRenderer, testID: string): Promise<void> => {
	const target = tree.root.find((node) => node.props?.testID === testID);
	await act(async () => {
		await target.props.onPress();
	});
};

/** 指定 testID の要素が描かれているか */
const exists = (tree: TestRenderer.ReactTestRenderer, testID: string): boolean =>
	tree.root.findAll((node) => node.props?.testID === testID).length > 0;

beforeEach(() => {
	mockPush.mockClear();
	mockPortal.mockClear();
	mockCreateDishCategoryVariant.mockClear();
	useDishCategorySelectionStore.getState().clear();
});

describe("#1386 レビュー投稿フォームの料理カテゴリ選択", () => {
	it("カテゴリ行は dish-category ルートへ restaurantId 付きで push する", async () => {
		const tree = await render(<ReviewForm restaurant={restaurant} onCancel={jest.fn()} />);

		await press(tree, "review-dish-category-row");

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/restaurant/[restaurantId]/dish-category",
			params: { locale: "ja-JP", restaurantId: RESTAURANT_ID },
		});
	});

	// BlurModal 時代の `onMount`（開いた時点で選び直しになる）と同じ挙動を保つ。
	// ⚠️ ここを落とすと「選択済みの名前が残ったまま別のカテゴリを選ぶ画面へ行く」ことになり、
	// 何も選ばずに戻ったときに «古い名前 + 新しくは選んでいない» という食い違いが残る。
	//
	// 受け渡し箱の `clear()` は «ここでは観測できない» ので検査しない（#1388 のレビュー）。
	// consume effect が結果を受け取った瞬間に箱を空にするため、押下時点で常に null であり、
	// ReviewForm 側の `clear()` を落としても緑のままだった。常に真のアサーションは
	// 「守っているつもり」を作るだけなので置かない。理由は ReviewForm.tsx の宣言箇所に書いた
	it("開くと選択中のカテゴリを空へ戻す", async () => {
		const tree = await render(<ReviewForm restaurant={restaurant} onCancel={jest.fn()} />);
		await act(async () => {
			useDishCategorySelectionStore
				.getState()
				.setResult({ status: "selected", dishCategoryId: "category-9", label: "味噌ラーメン" });
		});
		expect(tree.root.findAll((node) => node.props?.children === "味噌ラーメン").length).toBeGreaterThan(0);

		await press(tree, "review-dish-category-row");

		expect(tree.root.findAll((node) => node.props?.children === "味噌ラーメン")).toHaveLength(0);
	});

	it("候補を選んで戻ると、その ID と表示名がフォームへ入る", async () => {
		const tree = await render(<ReviewForm restaurant={restaurant} onCancel={jest.fn()} />);

		await act(async () => {
			useDishCategorySelectionStore
				.getState()
				.setResult({ status: "selected", dishCategoryId: "category-9", label: "味噌ラーメン" });
		});

		// 選択済みの表示名が行に出る（＝ フォームの state へ入った）
		expect(tree.root.findAll((node) => node.props?.children === "味噌ラーメン").length).toBeGreaterThan(0);
		// 既存カテゴリなので新規作成は走らない
		expect(mockCreateDishCategoryVariant).not.toHaveBeenCalled();
		// 読んだら消えていること（同じ結果が二重に適用されない）
		expect(useDishCategorySelectionStore.getState().result).toBeNull();
	});

	it("候補に無い名前で戻ると、新規カテゴリとして作成する", async () => {
		// 観測するのは «POST が走ったか» なのでツリーは触らない（描画されていることは他のケースが見ている）
		await render(<ReviewForm restaurant={restaurant} onCancel={jest.fn()} />);

		await act(async () => {
			useDishCategorySelectionStore.getState().setResult({ status: "typed", name: "  謎の麺  " });
		});

		// BlurModal 時代の onUnmount と同じく trim して作る
		expect(mockCreateDishCategoryVariant).toHaveBeenCalledWith("謎の麺");
		expect(useDishCategorySelectionStore.getState().result).toBeNull();
	});
});

describe("#1386 レビュー投稿フォームの法務ドキュメント導線（#1368 からの引き渡し）", () => {
	// 2 本のリンクは同じハンドラを通るため、doc の取り違えは «リンクごと» に見ないと見つからない
	it.each([
		["review-consent-guidelines-link", "guidelines"],
		["review-consent-copyright-link", "copyright"],
	])("%s は doc=%s で push する", async (testID, doc) => {
		const tree = await render(<ReviewForm restaurant={restaurant} onCancel={jest.fn()} />);

		await press(tree, testID);

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/legal/[doc]",
			params: { locale: "ja-JP", doc },
		});
	});

	// #1368 でここだけ移せなかったモーダル本体。残っていたら赤くする
	it("legal-document-modal を描かない", async () => {
		const tree = await render(<ReviewForm restaurant={restaurant} onCancel={jest.fn()} />);

		expect(exists(tree, "legal-document-modal")).toBe(false);
	});
});

describe("#1386 フィードから既存メディアのレビュー投稿へ", () => {
	it("「この料理にレビューを書く」は review-from-media ルートへ push する", async () => {
		const tree = await render(
			<FeedDishMediaViewer initialIndex={0} entriesKey="mapReviews::restaurant-42" restaurantId={RESTAURANT_ID} />,
		);

		await press(tree, "restaurant-feed-write-review-button");

		expect(mockPush).toHaveBeenCalledTimes(1);
		expect(mockPush).toHaveBeenCalledWith({
			pathname: "/[locale]/restaurant/[restaurantId]/review-from-media/[dishMediaId]",
			params: { locale: "ja-JP", restaurantId: RESTAURANT_ID, dishMediaId: DISH_MEDIA_ID },
		});
	});
});

describe("#1386 投稿フローは portal を 1 つも持たない", () => {
	/*
	⚠️ これが赤くなったら «閉じてから push» が必要になったということ（ファイル冒頭のコメント参照）。
	そしてこのフォームでは «閉じてから push» が採れない（入力と mediaState が消える）。
	つまり赤くなった時点で、設計をどちらかへ倒し直す判断が必要になる。
	*/
	it("レビュー投稿フォームは Portal を 1 つも描かない", async () => {
		const tree = await render(<ReviewForm restaurant={restaurant} onCancel={jest.fn()} />);
		await press(tree, "review-dish-category-row");

		expect(mockPortal).not.toHaveBeenCalled();
	});

	it("フィードは Portal を 1 つも描かない", async () => {
		const tree = await render(
			<FeedDishMediaViewer initialIndex={0} entriesKey="mapReviews::restaurant-42" restaurantId={RESTAURANT_ID} />,
		);
		await press(tree, "restaurant-feed-write-review-button");

		expect(mockPortal).not.toHaveBeenCalled();
	});
});
