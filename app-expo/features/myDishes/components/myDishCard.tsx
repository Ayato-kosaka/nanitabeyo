import React, { memo, useMemo } from "react";
import { StyleSheet, Text, View } from "react-native";
import i18n from "@/lib/i18n";
import { getCacheKeyForImage } from "@/lib/image";
import type { MyDishItem } from "@shared/api/v1/res";

/**
 * #1397 リストビューのカード（`MyDishesListView`）と料理メディア Sheet の行
 * （`MyDishesRestaurantSheet`）で共有する部品（設計 (1/2) §1-1「カードの実装は共通化する」）。
 *
 * **レイアウトは共通化しない。** 一覧は 3 列のグリッドタイル、Sheet は縦 1 列の行で、
 * 同じ寸法・同じ並びを共有できるのはバッジ・★・日付・画像の «決め方» だけである。
 * ここを 1 つのコンポーネントに畳むと、片方の都合で prop が増え続ける形になる。
 *
 * ## ⚠️ 画像のフォールバックは呼び出し側で変わる（意図的な非対称）
 *
 * | ビュー | `dishMedia === null` のとき |
 * | --- | --- |
 * | 一覧（既存） | 灰色プレースホルダー（`my-dishes-list-item-placeholder`）。#1396 PR3 の挙動をそのまま維持する |
 * | Sheet（本 PR） | `dish.categoryImageUrl` → `restaurant.image_url` の順で **実画像**（#1375 追補2 決定3） |
 *
 * 一覧側を実画像へ変えるのは本 PR のスコープ外なので、`MyDishImageFallback` で明示的に
 * 切り替える。既定値を持たせず必ず書かせるのは、次に増えるビューで «どちらの規約か» を
 * 黙って選ばせないためである。
 */

/** 写真なし（`dishMedia === null`）のときに何へ落とすか */
export type MyDishImageFallback =
	/** 何も出さない（呼び出し側がプレースホルダーを描く）。一覧ビューの既存挙動 */
	| "none"
	/** `dish.categoryImageUrl` → `restaurant.image_url` の順で実画像（#1375 追補2 決定3） */
	| "category";

/**
 * カードに出す画像の URL を決める。
 *
 * `dishMedia?.thumbnailImageUrl` が最優先。無いときの落とし先は `fallback` で決まる。
 * `dish.categoryImageUrl` は契約上 NOT NULL だが、空文字が来ても `restaurant.image_url` へ
 * 落ちるように `||` で畳んでいる（`??` だと空文字がそのまま `<Image>` へ渡り、壊れた画像になる）。
 */
export const resolveMyDishImageUrl = (item: MyDishItem, fallback: MyDishImageFallback): string | null => {
	const thumbnail = item.dishMedia?.thumbnailImageUrl ?? null;
	if (thumbnail) return thumbnail;
	if (fallback === "none") return null;
	return item.dish.categoryImageUrl || item.restaurant.image_url || null;
};

/** `expo-image` の `source`。URL が無ければ null（呼び出し側でプレースホルダーへ分岐する） */
export const useMyDishImageSource = (
	item: MyDishItem,
	fallback: MyDishImageFallback,
): { uri: string; cacheKey: string | undefined } | null => {
	const url = resolveMyDishImageUrl(item, fallback);
	return useMemo(() => (url ? { uri: url, cacheKey: getCacheKeyForImage(url) } : null), [url]);
};

/** カードに出す料理名。無ければ店名へ落とす（どちらも無ければ null） */
export const resolveMyDishTitle = (item: MyDishItem): string | null => item.dish.name || item.restaurant.name || null;

/**
 * `occurredAt` の表示。端末のロケールに任せる（アプリ内に日付書式のヘルパが無いため）。
 * 不正な日時で `Invalid Date` を出さないよう、パースできなければ null を返す。
 */
export const formatMyDishOccurredAt = (occurredAt: string, locale: string): string | null => {
	const time = Date.parse(occurredAt);
	if (Number.isNaN(time)) return null;
	return new Date(time).toLocaleDateString(locale);
};

/** 「食べたい」/「食べた」バッジ。文言・色は一覧ビューと Sheet で必ず一致させる */
export const MyDishStatusBadge = memo(function MyDishStatusBadge({ status }: { status: MyDishItem["status"] }) {
	return (
		<View style={[styles.statusBadge, status === "want" ? styles.statusWant : styles.statusEaten]}>
			<Text style={styles.statusBadgeText}>{i18n.t(`MyDishes.filters.status.${status}`)}</Text>
		</View>
	);
});

const styles = StyleSheet.create({
	statusBadge: {
		paddingHorizontal: 6,
		paddingVertical: 2,
		borderRadius: 10,
	},
	statusWant: {
		backgroundColor: "rgba(59,130,246,0.9)",
	},
	statusEaten: {
		backgroundColor: "rgba(240,85,55,0.9)",
	},
	statusBadgeText: {
		fontSize: 10,
		fontWeight: "700",
		color: "#FFFFFF",
	},
});
