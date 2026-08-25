import React, { memo, useCallback, useMemo } from "react";
import i18n from "@/lib/i18n";
import { resolveDishCategoryLabel } from "../dishCategoryLabel";
import { Pressable, StyleSheet, Text, View, type GestureResponderEvent } from "react-native";
import { Utensils } from "lucide-react-native";
import { FixedColors } from "@/constants/Palette";
import { getCacheKeyForImage } from "@/lib/image";
import type { MyDishItem } from "@shared/api/v1/res";
import { MY_DISH_STATUS_COLORS } from "@/features/myDishes/statusColors";

/**
 * #1397 リストビューのカード（`MyDishesListView`）と料理メディア Sheet の行
 * （`MyDishesRestaurantSheet`）で共有する部品（設計 (1/2) §1-1「カードの実装は共通化する」）。
 *
 * **レイアウトは共通化しない。** 一覧は 3 列のグリッドタイル、Sheet は縦 1 列の行で、
 * 同じ寸法・同じ並びを共有できるのはバッジ・★・日付・画像の «決め方» だけである。
 * ここを 1 つのコンポーネントに畳むと、片方の都合で prop が増え続ける形になる。
 *
 * ## ⚠️ 画像のフォールバックは呼び出し側で変わる
 *
 * この Sheet は `dish.categoryImageUrl` → `restaurant.image_url` の順で **実画像**
 * （#1375 追補2 決定3）を使う（`fallback: "category"`）。
 *
 * 一覧ビュー（`MyDishesListView`）は本 PR（#1397 PR3）の時点では灰色プレースホルダーの
 * ままだったが、その後 #1398 PR5（`claude/review-tab-removal-shop-tab-put0bd` 統合ブランチ）が
 * 独立に一覧側も実画像フォールバックへ揃えた。ただし一覧はこの `MyDishImageFallback`
 * ではなく `../thumbnail.ts` の `resolveMyDishThumbnailUrl`（list / calendar 共有）を使っており、
 * この関数の呼び出し側は現状 Sheet のみである。`"none"` は将来また灰色プレースホルダーの
 * ビューが増えたときのための選択肢として残してある。
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

/**
 * カードに出す料理名。無ければ店名へ落とす（どちらも無ければ null）。
 *
 * #1375（オーナー実機指摘）**カテゴリの正式表記を優先する。**
 * `dish.name` は «その店でのその料理の呼び名» で、SNS 取り込み由来だと `udon` のように
 * ローマ字が入る。一覧・Calendar でそれがそのまま出ていた
 * （絞り込み画面とフィード上部のチップは先に直したが、**ここが残っていた**）。
 * 規則は `features/myDishes/dishCategoryLabel.ts` に 1 本化してある。
 */
export const resolveMyDishTitle = (item: MyDishItem, locale?: string | null): string | null =>
	resolveDishCategoryLabel(item.dish.categoryLabels, item.dish.name, locale ?? i18n.locale) ||
	item.restaurant.name ||
	null;

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
			{/* 白塗りの側は文字も赤でなければ読めない。色は statusColors から 1 組で取る */}
			<Text style={[styles.statusBadgeText, { color: MY_DISH_STATUS_COLORS[status].on }]}>
				{i18n.t(`MyDishes.filters.status.${status}`)}
			</Text>
		</View>
	);
});

/**
 * #1398 (PR4/7) want 行から「食べたを記録」へ送る CTA。一覧のカードと Sheet の行で共有する。
 *
 * ## いつ出すか
 *
 * `status === "want"` の行だけ。eaten 行には出さない。再訪の記録は全画面 Feed の
 * `ActionButtons` 側（常時活性）で足りる（設計 (1/2) §1(b)）。
 *
 * want 行の `dishMedia` は契約上必ず非 null（want の定義が dish_media への save である以上、
 * 保存対象のメディアが必ず在る。#1395 m-7）。それでも `null` を弾く形にしてあるのは、
 * 呼び出し側で `dishMedia.id` を触るために型を絞る必要があるからで、防御であって仕様ではない。
 *
 * ## ⚠️ 親のタップを起こさないこと
 *
 * カード・行の全体は #1397 PR4 で全画面 Feed への遷移になっている。この CTA を押したときに
 * Feed が開いてはいけない。
 *
 * - **native**: RN のタッチレスポンダは 1 つしか勝たない。子の `Pressable` が responder を取るので
 *   親の `onPress` は発火しない。
 * - **web（react-native-web）**: DOM の click がそのまま親へ **バブルする**。`stopPropagation()` を
 *   自分で呼ばないと親の `onPress` まで走り、CTA を押しただけで Feed が開く。
 *
 * よって `onPress` で受け取ったイベントに対して必ず `stopPropagation()` を呼ぶ。
 * RN 側の `GestureResponderEvent` にも `stopPropagation` は生えているので分岐は要らないが、
 * 実装差を踏まないよう optional call にしてある。この挙動は
 * `myDishCard.test.tsx` が «イベントを渡した場合 / 渡さない場合» の両方で固定している。
 */
export const MyDishEatenButton = memo(function MyDishEatenButton({
	item,
	onPress,
	testID = "my-dishes-mark-as-eaten",
}: {
	item: MyDishItem;
	onPress: (item: MyDishItem) => void;
	testID?: string;
}) {
	const handlePress = useCallback(
		(event?: GestureResponderEvent) => {
			// web ではここで止めないと親（カード / 行）の onPress まで走る
			event?.stopPropagation?.();
			onPress(item);
		},
		[item, onPress],
	);

	if (item.status !== "want" || item.dishMedia === null) return null;

	return (
		<Pressable
			testID={testID}
			style={styles.eatenButton}
			onPress={handlePress}
			hitSlop={6}
			accessibilityRole="button"
			accessibilityLabel={i18n.t("MyDishes.actions.markAsEatenA11y")}>
			{/* 地（eatenButton = 固定の濃色）で塗り潰した上のアイコンなので固定の白でよい */}
			<Utensils size={11} color={FixedColors.onFilled} />
			<Text style={styles.eatenButtonText} numberOfLines={1}>
				{i18n.t("MyDishes.actions.markAsEaten")}
			</Text>
		</Pressable>
	);
});

const styles = StyleSheet.create({
	statusBadge: {
		paddingHorizontal: 6,
		paddingVertical: 2,
		borderRadius: 10,
	},
	// #1375（5 巡目）塗りの有無で区別する: 食べたい = 白塗り赤枠 / 食べた = 赤塗り
	statusWant: {
		backgroundColor: MY_DISH_STATUS_COLORS.want.fill,
		borderWidth: 1,
		borderColor: MY_DISH_STATUS_COLORS.want.border,
	},
	statusEaten: {
		backgroundColor: MY_DISH_STATUS_COLORS.eaten.fill,
		borderWidth: 1,
		borderColor: MY_DISH_STATUS_COLORS.eaten.border,
	},
	statusBadgeText: {
		fontSize: 10,
		fontWeight: "700",
	},
	/**
	 * #1375（5 巡目・デザインレビュー #2）**内容幅・非赤にした。**
	 *
	 * 以前は 3 列グリッドの `footer`（`alignItems` 既定 = stretch）でタイル全幅の赤いピルになり、
	 * 1 画面に 9〜12 本並んで、画面唯一の主アクセントであるべき FAB が負けていた。
	 * `alignSelf: "flex-end"` で内容幅へ縮め、色は写真の上に載る半透明黒にしてある。
	 * 赤はこの画面では FAB と状態バッジだけが使う。
	 */
	eatenButton: {
		alignSelf: "flex-end",
		flexDirection: "row",
		alignItems: "center",
		gap: 3,
		paddingHorizontal: 8,
		paddingVertical: 4,
		borderRadius: 12,
		backgroundColor: "rgba(0,0,0,0.55)",
		borderWidth: StyleSheet.hairlineWidth,
		borderColor: "rgba(255,255,255,0.5)",
	},
	eatenButtonText: {
		fontSize: 10,
		fontWeight: "700",
		// 地（eatenButton）が固定の濃色なので、文字も固定でよい
		color: FixedColors.onFilled,
	},
});
