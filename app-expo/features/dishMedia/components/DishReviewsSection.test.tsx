// #1514 (SAF-01) レビューの通報導線で守りたい不変条件を固定するテスト。
//
// オーナー確定仕様のうち、レビュー行の側にしか現れないのは次の 3 点:
//
//   1. **自分のレビューには通報を出さない**（自分で自分を通報させない）
//   2. 他人のレビューには出す。押すと «そのレビューの ID» で通報シートが開く
//      （行をまたいで ID が混ざると、無関係なレビューが通報される）
//   3. シートへ渡す targetType は `dish_reviews`（投稿の通報として保存させない）
//
// e2e は migration 適用後にしか通らない（`content_reports` が dev に無い）ため、
// DB を要らないレンダラ上のテストとして先に置いておく。

import React, { act } from "react";
import TestRenderer, { type ReactTestRenderer } from "react-test-renderer";

// ---- 観測対象（通報導線の有無と、シートへ渡す値）以外はすべてスタブ化する ----
jest.mock("@/lib/i18n", () => ({
	__esModule: true,
	default: { t: (key: string) => key },
}));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: jest.fn() }) }));
jest.mock("@/lib/remoteConfig", () => ({
	getRemoteConfig: () => ({ v1_dish_comment_review_show_number: "100" }),
}));
jest.mock("@/components/Stars", () => ({ __esModule: true, default: () => null }));
jest.mock("expo-linear-gradient", () => {
	const { View } = require("react-native");
	return { LinearGradient: View };
});
jest.mock("react-native-gesture-handler", () => {
	const { ScrollView } = require("react-native");
	return { ScrollView };
});

/**
 * 通報シートは ReportContentSheet.test.tsx が別途固定しているので、
 * ここでは **どんな props で描かれたか** だけを観測できる代役に置き換える。
 */
// #1599 レビューいいねの失敗を Snackbar で伝えるようになったため、
// このテスト（通報導線だけを見る）でも Provider の代役が要る。
// ロールバック側の挙動は DishReviewsSectionLike.test.tsx が固定している。
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: jest.fn() }) }));

jest.mock("./ReportContentSheet", () => {
	const { View } = require("react-native");
	return {
		ReportContentSheet: (props: Record<string, unknown>) => <View testID="report-sheet-stub" {...props} />,
	};
});

/** useAuth() が返す user。各テストが差し替える */
let mockUser: { id: string } | null = null;
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ user: mockUser }) }));

/** ストアが返すレビュー。各テストが差し替える */
let mockReviews: unknown[] = [];
jest.mock("@/stores/useDishMediaEntriesStore", () => ({
	useDishMediaEntriesStore: () => mockReviews,
	selectReviewsByMediaId: () => () => mockReviews,
	selectReviewByReviewId: () => () => null,
}));

import { DishReviewsSection } from "./DishReviewsSection";

// React 19 では初期描画がスケジューラのタスクへ回されるため、act() で包む必要がある
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const ME = "11111111-1111-4111-8111-111111111111";
const SOMEONE_ELSE = "22222222-2222-4222-8222-222222222222";

const review = (overrides: Record<string, unknown> = {}) => ({
	id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
	user_id: SOMEONE_ELSE,
	username: "たべあるき太郎",
	comment: "とてもおいしかったです",
	rating: 5,
	created_at: "2026-08-20T12:00:00.000Z",
	isLiked: false,
	likeCount: 0,
	...overrides,
});

const render = () => {
	let renderer!: ReactTestRenderer;
	act(() => {
		renderer = TestRenderer.create(
			<DishReviewsSection id="dish-media-1" idType="dish_media" paddingRight={0} carouselRef={undefined} />,
		);
	});
	return renderer;
};

/**
 * testID で最初に見つかった node を返す（見つからなければ undefined）。
 *
 * ⚠️ 同じ testID には composite（TouchableOpacity など）と host（View）の
 * **両方**が当たるので、件数を数える用途には使えない。「在るか」は
 * 先頭が取れるかどうかで見ること。
 */
const findByTestID = (renderer: ReactTestRenderer, testID: string) =>
	renderer.root.findAll((node) => node.props?.testID === testID)[0];

/** そのレビューに通報ボタンが出ているか */
const hasReportButton = (renderer: ReactTestRenderer, reviewId: string) =>
	findByTestID(renderer, `review-action-report-${reviewId}`) !== undefined;

/** そのレビューの通報ボタンを押す */
const pressReport = async (renderer: ReactTestRenderer, reviewId: string) => {
	const node = findByTestID(renderer, `review-action-report-${reviewId}`);
	await act(async () => {
		node.props.onPress();
	});
};

/** 通報シート（スタブ）に渡っている props */
const sheetProps = (renderer: ReactTestRenderer) => findByTestID(renderer, "report-sheet-stub").props;

describe("DishReviewsSection の通報導線", () => {
	beforeEach(() => {
		mockUser = { id: ME };
		mockReviews = [];
	});

	it("自分のレビューには通報を出さない", () => {
		const own = review({ id: "own-review", user_id: ME });
		mockReviews = [own];

		const renderer = render();

		expect(hasReportButton(renderer, "own-review")).toBe(false);
	});

	it("他人のレビューには通報を出す", () => {
		const other = review({ id: "other-review", user_id: SOMEONE_ELSE });
		mockReviews = [other];

		const renderer = render();

		expect(hasReportButton(renderer, "other-review")).toBe(true);
	});

	it("自分のと他人のが混ざっていても、出るのは他人のぶんだけ", () => {
		mockReviews = [
			review({ id: "own-review", user_id: ME }),
			review({ id: "other-review", user_id: SOMEONE_ELSE }),
		];

		const renderer = render();

		expect(hasReportButton(renderer, "own-review")).toBe(false);
		expect(hasReportButton(renderer, "other-review")).toBe(true);
	});

	it("押すまではシートを開かない", () => {
		mockReviews = [review({ id: "other-review" })];

		const renderer = render();

		expect(sheetProps(renderer).visible).toBe(false);
	});

	it("押したレビューの ID と dish_reviews でシートを開く", async () => {
		mockReviews = [
			review({ id: "first-review", username: "一人目" }),
			review({ id: "second-review", username: "二人目" }),
		];

		const renderer = render();
		await pressReport(renderer, "second-review");

		const props = sheetProps(renderer);
		expect(props.visible).toBe(true);
		// 行をまたいで ID が混ざると、無関係なレビューが通報される
		expect(props.targetId).toBe("second-review");
		expect(props.targetLabel).toBe("二人目");
		// 投稿の通報として保存させない
		expect(props.targetType).toBe("dish_reviews");
	});

	it("閉じるとシートを畳む（次に開いたとき前の対象が残らない）", async () => {
		mockReviews = [review({ id: "other-review" })];

		const renderer = render();
		await pressReport(renderer, "other-review");
		await act(async () => {
			sheetProps(renderer).onClose();
		});

		expect(sheetProps(renderer).visible).toBe(false);
	});

	it("user が未確定（null）のあいだは通報を出す（出ない側へ倒さない）", () => {
		// 認証が確定する前に «自分のもの» へ倒すと、他人のレビューの通報導線が
		// 起動直後だけ消える。押しても API が弾くので、出す側の害の方が小さい
		mockUser = null;
		mockReviews = [review({ id: "other-review" })];

		const renderer = render();

		expect(hasReportButton(renderer, "other-review")).toBe(true);
	});
});
