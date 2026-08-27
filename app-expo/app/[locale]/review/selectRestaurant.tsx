import { Redirect, useLocalSearchParams } from "expo-router";

// #1396 【設計】旧レビュータブの URL は 8 ロケール分が sitemap 経由で公開インデックス対象に
// なっているため（`lib/seo/sitemap.ts` の SITEMAP_ROUTES）、`+not-found` に落とさず
// 新タブ（`my-dishes`）へのリダイレクトだけを残す（issue #1396 設計確定A）。
export default function LegacyReviewSelectRestaurantRedirect() {
	const { locale } = useLocalSearchParams<{ locale: string }>();
	return <Redirect href={`/${locale}/my-dishes`} />;
}
