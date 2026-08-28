// #1513 削除導線が「投稿を削除」1 本であることを固定するテスト。
//
// 「投稿」＝ dish_media 1 件 ＋ そのメディアに紐づく自分の最古の dish_review 1 件（オーナー確定仕様）。
// つまり利用者から見て消せる単位は 1 つしかない。«写真を削除» と «レビューを削除» の 2 択を
// メニューへ戻すと、利用者は「写真だけ消したら記録は残るのか」を毎回判断させられ、
// しかもサーバー側（DELETE /v1/dish-media/:id が自分の最古レビューを巻き添えにする）には
// その区別が存在しないため、選んだ通りにならない。
//
// このテストが固定するのは 2 点。
//  1. メニューに削除の行が 1 つだけあること（レビュー単体を消す導線が生えていないこと）
//  2. 確認を通した削除が DELETE /v1/dish-media/:id の 1 回だけであること
//     （メディアとレビューを 2 回に分けて叩く実装へ戻っていないこと）

import { act } from "react";
import TestRenderer from "react-test-renderer";

// lucide のアイコンは名前ごとに export されるため Proxy で一括スタブ化する（ActionButtons.test.tsx と同じ）
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

jest.mock("@expo/vector-icons", () => ({
	FontAwesome: function MockFontAwesome() {
		return null;
	},
}));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

const mockConfirm = jest.fn();
jest.mock("@/contexts/DialogProvider", () => ({ useDialog: () => ({ confirm: mockConfirm }) }));

const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));

jest.mock("@/features/myDishes/stores/useMyDishesRevisionStore", () => ({ bumpMyDishesRevision: jest.fn() }));

import { DishMediaMoreMenu } from "./DishMediaMoreMenu";
import { useDishMediaEntriesStore, type NormalizedDishMediaEntry } from "@/stores/useDishMediaEntriesStore";

// React 19 では初期描画がスケジューラのタスクへ回されるため act() で包む必要がある
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DISH_MEDIA_ID = "dm-1";
const REVIEW_ID = "review-1";

const entry = {
	// #1629 編集・削除の行は `dish_media.isMine` で出し分ける。自分の投稿として作る
	dish_media: { id: DISH_MEDIA_ID, isMine: true },
	restaurant: { id: "restaurant-1", name: "テスト店" },
	dishReviewIds: [REVIEW_ID],
} as unknown as NormalizedDishMediaEntry;

/** 自分のレビュー 1 件をストアへ積む（= 編集導線も出る状態） */
function seedStore() {
	useDishMediaEntriesStore.setState({
		entriesByMediaId: { [DISH_MEDIA_ID]: entry },
		reviewsByReviewId: {
			[REVIEW_ID]: {
				id: REVIEW_ID,
				created_dish_media_id: DISH_MEDIA_ID,
				isMine: true,
				comment: "うまい",
				rating: 4,
				price_cents: null,
				currency_code: "JPY",
				lock_no: 1,
			},
		} as never,
	});
}

let activeRenderer: TestRenderer.ReactTestRenderer | undefined;

// #1629 シェア・報告はこのメニューへ畳まれたので、呼び出しの有無をここで見る
const mockOnShare = jest.fn();
const mockOnReport = jest.fn();

function renderDishMediaMoreMenu() {
	let renderer!: TestRenderer.ReactTestRenderer;
	act(() => {
		renderer = TestRenderer.create(<DishMediaMoreMenu entry={entry} onShare={mockOnShare} onReport={mockOnReport} />);
	});
	activeRenderer = renderer;
	return renderer;
}

/** testID に一致する **ホスト要素**（type が文字列のもの）だけを返す。行数を数えるのに使う */
function findHosts(renderer: TestRenderer.ReactTestRenderer, testID: string) {
	return renderer.root.findAll((node) => node.props?.testID === testID && typeof node.type === "string", {
		deep: true,
	});
}

/** testID に一致する要素のうち、実際に onPress を持つもの（TouchableOpacity 本体）を返す */
function findPressable(renderer: TestRenderer.ReactTestRenderer, testID: string) {
	const pressable = renderer.root
		.findAllByProps({ testID })
		.find((instance) => typeof instance.props.onPress === "function");
	if (!pressable) throw new Error(`No pressable found for testID=${testID}`);
	return pressable;
}

describe("#1513 削除導線は「投稿を削除」1 本", () => {
	beforeEach(() => {
		mockCallBackend.mockReset();
		mockConfirm.mockReset();
		mockShowSnackbar.mockReset();
		useDishMediaEntriesStore.setState({ entriesByMediaId: {}, reviewsByReviewId: {}, mediaIdsByKey: {} });
		seedStore();
	});

	afterEach(() => {
		act(() => activeRenderer?.unmount());
		activeRenderer = undefined;
	});

	it("メニューの削除行は 1 つだけで、レビュー単体を消す導線が無い", () => {
		const renderer = renderDishMediaMoreMenu();
		act(() => {
			findPressable(renderer, "dish-action-more").props.onPress();
		});

		// 削除の行は 1 つ。testID は「TouchableOpacity（合成）→ View（ホスト）」の 2 段に伝播するので、
		// 数えるのはホスト要素だけに絞る（合成側まで数えると常に 2 になり、増減を検知できない）
		expect(findHosts(renderer, "own-post-delete-button")).toHaveLength(1);

		// 「写真だけ削除」「レビューだけ削除」の 2 択に戻っていないこと
		for (const testID of ["own-post-delete-media-button", "own-post-delete-review-button"]) {
			expect(renderer.root.findAllByProps({ testID })).toHaveLength(0);
		}
	});

	it("確認を承諾すると DELETE /v1/dish-media/:id を 1 回だけ叩く", async () => {
		mockConfirm.mockResolvedValueOnce(true);
		mockCallBackend.mockResolvedValueOnce({ deletedDishReviewIds: [REVIEW_ID] });

		const renderer = renderDishMediaMoreMenu();
		act(() => {
			findPressable(renderer, "dish-action-more").props.onPress();
		});
		await act(async () => {
			await findPressable(renderer, "own-post-delete-button").props.onPress();
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(mockCallBackend.mock.calls[0][0]).toBe(`v1/dish-media/${DISH_MEDIA_ID}`);
		expect(mockCallBackend.mock.calls[0][1]).toMatchObject({ method: "DELETE" });
		// 削除の範囲（写真とあなたのレビュー）を確認ダイアログで明示していること
		expect(mockConfirm).toHaveBeenCalledWith(
			expect.objectContaining({ message: "DishMediaContent.ownPost.deleteConfirmMessage" }),
		);
	});

	it("確認を断ると API を叩かない", async () => {
		mockConfirm.mockResolvedValueOnce(false);

		const renderer = renderDishMediaMoreMenu();
		act(() => {
			findPressable(renderer, "dish-action-more").props.onPress();
		});
		await act(async () => {
			await findPressable(renderer, "own-post-delete-button").props.onPress();
		});

		expect(mockCallBackend).not.toHaveBeenCalled();
	});
});

/*
#1629 【仕様】«…» は他人の投稿でも出る。中身が出し分けられるだけである。

⚠️ ここが赤くなったら «他人の投稿を通報できない» 状態に戻っている。
   通報導線が UI から消えると、«見つけられないから通報されない» を
   «問題が無い» と読み違えることになる（#1514 の設計判断）。
*/
describe("#1629 他人の投稿でもメニューは出る", () => {
	const othersEntry = {
		dish_media: { id: DISH_MEDIA_ID, isMine: false },
		restaurant: { id: "restaurant-1", name: "テスト店" },
		dishReviewIds: [],
	} as unknown as NormalizedDishMediaEntry;

	it("シェアと報告は出て、編集と削除は出ない", async () => {
		let renderer: TestRenderer.ReactTestRenderer | undefined;
		await act(async () => {
			renderer = TestRenderer.create(
				<DishMediaMoreMenu entry={othersEntry} onShare={mockOnShare} onReport={mockOnReport} />,
			);
		});
		activeRenderer = renderer;

		await act(async () => {
			renderer!.root.findByProps({ testID: "dish-action-more" }).props.onPress();
		});

		expect(findHosts(renderer!, "dish-action-share")).toHaveLength(1);
		expect(findHosts(renderer!, "dish-action-report")).toHaveLength(1);
		expect(findHosts(renderer!, "own-post-edit-button")).toHaveLength(0);
		expect(findHosts(renderer!, "own-post-delete-button")).toHaveLength(0);
	});

	it("報告を押すと、メニューを閉じて onReport を呼ぶ", async () => {
		let renderer: TestRenderer.ReactTestRenderer | undefined;
		await act(async () => {
			renderer = TestRenderer.create(
				<DishMediaMoreMenu entry={othersEntry} onShare={mockOnShare} onReport={mockOnReport} />,
			);
		});
		activeRenderer = renderer;

		await act(async () => {
			renderer!.root.findByProps({ testID: "dish-action-more" }).props.onPress();
		});
		await act(async () => {
			renderer!.root.findByProps({ testID: "dish-action-report" }).props.onPress();
		});

		expect(mockOnReport).toHaveBeenCalledTimes(1);
	});
});

/*
#1629 【仕様】自分の投稿には «報告» を出さない（オーナー指摘）。

自分の投稿を通報できても、消したいなら «投稿を削除» があるので意味が無く、
運営のキューに «本人が自分を通報した» 行だけが積む。主要な SNS も
自分の投稿には通報を出さない（出るのは編集・削除）。

⚠️ シェアは自分の投稿でも出す。自分の投稿を人へ渡すのは普通の操作である。
*/
describe("#1629 自分の投稿には報告を出さない", () => {
	it("自分の投稿: シェアと編集と削除は出るが、報告は出ない", async () => {
		seedStore();
		const renderer = renderDishMediaMoreMenu();
		await act(async () => {
			renderer.root.findByProps({ testID: "dish-action-more" }).props.onPress();
		});

		expect(findHosts(renderer, "dish-action-share")).toHaveLength(1);
		expect(findHosts(renderer, "own-post-delete-button")).toHaveLength(1);
		expect(findHosts(renderer, "dish-action-report")).toHaveLength(0);
	});
});
