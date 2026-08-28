import React, { useCallback, useMemo } from "react";
import { Pressable, ScrollView, StyleSheet, Text, View } from "react-native";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import type { NormalizedDishMediaEntry } from "@/stores/useDishMediaEntriesStore";
import { isRatingFilterEnabled, useMyDishesFilterStore, type MyDishesFilter } from "../stores/useMyDishesFilterStore";
import { MY_DISHES_EVENTS } from "../analytics";
import { resolveDishCategoryLabel } from "../dishCategoryLabel";

/**
 * #1397 (PR5/5) 全画面 Feed の contextual filter chips（設計 (2/2) §10）。
 *
 * ## 置き場所：`DishMediaFeed` は 1 行も変えない（§10-1）
 *
 * chips は新ルート `app/[locale]/(tabs)/my-dishes/feed.tsx` の中で `DishMediaFeed` の
 * **上にオーバーレイ**として載る。現在表示中のエントリはルート側が `onIndexChange` で拾って
 * `entry` として渡す。こうすることで店舗フィード（`restaurant/[restaurantId]/feed.tsx`）・
 * 通知フィード・投稿フィードの振る舞いは自動的に不変になる。
 *
 * ## ⚠️ 並び替えの chip は作らない（リーダー判断 Q3）
 *
 * #1397 本文が chips の要件を「**棚を削る方向に働くこと**」と定めている。並び替えは棚を削らない
 * のでこの要件を満たさない。設計 (2/2) §10-2 が挙げていた `sortScene` / `sortTimeSlot` の chip は
 * **作らない**し、i18n キーも足さない（parity テストは extra でも落ちる）。時間帯・シチュエーションは
 * 既存のフィルタ画面（`my-dishes/filters.tsx`）の並び替えから到達できる。
 *
 * 採用するのは「絞る」3 種だけ:
 *
 * | chip | 押したときの `patch` |
 * | --- | --- |
 * | 〈料理名〉で絞る | `{ categoryIds: [entry.dish.category_id] }`（**追加ではなく置換**） |
 * | 食べたで絞る / 食べたいで絞る | `{ status: ["eaten"] }` / `{ status: ["want"] }` |
 * | ★4以上で絞る | `{ minRating: 4 }`。**`status` が `["eaten"]` のときだけ出す** |
 *
 * ## ⚠️ 「押しても棚が広がらない」を実装で担保する
 *
 * chip は**トグルにしない**。既に効いている絞り込みの chip は選択状態で描き、押しても何もしない
 * （`handlePress` の先頭で return する）。トグルにすると「押すと棚が広がる」経路ができてしまい、
 * リーダー判断（棚を削る方向にだけ働く）と食い違う。
 *
 * 代わりに**戻る手段はスナックバーの「元に戻す」で出す**。押す直前の `filter` をまるごと控えて
 * おき、`patch(previous)` で戻す（`patch` は部分更新なので、全キーを渡せば元の状態に復元できる）。
 * これで「絞ったら戻せない」袋小路を作らずに、chip 自体は片方向に保てる。
 *
 * ## chip は共有フィルタ store だけを書く（chip 専用 store を作らない）
 *
 * 書き先は `useMyDishesFilterStore` 1 本。ここが list / Map / Calendar の 3 ビュー共有なので、
 * chip を押した結果は 3 ビューすべてに同時に効く（#1397 完了条件）。chip 専用の別 store を
 * 立てるとフィルタ画面と chips で状態が二重化して必ずズレる。
 *
 * ## 足元の Feed は崩れない（§10-3）
 *
 * `DishMediaFeed` は開いた時点の ids を state に固定する（`ids.length === 0 && liveIds.length > 0`
 * のガード）。したがって chip を押して共有フィルタが変わっても、**見ている Feed は最後まで
 * 見られる**。裏で base の `queryKey` が変わり、リスト・Map・Calendar が新しい棚で取り直される。
 */

/** ★N 以上 chip の N。フィルタ画面の刻みと同じ 4（`MyDishes.filters.rating.min`） */
export const MY_DISHES_FEED_CHIP_MIN_RATING = 4;

export type MyDishesFeedChipId = "category" | "statusEaten" | "statusWant" | "minRating";

export type MyDishesFeedChip = {
	id: MyDishesFeedChipId;
	label: string;
	/** 既にこの絞り込みが効いているか。true の chip は押しても何もしない（棚を広げない） */
	active: boolean;
	/** 押したときに `useMyDishesFilterStore.patch` へ渡す部分更新 */
	patch: Partial<MyDishesFilter>;
};

/** chips の並びを決める純粋関数。UI を持たないのでそのまま単体テストできる */
export const buildMyDishesFeedChips = (
	filter: MyDishesFilter,
	entry: Pick<NormalizedDishMediaEntry, "dish"> | null,
): MyDishesFeedChip[] => {
	const chips: MyDishesFeedChip[] = [];

	// カテゴリ chip は「今見ているエントリ」からしか作れないので、entry が無い間は出さない
	const categoryId = entry?.dish.category_id ?? null;
	if (categoryId !== null && categoryId.length > 0) {
		// ⚠️ ラベルに使えるのは `dish.name` である。`DishMediaEntry.dish` はカテゴリの
		// 表示名（`dish_categories.labels`）を持たない（`shared/api/v1/res/dish-media.response.ts`）。
		// `dishes` は `restaurant_id × category_id` で一意（`schema.prisma` の
		// `dishes_restaurant_category_unique`）なので、`dish.name` は実質「その店でのその
		// カテゴリの呼び名」であり、絞り込みの対象（`category_id`）と 1 対 1 に対応する。
		// ⚠️ 名前が無い dish（SNS 取り込み等）で ID へ落とさない。「Q234646」のような
		// Wikidata QID がそのまま chip に出て «何で絞るのか分からない» と実機で指摘された。
		// ラベルにできる名前があるときだけ chip を出す
		/*
		#1375（オーナー実機指摘「うどんで絞ったら udon が出る」）

		`dish.name` は «その店でのその料理の呼び名» で、SNS 取り込み由来だとローマ字が入る。
		カテゴリの正式表記を優先する（規則は `features/myDishes/dishCategoryLabel.ts` に 1 本化。
		絞り込み画面の候補ラベルも同じ関数を通している）。
		*/
		const name = resolveDishCategoryLabel(entry?.dish?.categoryLabels, entry?.dish?.name, i18n.locale);
		if (name !== null) {
			chips.push({
				id: "category",
				label: i18n.t("MyDishes.feed.chips.filterCategory", { name }),
				// 「置換」なので、ちょうどこのカテゴリ 1 件のときだけ選択状態
				active: filter.categoryIds.length === 1 && filter.categoryIds[0] === categoryId,
				patch: { categoryIds: [categoryId] },
			});
		}
	}

	chips.push({
		id: "statusEaten",
		label: i18n.t("MyDishes.feed.chips.filterStatusEaten"),
		active: filter.status.length === 1 && filter.status[0] === "eaten",
		patch: { status: ["eaten"] },
	});
	chips.push({
		id: "statusWant",
		label: i18n.t("MyDishes.feed.chips.filterStatusWant"),
		active: filter.status.length === 1 && filter.status[0] === "want",
		patch: { status: ["want"] },
	});

	// ★N 以上は `status` が `["eaten"]` のときだけ出す（#1395 m-4: want 行は rating を持たないので、
	// 評価で絞ると「食べたい」が全消しになる）。判定は store 側の唯一の実装を使う
	if (isRatingFilterEnabled(filter)) {
		chips.push({
			id: "minRating",
			label: i18n.t("MyDishes.feed.chips.filterMinRating", { count: MY_DISHES_FEED_CHIP_MIN_RATING }),
			active: filter.minRating !== null && filter.minRating >= MY_DISHES_FEED_CHIP_MIN_RATING,
			patch: { minRating: MY_DISHES_FEED_CHIP_MIN_RATING },
		});
	}

	return chips;
};

export type MyDishesFeedChipsProps = {
	/** いま Feed が表示しているエントリ。まだ確定していない間は `null` */
	entry: NormalizedDishMediaEntry | null;
};

export function MyDishesFeedChips({ entry }: MyDishesFeedChipsProps) {
	const styles = useThemedStyles(createStyles);
	const filter = useMyDishesFilterStore((s) => s.filter);
	const patch = useMyDishesFilterStore((s) => s.patch);
	const { showSnackbar } = useSnackbar();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

	const chips = useMemo(() => buildMyDishesFeedChips(filter, entry), [entry, filter]);

	const handlePress = useCallback(
		(chip: MyDishesFeedChip) => {
			// 既に効いている絞り込みは no-op。ここで解除に回すと chip が「棚を広げる」道具になる
			if (chip.active) return;
			lightImpact();

			// 「元に戻す」のために、押す直前の filter をまるごと控える。
			// `patch` は部分更新なので、全キーを持つこのスナップショットを渡せば元へ戻せる
			const previous = useMyDishesFilterStore.getState().filter;
			patch(chip.patch);

			logFrontendEvent({
				event_name: MY_DISHES_EVENTS.feedChipApplied,
				error_level: "log",
				payload: { chipId: chip.id, dishMediaId: entry ? String(entry.dish_media.id) : null },
			});

			showSnackbar(i18n.t("MyDishes.feed.chips.applied"), {
				action: {
					label: i18n.t("Common.undo"),
					onPress: () => {
						useMyDishesFilterStore.getState().patch(previous);
						logFrontendEvent({
							event_name: MY_DISHES_EVENTS.feedChipUndone,
							error_level: "log",
							payload: { chipId: chip.id },
						});
					},
				},
			});
		},
		[entry, lightImpact, logFrontendEvent, patch, showSnackbar],
	);

	if (chips.length === 0) return null;

	return (
		// ⚠️ `box-none` にすること。chips の帯そのものはタップを受けず、Feed の縦スワイプを
		// 邪魔しない。受けるのは chip（Pressable）だけ
		<View style={styles.container} pointerEvents="box-none" testID="my-dishes-feed-chips">
			<ScrollView
				horizontal
				showsHorizontalScrollIndicator={false}
				contentContainerStyle={styles.content}
				keyboardShouldPersistTaps="handled">
				{chips.map((chip) => (
					<Pressable
						key={chip.id}
						// #1396 §6-1 / #1397 §11-2: 動的な testID は作らない。E2E は nth() かラベルで指す
						testID="my-dishes-feed-chip"
						style={[styles.chip, chip.active && styles.chipActive]}
						onPress={() => handlePress(chip)}
						accessibilityRole="button"
						// 押しても何も起きない状態であることを支援技術へも伝える
						accessibilityState={{ selected: chip.active, disabled: chip.active }}
						accessibilityLabel={chip.label}
						hitSlop={4}>
						<Text style={[styles.chipText, chip.active && styles.chipTextActive]} numberOfLines={1}>
							{chip.label}
						</Text>
					</Pressable>
				))}
			</ScrollView>
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			// #1375（5 巡目・デザインレビュー #7）**右のアクション列**（いいね / 保存 /
			// 食べたを記録 / シェア / 地図）と重ならないよう右側を空ける。
			// chips は列の最下段と同じ高さにあり、列の実幅は約 90pt ある。
			// 56 は右上の «閉じる» だけを避ける値で、下部のこの列を想定していなかった
			// （実際に「食べたいで絞る」が「地図を開く」のラベルへ被っていた）
			paddingRight: 96,
		},
		content: {
			gap: 8,
			paddingHorizontal: 16,
			paddingVertical: 8,
		},
		chip: {
			paddingHorizontal: 12,
			paddingVertical: 6,
			borderRadius: 999,
			backgroundColor: "rgba(0,0,0,0.55)",
			borderWidth: 1,
			borderColor: "rgba(255,255,255,0.35)",
		},
		chipActive: {
			// #1375（5 巡目・デザインレビュー #3）パレットに無い青をやめる。
			// 選択中は «白地に黒文字» で示す（写真の上なので地の白が一番強い）
			backgroundColor: FixedColors.onMedia,
			borderColor: FixedColors.onMedia,
		},
		chipText: {
			fontSize: 13,
			fontWeight: "600",
			color: FixedColors.onMedia,
		},
		chipTextActive: {
			// 地が白になったので文字は黒（白地に白文字を作らない）
			color: c.textPrimaryAlt,
		},
	});
