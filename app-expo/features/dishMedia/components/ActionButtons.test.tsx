// #1501 【監査 DAT-01】いいね/保存の楽観更新が API 失敗時にロールバックされることを固定するテスト。
//
// `handleLike` / `handleSave` は、1) ストアを楽観更新 → 2) API を叩く → 3) 失敗しても catch で
// ログを出すだけ、という形になっていた。API が失敗すると、表示（isLiked / likeCount / isSaved /
// liked・saved タブの一覧）がサーバーと食い違ったまま残る。
//
// このテストは、失敗時にこの 4 つが「操作前の値」へ戻ることを固定する。
// ⚠️ 「操作前の値」であって「トグルの反転」ではない点に注意。反転で戻す実装は、他端末/別画面から
// 割り込みで更新されていた場合に誤った値を書き戻す（このテストでは #1205 の連打ガードと組み合わせて
// 状態が壊れないことも見るが、割り込み更新そのものまでは再現していない）。
//
// #1205 の多重実行ガード（inFlightActionsRef）は連打ガードであってロールバックではないため、
// 壊さないこと。連打しても API が 1 回しか呼ばれず、ロールバック後の状態も壊れないことを確認する。

import { act } from "react";
import TestRenderer from "react-test-renderer";

// lucide のアイコンは名前ごとに export されるため Proxy で一括スタブ化する（ReviewForm.test.tsx と同じ）
/*
#1629 «…» メニュー（DishMediaMoreMenu）は `useDialog` など独自の依存を持つ。
このファイルの関心はレールの いいね / 保存 / 食べた なので、メニューは差し替える。
メニュー自身の挙動は DishMediaMoreMenu.test.tsx が見る。
*/
jest.mock("@/features/dishMedia/components/DishMediaMoreMenu", () => ({
	DishMediaMoreMenu: function MockDishMediaMoreMenu() {
		return null;
	},
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

// react-native-gesture-handler は transformIgnorePatterns の許可リストに無く、素で import すると
// Flow 構文で parse に失敗する。ここで見たいのは押下時の楽観更新/ロールバックだけなので、
// GestureDetector は children をそのまま返す軽い stub で足りる（SheetGestureRoot.test.tsx と同じ考え方）
jest.mock("react-native-gesture-handler", () => ({
	GestureDetector: ({ children }: { children: unknown }) => children,
}));

const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: jest.fn() }) }));
jest.mock("@/hooks/useHaptics", () => ({ useHaptics: () => ({ lightImpact: jest.fn() }) }));

// #1402/#1398 このブランチの ActionButtons は「食べたを記録」導線のためログイン状態を見る
// （useAuth → lib/supabase を芋づるで読み込み、実 env が無い jest では落ちる）。
// このテストが見たいのは楽観更新のロールバックだけなので、認証まわりは軽い stub にする
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ user: { id: "user-1", is_anonymous: false } }) }));
jest.mock("@/hooks/useLocale", () => ({ useLocale: () => ({ locale: "ja-JP", isJapanese: true }) }));
jest.mock("expo-router", () => {
	const stub = {
		push: () => {},
		navigate: () => {},
		replace: () => {},
		back: () => {},
		canGoBack: () => true,
		canDismiss: () => false,
		dismissAll: () => {},
	};
	return { router: stub, useRouter: () => stub };
});
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));

const mockShowSnackbar = jest.fn();
jest.mock("@/contexts/SnackbarProvider", () => ({ useSnackbar: () => ({ showSnackbar: mockShowSnackbar }) }));

// openInGoogleMaps / shareRestaurant はこのテストの対象外。#613 のフックが内部で
// expo-router 経由の useLocale や googlePlaces 等へ芋づるで依存するため、まるごとスタブへ差し替える
jest.mock("../hooks/useDishMediaActions", () => ({
	useDishMediaActions: () => ({ openInGoogleMaps: jest.fn(), shareRestaurant: jest.fn() }),
}));

// liked / saved タブの本体（GridList 等）はこのテストに不要。#460 のキー文字列だけ要る
jest.mock("@/features/profile/tabs/LikeTab", () => ({ profileLikesEntriesKey: "profileLikes" }));
jest.mock("@/features/profile/entriesKeys", () => ({ profileSavedPostsEntriesKey: "profileSavedPosts" }));

// #1375（5 巡目）保存トグルで my-dishes のキャッシュを捨てること（= 一覧から即座に消えること）を固定する
const mockBumpMyDishesRevision = jest.fn();
jest.mock("@/features/myDishes/stores/useMyDishesRevisionStore", () => ({
	bumpMyDishesRevision: () => mockBumpMyDishesRevision(),
}));

import { ActionButtons } from "./ActionButtons";
import { useDishMediaEntriesStore, type NormalizedDishMediaEntry } from "@/stores/useDishMediaEntriesStore";

// React 19 では初期描画がスケジューラのタスクへ回されるため act() で包む必要がある
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const DISH_MEDIA_ID = "dm-1";
const LIKES_KEY = "profileLikes";
const SAVED_KEY = "profileSavedPosts";

function buildEntry(overrides: { isLiked?: boolean; isSaved?: boolean; likeCount?: number }): NormalizedDishMediaEntry {
	return {
		dish_media: {
			id: DISH_MEDIA_ID,
			isLiked: overrides.isLiked ?? false,
			isSaved: overrides.isSaved ?? false,
			likeCount: overrides.likeCount ?? 3,
		},
		restaurant: { id: "restaurant-1", name: "テスト店" },
		dishReviewIds: [],
	} as unknown as NormalizedDishMediaEntry;
}

/** ストアへ 1 件だけエントリを積む。liked/saved 一覧は「他の投稿」を 1 件だけ入れて初期化する */
function seedStore(overrides: { isLiked?: boolean; isSaved?: boolean; likeCount?: number }) {
	useDishMediaEntriesStore.setState({
		entriesByMediaId: { [DISH_MEDIA_ID]: buildEntry(overrides) },
		mediaIdsByKey: {
			[LIKES_KEY]: ["other-media"],
			[SAVED_KEY]: ["other-media"],
		},
	});
}

let activeRenderer: TestRenderer.ReactTestRenderer | undefined;

function renderActionButtons() {
	let renderer!: TestRenderer.ReactTestRenderer;
	act(() => {
		renderer = TestRenderer.create(
			<ActionButtons id={DISH_MEDIA_ID} idType="dish_media" onLayout={() => {}} buttonsGesture={{} as never} />,
		);
	});
	activeRenderer = renderer;
	return renderer;
}

/** testID に一致する要素のうち、実際に onPress を持つもの（TouchableOpacity 本体）を返す */
function findPressable(renderer: TestRenderer.ReactTestRenderer, testID: string) {
	const matches = renderer.root.findAllByProps({ testID });
	const pressable = matches.find((instance) => typeof instance.props.onPress === "function");
	if (!pressable) throw new Error(`No pressable found for testID=${testID}`);
	return pressable;
}

function getEntry() {
	const entry = useDishMediaEntriesStore.getState().entriesByMediaId[DISH_MEDIA_ID];
	if (!entry) throw new Error("entry missing from store");
	return entry;
}

/** callBackend の解決タイミングを外から握るための門（useDishMediaActions.doubleTap.test.tsx と同じ手法） */
function createGate() {
	let release!: () => void;
	const wait = new Promise<void>((resolve) => {
		release = resolve;
	});
	return { wait, release };
}

describe("#1501 いいね/保存の楽観更新ロールバック", () => {
	beforeEach(() => {
		mockCallBackend.mockReset();
		mockShowSnackbar.mockReset();
		useDishMediaEntriesStore.setState({ entriesByMediaId: {}, mediaIdsByKey: {} });
	});

	afterEach(() => {
		// 前のテストの renderer を購読させたまま次のテストで setState すると
		// act() 外での更新警告が出るため、都度アンマウントする
		act(() => activeRenderer?.unmount());
		activeRenderer = undefined;
	});

	it("いいね失敗時、isLiked・likeCount・liked一覧が操作前の値へ戻る", async () => {
		seedStore({ isLiked: false, likeCount: 3 });
		mockCallBackend.mockRejectedValueOnce(new Error("boom"));

		const renderer = renderActionButtons();
		const likeButton = findPressable(renderer, "dish-action-like");

		await act(async () => {
			await likeButton.props.onPress();
		});

		expect(getEntry().dish_media.isLiked).toBe(false);
		expect(getEntry().dish_media.likeCount).toBe(3);
		expect(useDishMediaEntriesStore.getState().mediaIdsByKey[LIKES_KEY]).toEqual(["other-media"]);
		// #1501 失敗を伝え、再試行できること
		expect(mockShowSnackbar).toHaveBeenCalledTimes(1);
		const [, options] = mockShowSnackbar.mock.calls[0];
		expect(typeof options?.action?.onPress).toBe("function");
	});

	it("いいね解除（isLiked: true → false 操作）の失敗時、isLiked=true・元のlikeCount・元の一覧順へ戻る", async () => {
		seedStore({ isLiked: true, likeCount: 5 });
		// liked タブの先頭に自分の投稿が乗っている状態を再現
		useDishMediaEntriesStore.setState((state) => ({
			mediaIdsByKey: { ...state.mediaIdsByKey, [LIKES_KEY]: [DISH_MEDIA_ID, "other-media"] },
		}));
		mockCallBackend.mockRejectedValueOnce(new Error("boom"));

		const renderer = renderActionButtons();
		const likeButton = findPressable(renderer, "dish-action-like");

		await act(async () => {
			await likeButton.props.onPress();
		});

		// トグルの反転（!willLike）ではなく、操作前の値そのものへ戻っていること
		expect(getEntry().dish_media.isLiked).toBe(true);
		expect(getEntry().dish_media.likeCount).toBe(5);
		expect(useDishMediaEntriesStore.getState().mediaIdsByKey[LIKES_KEY]).toEqual([DISH_MEDIA_ID, "other-media"]);
	});

	it("保存失敗時、isSaved・saved一覧が操作前の値へ戻る", async () => {
		seedStore({ isSaved: false });
		mockCallBackend.mockRejectedValueOnce(new Error("boom"));

		const renderer = renderActionButtons();
		const saveButton = findPressable(renderer, "dish-action-save");

		await act(async () => {
			await saveButton.props.onPress();
		});

		expect(getEntry().dish_media.isSaved).toBe(false);
		expect(useDishMediaEntriesStore.getState().mediaIdsByKey[SAVED_KEY]).toEqual(["other-media"]);
		expect(mockShowSnackbar).toHaveBeenCalledTimes(1);
	});

	it("いいね成功時はロールバックされず、liked一覧の先頭に反映される", async () => {
		seedStore({ isLiked: false, likeCount: 3 });
		mockCallBackend.mockResolvedValueOnce(undefined);

		const renderer = renderActionButtons();
		const likeButton = findPressable(renderer, "dish-action-like");

		await act(async () => {
			await likeButton.props.onPress();
		});

		expect(getEntry().dish_media.isLiked).toBe(true);
		expect(getEntry().dish_media.likeCount).toBe(4);
		expect(useDishMediaEntriesStore.getState().mediaIdsByKey[LIKES_KEY]).toEqual([DISH_MEDIA_ID, "other-media"]);
		expect(mockShowSnackbar).not.toHaveBeenCalled();
	});

	it("連打（#1205 のガード）と併用しても、API は1回しか呼ばれず失敗後の状態が壊れない", async () => {
		seedStore({ isLiked: false, likeCount: 3 });
		const gate = createGate();
		mockCallBackend.mockImplementation(async () => {
			await gate.wait;
			throw new Error("boom");
		});

		const renderer = renderActionButtons();
		const likeButton = findPressable(renderer, "dish-action-like");

		await act(async () => {
			// await せずに 2 回続けて呼ぶ = 同一 JS タスク内の連打。2 発目は #1205 のガードで無視されるはず
			const first = likeButton.props.onPress();
			const second = likeButton.props.onPress();
			gate.release();
			await Promise.all([first, second]);
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(getEntry().dish_media.isLiked).toBe(false);
		expect(getEntry().dish_media.likeCount).toBe(3);
		expect(useDishMediaEntriesStore.getState().mediaIdsByKey[LIKES_KEY]).toEqual(["other-media"]);

		// ガードが解除された後、再試行できること（壊れて二度と押せなくなっていないこと）
		mockCallBackend.mockResolvedValueOnce(undefined);
		await act(async () => {
			await likeButton.props.onPress();
		});
		expect(getEntry().dish_media.isLiked).toBe(true);
		expect(getEntry().dish_media.likeCount).toBe(4);
	});

	it("保存の解除が成功したら my-dishes のキャッシュを捨てる（一覧から即座に消える）", async () => {
		seedStore({ isSaved: true });
		mockCallBackend.mockResolvedValueOnce(undefined);
		const renderer = renderActionButtons();

		await act(async () => {
			findPressable(renderer, "dish-action-save").props.onPress();
		});

		expect(mockBumpMyDishesRevision).toHaveBeenCalled();
	});

	it("保存の API が失敗したときはキャッシュを捨てない（ロールバック後の表示と食い違わせない）", async () => {
		seedStore({ isSaved: false });
		mockBumpMyDishesRevision.mockClear();
		mockCallBackend.mockRejectedValueOnce(new Error("boom"));
		const renderer = renderActionButtons();

		await act(async () => {
			findPressable(renderer, "dish-action-save").props.onPress();
		});

		expect(mockBumpMyDishesRevision).not.toHaveBeenCalled();
	});
});
