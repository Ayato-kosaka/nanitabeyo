// #1205 【設計】友達投票の作成が「連打しても 1 回だけ」走ることを固定するテスト。
//
// 背景（Issue #1205）:
// 「友達投票開始」ボタンは `isCreating`(useState) で disabled になるが、state が画面へ
// 反映される前の連続押下は素通りする。素通りすると POST /v1/dish-category-group-votes が
// 二重に走り、API は呼び出しごとに新しい shareToken を発行するため
// **別々の投票セッションが 2 件作られる**（API 側に冪等化は無い）。
// #1205 で `isCreatingRef`(useRef) による同期ガードを追加した
//（search/index.tsx の `isSearchingRef` / map/components/ReviewForm.tsx の `isSubmittingRef` と同じ方式）。
//
// このテストは以下を赤で守る。
//   - await を挟まずに 2 回呼んでも作成 API は 1 回しか呼ばれない（ガードを外すと 2 回になる）
//   - 抑止された 2 発目は throw ではなく null を返す（呼び出し側が遷移しないための合図）
//   - **失敗しても必ず解除され、再試行できる**（解除を finally から try 側へ移すと赤）
//   - 成功後も解除される
import { act } from "react";
import TestRenderer from "react-test-renderer";

import type { SearchParams, DishCategoryRecommendation } from "@/types/search";

// jest.mock のファクトリから参照できるのは `mock` 始まりの変数だけ
const mockCallBackend = jest.fn();
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
const mockLogFrontendEvent = jest.fn();
jest.mock("@/hooks/useLogger", () => ({ useLogger: () => ({ logFrontendEvent: mockLogFrontendEvent }) }));
// #1507 jest-expo のネイティブモジュールモックでは `Crypto.randomUUID()` が undefined を返すため、
// `@/lib/uuid` の generateUUID がそのまま undefined になり、冪等キーの検証が全部素通りしてしまう。
// 実装（@/lib/uuid）は差し替えず、その土台だけを Node の同一契約の実装へ寄せる。
jest.mock("expo-crypto", () => ({ randomUUID: () => globalThis.crypto.randomUUID() }));

import { useCreateDishCategoryGroupVote } from "./useCreateDishCategoryGroupVote";

// React 19 では初期描画がスケジューラのタスクへ回されるため、act() で包む必要がある
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

/** フックが参照する項目だけを持つ検索条件のダミー */
const searchParams = {
	location: { latitude: 35.658, longitude: 139.7016 },
	distance: 1000,
	priceLevels: ["PRICE_LEVEL_MODERATE"],
	localLanguageCode: "ja",
} as unknown as SearchParams;

const dishCategories: DishCategoryRecommendation[] = [
	{ category: "ラーメン", title: "濃厚豚骨", reason: "近所で人気", categoryId: "cat-1", imageUrl: "https://x/1" },
	// 非表示のトピックは候補へ含まれない（候補件数のアサーションで効く）
	{
		category: "カレー",
		title: "スパイスカレー",
		reason: "話題",
		categoryId: "cat-2",
		imageUrl: "https://x/2",
		isHidden: true,
	},
];

describe("useCreateDishCategoryGroupVote の連打耐性（#1205）", () => {
	let renderer: TestRenderer.ReactTestRenderer;
	let hookRef: ReturnType<typeof useCreateDishCategoryGroupVote>;

	const Probe = () => {
		hookRef = useCreateDishCategoryGroupVote();
		return null;
	};

	const mount = async () => {
		await act(async () => {
			renderer = TestRenderer.create(<Probe />);
		});
	};

	/**
	 * callBackend を保留させ、テスト側から解決／棄却できるようにする。
	 * 「await の手前で 2 発目が来る」状況を、実際に in-flight のまま作るために使う。
	 */
	const deferCreate = () => {
		let resolveCreate!: (value: unknown) => void;
		let rejectCreate!: (reason: unknown) => void;
		mockCallBackend.mockImplementationOnce(
			() =>
				new Promise((resolve, reject) => {
					resolveCreate = resolve;
					rejectCreate = reject;
				}),
		);
		return {
			resolve: (value: unknown) => act(async () => resolveCreate(value)),
			reject: (reason: unknown) => act(async () => rejectCreate(reason)),
		};
	};

	// jest.config.js の clearMocks は mockClear（呼び出し履歴のみ）で、
	// `mockImplementationOnce` のキューは残る。消費し切らなかった保留 Promise が次のテストへ漏れると
	// 「resolveCreate is not a function」という無関係な失敗になるため、実装ごと毎回捨てる
	beforeEach(() => {
		mockCallBackend.mockReset();
	});

	afterEach(() => {
		act(() => renderer?.unmount());
	});

	it("await を挟まずに 2 回呼んでも作成 API は 1 回しか呼ばれない", async () => {
		await mount();
		const create = deferCreate();

		// ⚠️ ここで await してはいけない。await すると 1 発目が完了してから 2 発目が走り、
		//    「state の反映前に 2 発目が来る」という守りたい状況が再現できない（偽陰性になる）
		let first!: Promise<unknown>;
		let second!: Promise<unknown>;
		await act(async () => {
			first = hookRef.createGroupVote({ searchParams, dishCategories });
			second = hookRef.createGroupVote({ searchParams, dishCategories });
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		// 非表示トピックは候補へ入らない（= 送っているのは visibleDishCategories）
		expect(mockCallBackend.mock.calls[0][1].requestPayload.candidates).toHaveLength(1);

		await create.resolve({ shareToken: "token-1" });

		expect(await first).toEqual({ shareToken: "token-1" });
		// 抑止された 2 発目は「失敗」ではないので throw せず null。呼び出し側はこれを見て遷移を止める
		expect(await second).toBeNull();
	});

	it("3 連打でも作成 API は 1 回しか呼ばれない", async () => {
		await mount();
		const create = deferCreate();

		const results: Promise<unknown>[] = [];
		await act(async () => {
			for (let i = 0; i < 3; i += 1) results.push(hookRef.createGroupVote({ searchParams, dishCategories }));
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(1);

		await create.resolve({ shareToken: "token-1" });
		expect(await Promise.all(results)).toEqual([{ shareToken: "token-1" }, null, null]);
	});

	it("API が失敗しても解除され、再試行できる", async () => {
		await mount();
		const failing = deferCreate();

		let first!: Promise<unknown>;
		await act(async () => {
			first = hookRef.createGroupVote({ searchParams, dishCategories });
			// 失敗を待たずに reject されるため、ここで捕捉しておかないと unhandled rejection になる
			first.catch(() => {});
		});
		await failing.reject(new Error("network down"));
		await expect(first).rejects.toThrow("network down");

		// #1205 解除は finally が握る。try 側へ移すと例外経路で解除漏れが起き、
		// 「1 回失敗したら二度と押せない」になる
		expect(hookRef.isCreating).toBe(false);

		const retry = deferCreate();
		let second!: Promise<unknown>;
		await act(async () => {
			second = hookRef.createGroupVote({ searchParams, dishCategories });
		});

		expect(mockCallBackend).toHaveBeenCalledTimes(2);
		await retry.resolve({ shareToken: "token-2" });
		expect(await second).toEqual({ shareToken: "token-2" });
	});

	it("成功後も解除され、次の作成を開始できる", async () => {
		await mount();
		const create = deferCreate();

		let first!: Promise<unknown>;
		await act(async () => {
			first = hookRef.createGroupVote({ searchParams, dishCategories });
		});
		await create.resolve({ shareToken: "token-1" });
		await first;

		expect(hookRef.isCreating).toBe(false);

		const next = deferCreate();
		await act(async () => {
			hookRef.createGroupVote({ searchParams, dishCategories });
		});
		expect(mockCallBackend).toHaveBeenCalledTimes(2);
		await next.resolve({ shareToken: "token-2" });
	});

	it("表示中のトピックが 0 件なら API を呼ばずに失敗し、ガードも残らない", async () => {
		await mount();

		await expect(hookRef.createGroupVote({ searchParams, dishCategories: [{ ...dishCategories[0], isHidden: true }] })).rejects.toThrow(
			"No visible dishCategories",
		);
		expect(mockCallBackend).not.toHaveBeenCalled();

		// バリデーション失敗でガードが立ちっぱなしになっていないこと
		const create = deferCreate();
		await act(async () => {
			hookRef.createGroupVote({ searchParams, dishCategories });
		});
		expect(mockCallBackend).toHaveBeenCalledTimes(1);
		await create.resolve({ shareToken: "token-1" });
	});

	// ─────────────────────────────────────────────────────────────────────────
	// #1507 冪等キー
	//
	// 上のガードが守れるのは「同一 JS タスク内の連打」だけで、通信のリトライ・
	// オフライン復帰後の再送・再マウントでは POST が二重に届く。サーバー側の冪等化は
	// **同じキーで送られてくること**が前提なので、キーの寿命をここで固定する。
	// ─────────────────────────────────────────────────────────────────────────
	describe("再送をまたいで同じ冪等キーを送る（#1507）", () => {
		/** RFC 4122 の v4（3 ブロック目が 4、4 ブロック目が 8/9/a/b） */
		const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

		const sentKeyAt = (callIndex: number): string => mockCallBackend.mock.calls[callIndex][1].requestPayload.idempotencyKey;

		it("送っているキーは UUID v4（API 側の @IsUUID(4) を通る形式）", async () => {
			await mount();
			const create = deferCreate();

			await act(async () => {
				hookRef.createGroupVote({ searchParams, dishCategories });
			});

			expect(sentKeyAt(0)).toMatch(UUID_V4);
			await create.resolve({ shareToken: "token-1" });
		});

		it("失敗後に同じ入力で再試行すると、同じキーで送る（サーバーは既存セッションを返せる）", async () => {
			await mount();
			const failing = deferCreate();

			let first!: Promise<unknown>;
			await act(async () => {
				first = hookRef.createGroupVote({ searchParams, dishCategories });
				first.catch(() => {});
			});
			await failing.reject(new Error("network down"));
			await expect(first).rejects.toThrow("network down");

			const retry = deferCreate();
			await act(async () => {
				hookRef.createGroupVote({ searchParams, dishCategories });
			});

			// ここが変わると「届いていたが応答が落ちた」再送で 2 件目のセッションが出来る
			expect(sentKeyAt(1)).toBe(sentKeyAt(0));
			await retry.resolve({ shareToken: "token-1" });
		});

		it("成功したら次の作成は新しいキーになる（同じキーのままだと二度と新規作成できない）", async () => {
			await mount();
			const create = deferCreate();

			let first!: Promise<unknown>;
			await act(async () => {
				first = hookRef.createGroupVote({ searchParams, dishCategories });
			});
			await create.resolve({ shareToken: "token-1" });
			await first;

			const next = deferCreate();
			await act(async () => {
				hookRef.createGroupVote({ searchParams, dishCategories });
			});

			expect(sentKeyAt(1)).not.toBe(sentKeyAt(0));
			await next.resolve({ shareToken: "token-2" });
		});

		it("失敗後に候補を変えて再試行すると新しいキーになる（古い内容のセッションを返させない）", async () => {
			await mount();
			const failing = deferCreate();

			let first!: Promise<unknown>;
			await act(async () => {
				first = hookRef.createGroupVote({ searchParams, dishCategories });
				first.catch(() => {});
			});
			await failing.reject(new Error("network down"));
			await expect(first).rejects.toThrow("network down");

			// 1 件目を非表示にして候補を入れ替える = 別の作成意図
			const retry = deferCreate();
			await act(async () => {
				hookRef.createGroupVote({
					searchParams,
					dishCategories: [{ ...dishCategories[0], isHidden: true }, { ...dishCategories[1], isHidden: false }],
				});
			});

			expect(sentKeyAt(1)).not.toBe(sentKeyAt(0));
			await retry.resolve({ shareToken: "token-2" });
		});
	});
});
