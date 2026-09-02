import type { Href } from "expo-router";
import type { ResolveShareLinkResponse } from "@shared/api/v1/res";
import type { PublicLocale } from "@shared/api/v1/constants/publicLocales";

/**
 * 🧭 共有リンクの resolve 結果を、アプリ内の遷移先へ変換する（#721）。
 *
 * ## なぜサーバが返した path をそのまま使わないか
 * API は `target.type` / `id` / `params` しか返さない。**path を返させて
 * `router.push` に流すと、サーバ側の不備がそのままアプリ内の任意遷移になる**。
 * 変換はここで、`type` ごとに手で書いた allowlist として持つ。
 *
 * ## 未知の type
 * 将来サーバが新しい `target_type` を返すようになっても、古いアプリは
 * それを知らない。`null` を返してホームへ落とす（クラッシュさせない）。
 */
export function toShareLinkHref(
	resolved: ResolveShareLinkResponse,
	locale: PublicLocale,
): Href | null {
	const { type, id, params } = resolved.target;

	switch (type) {
		case "dish_media": {
			// 既存の共有 URL と同じ画面へ着地させる。`?ids=` はカンマ区切り（posts.tsx が split する）
			const ids = Array.isArray(params.ids) && params.ids.length > 0 ? params.ids.map(String) : [id];
			return {
				pathname: "/[locale]/(tabs)/posts",
				params: { locale, ids: ids.join(",") },
			} as Href;
		}

		case "dish_category_group_vote_sessions": {
			// 友達投票は既存の share_token で解決する（共有トークンを 2 系統にしない）
			const shareToken = typeof params.shareToken === "string" ? params.shareToken : "";
			if (!shareToken) return null;
			return {
				pathname: "/[locale]/(tabs)/search/dish-category-group-votes/[shareToken]/vote",
				params: { locale, shareToken },
			} as Href;
		}

		default:
			// 知らない type は握り潰す（古いアプリが新しい共有リンクを踏んだ場合）
			return null;
	}
}
