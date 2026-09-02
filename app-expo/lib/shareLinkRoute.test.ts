import { toShareLinkHref } from "./shareLinkRoute";
import type { ResolveShareLinkResponse } from "@shared/api/v1/res";

/**
 * 🧭 共有リンクの resolve 結果 → アプリ内の遷移先（#721）。
 *
 * ここが allowlist として機能していることを固定する。
 * サーバが返した文字列をそのまま `router.push` に流す作りへ戻ると、
 * サーバ側の不備がそのままアプリ内の任意遷移になる。
 */
const resolved = (target: ResolveShareLinkResponse["target"]): ResolveShareLinkResponse => ({
	schemaVersion: 1,
	target,
});

describe("toShareLinkHref", () => {
	it("dish_media は既存の posts 画面へ、ids をカンマ区切りで渡す", () => {
		// 新しい URL を作らないことで、既に共有済みのリンクと同じ画面に着地する
		const href = toShareLinkHref(
			resolved({ type: "dish_media", id: "a", params: { ids: ["a", "b"] } }),
			"ja-JP",
		);

		expect(href).toEqual({
			pathname: "/[locale]/(tabs)/posts",
			params: { locale: "ja-JP", ids: "a,b" },
		});
	});

	it("dish_media の ids が壊れていても target_id 単体で開く", () => {
		const href = toShareLinkHref(resolved({ type: "dish_media", id: "a", params: {} }), "en-US");

		expect(href).toEqual({
			pathname: "/[locale]/(tabs)/posts",
			params: { locale: "en-US", ids: "a" },
		});
	});

	it("友達投票は既存の shareToken で投票画面を開く", () => {
		// 共有トークンを 2 系統にしない（既存 URL・既存 API をそのまま使う）
		const href = toShareLinkHref(
			resolved({
				type: "dish_category_group_vote_sessions",
				id: "session-uuid",
				params: { shareToken: "abc123" },
			}),
			"ja-JP",
		);

		expect(href).toEqual({
			pathname: "/[locale]/(tabs)/search/dish-category-group-votes/[shareToken]/vote",
			params: { locale: "ja-JP", shareToken: "abc123" },
		});
	});

	it("友達投票で shareToken が無ければ遷移先を作らない", () => {
		// session の UUID を URL へ出す方向へは倒さない（公開 URL に主キーを載せない方針）
		const href = toShareLinkHref(
			resolved({ type: "dish_category_group_vote_sessions", id: "session-uuid", params: {} }),
			"ja-JP",
		);

		expect(href).toBeNull();
	});

	// 古いアプリが、後から増えた target_type の共有リンクを踏む状況。
	// クラッシュさせず、呼び出し側がホームへ落とせるように null を返す
	it("知らない target_type は null（クラッシュさせない）", () => {
		const href = toShareLinkHref(
			resolved({ type: "restaurants" as never, id: "x", params: {} }),
			"ja-JP",
		);

		expect(href).toBeNull();
	});
});
