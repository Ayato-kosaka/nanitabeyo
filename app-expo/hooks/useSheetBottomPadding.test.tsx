/*
#1742 **画面下端に貼り付くシートが、Android のナビゲーションバーへ潜らないことを固定する。**

オーナー実機報告（検索結果マップの ActionSheet の «キャンセル» がナビバーの下に潜る）で
分かったのは «シートが 1 つ壊れている» ではなく «同じ作りが 4 か所ある» という形の欠陥だった。
ここでは **hook の計算** と **各シートがその計算を実際に適用していること** の両方を固定する。

## 「inset を足した」の測り方

期待値を «デザイン上の余白 + inset» のベタ書きにしない。各シートの余白（SHEET_PADDING_BOTTOM）は
デザインの都合で自由に変えてよい値であり、そこを固定するとテストがデザインの邪魔をする。
代わりに **同じシートを inset 0 と inset あり の 2 回描いて、差が inset ぴったりであること**を見る。
これなら余白の値に依らず «inset ぶんが載っているか» だけを判定できる。

⚠️ jest.setup.js が safe area に inset 0 のモックを敷いているので、このファイルはそれを
   «外から変えられるモック» で上書きする（敷いたままだと «足していない» と «0 を足した» が
   区別できず、テストが素通りする）。
*/
import React, { act } from "react";
import TestRenderer, { type ReactTestRenderer } from "react-test-renderer";
import { Keyboard, Platform, StyleSheet, View } from "react-native";

/** 実機のジェスチャーバー相当。テストごとに書き換える（jest.mock の factory から見えるよう `mock` 接頭辞） */
let mockBottomInset = 0;

jest.mock("react-native-safe-area-context", () => ({
	...jest.requireActual("react-native-safe-area-context/jest/mock").default,
	useSafeAreaInsets: () => ({ top: 24, bottom: mockBottomInset, left: 0, right: 0 }),
}));

jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: jest.fn() }) }));
jest.mock("expo-router", () => ({ useRouter: () => ({ push: jest.fn() }) }));
jest.mock("@/contexts/DialogProvider", () => ({ useDialog: () => ({ confirm: jest.fn() }) }));
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));
jest.mock("@/features/myDishes/stores/useMyDishesRevisionStore", () => ({ bumpMyDishesRevision: jest.fn() }));
jest.mock("@/components/PrimaryButton", () => {
	const { Text } = require("react-native");
	return { PrimaryButton: ({ label }: { label: string }) => <Text>{label}</Text> };
});
// アイコンはフォント読み込みで非同期に setState する（act 警告の元）。見た目を測らないので落とす
jest.mock("@expo/vector-icons", () => new Proxy({}, { get: () => () => null }));

import { useSheetBottomPadding } from "./useSheetBottomPadding";
import { ReportContentSheet } from "@/features/dishMedia/components/ReportContentSheet";
import { EditDishReviewModal } from "@/features/dishMedia/components/EditDishReviewModal";
import { DishMediaMoreMenu } from "@/features/dishMedia/components/DishMediaMoreMenu";
import { MyDishOwnReviewSheet } from "@/features/myDishes/components/MyDishOwnReviewSheet";
import { useDishMediaEntriesStore, type NormalizedDishMediaEntry } from "@/stores/useDishMediaEntriesStore";

// React 19 では初期描画がスケジューラのタスクへ回されるため act() で包む必要がある
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const renderInAct = (element: React.ReactElement): ReactTestRenderer => {
	let renderer!: ReactTestRenderer;
	act(() => {
		renderer = TestRenderer.create(element);
	});
	return renderer;
};

/** testID のホスト要素の style を平坦化して paddingBottom を返す（style は配列で合成されている） */
const paddingBottomOf = (renderer: ReactTestRenderer, testID: string): number => {
	const node = renderer.root.find((n) => typeof n.type === "string" && n.props?.testID === testID);
	const flattened = StyleSheet.flatten(node.props.style) as { paddingBottom?: number };
	if (typeof flattened.paddingBottom !== "number") {
		throw new Error(`testID=${testID} に paddingBottom が無い`);
	}
	return flattened.paddingBottom;
};

/**
 * inset 0 と inset あり で同じものを描き、`paddingBottom` の差を返す。
 * `openSheet` は «描いただけでは中身が出ないシート» を開くためのもの（«…» メニュー）。
 */
function measureInsetContribution(
	testID: string,
	renderSheet: () => ReactTestRenderer,
	openSheet?: (renderer: ReactTestRenderer) => void,
): number {
	const measure = (inset: number) => {
		mockBottomInset = inset;
		const renderer = renderSheet();
		if (openSheet) act(() => openSheet(renderer));
		const padding = paddingBottomOf(renderer, testID);
		act(() => renderer.unmount());
		return padding;
	};

	const withoutInset = measure(0);
	const withInset = measure(INSET);
	return withInset - withoutInset;
}

/** ジェスチャーバー相当の下 inset。0 でない値であることに意味がある */
const INSET = 48;

afterEach(() => {
	mockBottomInset = 0;
});

describe("useSheetBottomPadding", () => {
	/** hook の戻り値を取り出すだけの器。`base` はレンダー中に変えない（フックの呼び方を分岐させない） */
	let observed: number | undefined;
	function Probe({ base }: { base?: number }) {
		observed = useSheetBottomPadding(base);
		return <View />;
	}

	const probePadding = (base?: number) => {
		observed = undefined;
		renderInAct(<Probe base={base} />);
		return observed;
	};

	it("デザイン上の余白へ safe area の下 inset を足す", () => {
		mockBottomInset = INSET;
		expect(probePadding(28)).toBe(28 + INSET);
	});

	it("引数を省いたときは inset だけを返す（ActionSheet のように器側の余白を持たない用途）", () => {
		mockBottomInset = INSET;
		expect(probePadding()).toBe(INSET);
	});

	it("inset が 0 の環境（web / ジェスチャーバーの無い端末）では水増ししない", () => {
		mockBottomInset = 0;
		expect(probePadding(28)).toBe(28);
	});

	/*
	キーボードが出ている間、避ける相手（ナビゲーションバー / ホームインジケータ）は
	キーボードの裏に隠れている。そこへ inset を足すと «最後の入力欄とキーボードの間の空白» になる。
	*/
	it("キーボードが出ている間は inset を足さない", () => {
		// `Keyboard.addListener` は実体を差し替えず、発火させるためのハンドルだけ捕まえる
		// （`DishCategoryGroupVoteInlineOverlay.test.tsx` と同じ手）
		const handlers: Record<string, () => void> = {};
		jest.spyOn(Keyboard, "addListener").mockImplementation(((event: string, handler: () => void) => {
			handlers[event] = handler;
			return { remove: jest.fn() };
		}) as unknown as typeof Keyboard.addListener);

		mockBottomInset = INSET;
		let observedPadding: number | undefined;
		function Probe() {
			observedPadding = useSheetBottomPadding(28);
			return <View />;
		}
		const renderer = renderInAct(<Probe />);
		expect(observedPadding).toBe(28 + INSET);

		// hook は iOS だけ will 系を使う。jest-expo の既定 Platform.OS に合わせて名前を引く
		const showEvent = Platform.OS === "ios" ? "keyboardWillShow" : "keyboardDidShow";
		const hideEvent = Platform.OS === "ios" ? "keyboardWillHide" : "keyboardDidHide";

		act(() => handlers[showEvent]());
		expect(observedPadding).toBe(28);

		act(() => handlers[hideEvent]());
		expect(observedPadding).toBe(28 + INSET);

		act(() => renderer.unmount());
	});
});

describe("#1742 下端に貼り付くシートは safe area を自分で足す", () => {
	const REVIEW = {
		id: "11111111-1111-4111-8111-111111111111",
		comment: "うまい",
		rating: 4,
		price_cents: 1200,
		currency_code: "JPY",
		lock_no: 1,
	};

	it("通報シート", () => {
		const contribution = measureInsetContribution("report-sheet", () =>
			renderInAct(
				<ReportContentSheet
					visible
					targetType="dish_media"
					targetId="358cb297-da34-52b8-9f0c-6a1f7b2c3d4e"
					targetLabel="お店"
					onClose={jest.fn()}
				/>,
			),
		);
		expect(contribution).toBe(INSET);
	});

	it("クチコミ編集フォーム", () => {
		const contribution = measureInsetContribution("edit-review-modal", () =>
			renderInAct(
				<EditDishReviewModal
					review={REVIEW as never}
					onClose={jest.fn()}
					onSaved={jest.fn()}
					logPayload={{} as never}
				/>,
			),
		);
		expect(contribution).toBe(INSET);
	});

	it("フィードの «…» メニュー", () => {
		const entry = {
			dish_media: { id: "dm-1", isMine: true },
			restaurant: { id: "r-1", name: "店" },
			dishReviewIds: [],
		} as unknown as NormalizedDishMediaEntry;
		useDishMediaEntriesStore.setState({
			entriesByMediaId: { "dm-1": entry },
			reviewsByReviewId: {},
			mediaIdsByKey: {},
		} as never);

		const contribution = measureInsetContribution(
			"own-post-menu",
			() => renderInAct(<DishMediaMoreMenu entry={entry} onShare={jest.fn()} onReport={jest.fn()} />),
			// メニューは «…» を押すまで Modal の中身が無いので、開いてから測る
			(renderer) => {
				const opener = renderer.root
					.findAllByProps({ testID: "dish-action-more" })
					.find((instance) => typeof instance.props.onPress === "function");
				if (!opener) throw new Error("«…» ボタンが見つからない");
				opener.props.onPress();
			},
		);
		expect(contribution).toBe(INSET);
	});

	it("自分の記録のクチコミシート（#1629 で直したものが hook 経由でも保たれている）", () => {
		const item = {
			dish_media: { id: "dm-1", media_type: "image", mediaUrl: null },
			restaurant: { id: "r-1", name: "店" },
			dish: { id: "d-1", name: "料理" },
			ownReview: REVIEW,
		} as never;
		const contribution = measureInsetContribution("my-dish-own-review-sheet", () =>
			renderInAct(<MyDishOwnReviewSheet item={item} onClose={jest.fn()} onOpenRestaurant={jest.fn()} />),
		);
		expect(contribution).toBe(INSET);
	});
});
