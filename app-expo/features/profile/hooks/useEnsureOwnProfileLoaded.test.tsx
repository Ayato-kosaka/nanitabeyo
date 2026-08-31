// #1120 【設計】useEnsureOwnProfileLoaded が返す「決着したか」の意味を固定するテスト。
//
// 呼び出し側（DishCategoryGroupVoteCompletionModal）は、この値が false の間はゲスト向け UI を
// 描かずに待つ。つまりここが「取得前から true」になると #1120 のちらつきが再発し、
// 逆に「取得後も false のまま」になると UI がローディングで固着する。両方向を赤で守る。
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

let mockUser: { id: string; is_anonymous?: boolean } | null = null;
jest.mock("@/contexts/AuthProvider", () => ({ useAuth: () => ({ user: mockUser }) }));

/** callBackend の解決タイミングをテストから握る */
let mockResolveProfile: (value: unknown) => void;
const mockCallBackend = jest.fn(
	() =>
		new Promise((resolve) => {
			mockResolveProfile = resolve;
		}),
);
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
// ⚠️ スタブは «毎レンダー同じ関数» を返すこと。ここで jest.fn() を呼び直すと
// ロード effect の依存（logFrontendEvent / createUserProfile）が毎レンダー変わり、
// effect が勝手に再実行される。実装は useCallback で安定しているので、それは本番には無い挙動であり、
// retry の依存（attempt）を外しても «たまたま緑» になってしまう（#1387 のミューテーションで実測）
jest.mock("@/hooks/useLogger", () => {
	const logFrontendEvent = jest.fn();
	return { useLogger: () => ({ logFrontendEvent }) };
});
const mockCreateUserProfile = jest.fn();
jest.mock("@/features/profile/hooks/useProfile", () => ({
	useProfile: () => ({ createUserProfile: mockCreateUserProfile }),
}));
jest.mock("expo-image", () => ({ Image: { prefetch: jest.fn(() => Promise.resolve(true)) } }));
jest.mock("@/data/profileData", () => ({ userProfile: { display_name: "guest" } }));

import { useEnsureOwnProfileLoaded } from "./useEnsureOwnProfileLoaded";
import { useProfileStore } from "../stores/useProfileStore";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** フックの戻り値を毎レンダー記録するだけのハーネス */
let latest: { isProfileResolved: boolean; hasLoadFailed: boolean; retry: () => void };
function Harness() {
	latest = useEnsureOwnProfileLoaded();
	return null;
}

beforeEach(() => {
	useProfileStore.getState().resetProfile();
	mockCallBackend.mockClear();
});

describe("useEnsureOwnProfileLoaded の isProfileResolved", () => {
	it("ログインユーザーでは、プロフィール取得が終わるまで false のまま", async () => {
		mockUser = { id: "user-1", is_anonymous: false };

		await act(async () => {
			TestRenderer.create(<Harness />);
		});

		// API のレスポンス待ち = まだ display_name が分からない
		expect(mockCallBackend).toHaveBeenCalled();
		expect(latest.isProfileResolved).toBe(false);

		await act(async () => {
			mockResolveProfile({ display_name: "ログイン太郎", avatarUrls: undefined });
		});

		expect(latest.isProfileResolved).toBe(true);
		expect(useProfileStore.getState().profile).toEqual({ display_name: "ログイン太郎", avatarUrls: undefined });
	});

	it("ゲストユーザーでは API を待たずに決着する", async () => {
		mockUser = { id: "guest-1", is_anonymous: true };

		await act(async () => {
			TestRenderer.create(<Harness />);
		});

		expect(mockCallBackend).not.toHaveBeenCalled();
		expect(latest.isProfileResolved).toBe(true);
	});

	it("プロフィール取得が失敗しても決着する（ローディングで固着させない）", async () => {
		mockUser = { id: "user-2", is_anonymous: false };
		mockCallBackend.mockImplementationOnce(() => Promise.reject({ status: 500, message: "boom" }) as never);

		await act(async () => {
			TestRenderer.create(<Harness />);
		});

		expect(latest.isProfileResolved).toBe(true);
		expect(useProfileStore.getState().profile).toBeNull();
	});
});

/*
#1387 【設計】`retry()` の契約。

このフックは `hasLoadedRef` で «一度きり» を保証しており、失敗しても finally でそれを立てる。
つまり再レンダーしただけでは二度と API を叩かない — 取得に失敗した人は、`retry()` が無いと
永久にプロフィールを取り戻せない。ここで固定するのは次の 3 点である。

1. `retry()` を呼ぶと **実際にもう一度 API を叩く**（封印が解ける）
2. 呼んだ直後は **未決着へ戻る**（呼び出し側がローディングを出せる）
3. 2 回目が成功すれば **プロフィールが入って決着する**（1 回落ちたら終わり、にならない）
*/
describe("#1387 useEnsureOwnProfileLoaded の retry", () => {
	it("失敗後に retry を呼ぶと、もう一度 API を叩いて今度は成功する", async () => {
		mockUser = { id: "user-3", is_anonymous: false };
		mockCallBackend.mockImplementationOnce(() => Promise.reject({ status: 500, message: "boom" }) as never);

		await act(async () => {
			TestRenderer.create(<Harness />);
		});

		// 1 回目: 決着したがプロフィールは無い（＝画面はエラー表示に入る状態）
		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		expect(latest.isProfileResolved).toBe(true);
		expect(useProfileStore.getState().profile).toBeNull();

		// 2 回目のレスポンスはテストから握る（既定の mockCallBackend が pending の Promise を返す）
		await act(async () => {
			latest.retry();
		});

		// ⚠️ ここが 1 のままなら «封印が解けていない»。retry が効いていないということ
		expect(mockCallBackend).toHaveBeenCalledTimes(2);
		expect(latest.isProfileResolved).toBe(false);

		await act(async () => {
			mockResolveProfile({ display_name: "再試行太郎", avatarUrls: undefined });
		});

		expect(latest.isProfileResolved).toBe(true);
		expect(useProfileStore.getState().profile).toEqual({ display_name: "再試行太郎", avatarUrls: undefined });
	});

	it("retry の後にまた失敗しても、決着はする（二重に固着させない）", async () => {
		mockUser = { id: "user-4", is_anonymous: false };
		mockCallBackend
			.mockImplementationOnce(() => Promise.reject({ status: 500, message: "boom" }) as never)
			.mockImplementationOnce(() => Promise.reject({ status: 503, message: "still down" }) as never);

		await act(async () => {
			TestRenderer.create(<Harness />);
		});
		await act(async () => {
			latest.retry();
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(2);
		expect(latest.isProfileResolved).toBe(true);
		expect(useProfileStore.getState().profile).toBeNull();
	});
});

/*
#1387 【設計】`hasLoadFailed` の契約（PR #1392 のレビュー B-1）。

呼び出し側が `isProfileResolved && !profile` から «失敗» を推論すると、共有ストアを第三者が
空にした瞬間に «失敗していないのに失敗» と読めてしまう。フックが実際の失敗だけを持つ。

⚠️ 下の「ストアを外から空にしても失敗にはならない」が赤くなったら、推論に戻っている。
*/
describe("#1387 hasLoadFailed は «実際に落ちたか» だけを持つ", () => {
	it("成功したら false のまま", async () => {
		mockUser = { id: "user-5", is_anonymous: false };

		await act(async () => {
			TestRenderer.create(<Harness />);
		});
		await act(async () => {
			mockResolveProfile({ display_name: "成功太郎", avatarUrls: undefined });
		});

		expect(latest.hasLoadFailed).toBe(false);
	});

	it("404 以外で落ちたら true", async () => {
		mockUser = { id: "user-6", is_anonymous: false };
		mockCallBackend.mockImplementationOnce(() => Promise.reject({ status: 500, message: "boom" }) as never);

		await act(async () => {
			TestRenderer.create(<Harness />);
		});

		expect(latest.hasLoadFailed).toBe(true);
	});

	it("ゲストは決着しても false", async () => {
		mockUser = { id: "guest-2", is_anonymous: true };

		await act(async () => {
			TestRenderer.create(<Harness />);
		});

		expect(latest.isProfileResolved).toBe(true);
		expect(latest.hasLoadFailed).toBe(false);
	});

	// ⚠️ これが «推論をやめた» ことの核心。AuthProvider のセッション切替や、別画面のフックの
	// mount がストアを空にする（どちらも実在する経路）
	it("ストアを外から空にしても失敗にはならない", async () => {
		mockUser = { id: "user-7", is_anonymous: false };

		await act(async () => {
			TestRenderer.create(<Harness />);
		});
		await act(async () => {
			mockResolveProfile({ display_name: "成功太郎", avatarUrls: undefined });
		});
		expect(latest.hasLoadFailed).toBe(false);

		await act(async () => {
			useProfileStore.getState().resetProfile();
		});

		// 決着済み × profile なし。推論していた頃はここで «失敗» になっていた
		expect(useProfileStore.getState().profile).toBeNull();
		expect(latest.isProfileResolved).toBe(true);
		expect(latest.hasLoadFailed).toBe(false);
	});

	/*
	404 分岐（プロフィール新規作成）の中で投げたとき。

	catch の «中» で throw すると、その reject は同じ try の catch には捕まらず外へ抜ける。
	finally は走るので isProfileResolved は true になるが、hasLoadFailed を立てているのは
	catch の中なので、拾わないと **決着済みなのに失敗していないことになる**。
	loadProfile().catch(...) がそこを受け止めている（PR #1392 のレビュー S-1 / N-2）。

	⚠️ ここが赤くなったら .catch が外れている。画面は «失敗したのにスピナー» へ戻る。
	*/
	it("404 → 新規作成が失敗しても hasLoadFailed が立つ", async () => {
		mockUser = { id: "user-9", is_anonymous: false };
		mockCallBackend.mockImplementationOnce(() => Promise.reject({ status: 404, message: "not found" }) as never);
		mockCreateUserProfile.mockImplementationOnce(() => Promise.reject(new Error("create failed")) as never);

		await act(async () => {
			TestRenderer.create(<Harness />);
		});

		expect(latest.isProfileResolved).toBe(true);
		expect(latest.hasLoadFailed).toBe(true);
		expect(useProfileStore.getState().profile).toBeNull();
	});

	it("404 → 新規作成は成功したが再取得が失敗しても hasLoadFailed が立つ", async () => {
		mockUser = { id: "user-10", is_anonymous: false };
		mockCallBackend
			.mockImplementationOnce(() => Promise.reject({ status: 404, message: "not found" }) as never)
			.mockImplementationOnce(() => Promise.reject({ status: 500, message: "boom" }) as never);
		mockCreateUserProfile.mockImplementationOnce(() => Promise.resolve() as never);

		await act(async () => {
			TestRenderer.create(<Harness />);
		});

		expect(latest.isProfileResolved).toBe(true);
		expect(latest.hasLoadFailed).toBe(true);
	});

	// ⚠️ セッションが変わったら前のセッションの失敗を引きずらないこと（レビュー N-2 の M5）。
	// 引きずると、別アカウントでログインし直した人が «前の人の失敗» のエラー画面から始まる
	it("セッションが変わると失敗フラグは下りる", async () => {
		mockUser = { id: "user-11", is_anonymous: false };
		mockCallBackend.mockImplementationOnce(() => Promise.reject({ status: 500, message: "boom" }) as never);

		let tree!: TestRenderer.ReactTestRenderer;
		await act(async () => {
			tree = TestRenderer.create(<Harness />);
		});
		expect(latest.hasLoadFailed).toBe(true);

		// 別ユーザーへ切り替える（セッション変更 effect が走る）
		mockUser = { id: "user-12", is_anonymous: false };
		await act(async () => {
			tree.update(<Harness />);
		});

		expect(latest.hasLoadFailed).toBe(false);
	});

	it("retry を呼ぶと失敗フラグは下りる", async () => {
		mockUser = { id: "user-8", is_anonymous: false };
		mockCallBackend.mockImplementationOnce(() => Promise.reject({ status: 500, message: "boom" }) as never);

		await act(async () => {
			TestRenderer.create(<Harness />);
		});
		expect(latest.hasLoadFailed).toBe(true);

		await act(async () => {
			latest.retry();
		});

		expect(latest.hasLoadFailed).toBe(false);
	});
});
