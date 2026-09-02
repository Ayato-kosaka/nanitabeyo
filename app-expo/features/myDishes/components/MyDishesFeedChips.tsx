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
 * | 食べたで絞る / 食べたいで絞る | `{ status: ["eaten"] }` / `{ status: ["want"] }`。
 *   **#1629【34】いま見ているエントリが実際に `isEaten` / `isSaved` のときだけ出す** |
 * | ★4以上で絞る | `{ minRating: 4 }`。**`status` が `["eaten"]` のときだけ出す** |
 *
 * ## ⚠️ 「押しても棚が広がらない」を実装で担保する
 *
 * chip は**トグルにしない**。トグルにすると「押すと棚が広がる」経路ができてしまい、
 * リーダー判断（棚を削る方向にだけ働く）と食い違う。
 *
 * #1629【42】そのうえで、**既にその絞り込みが効いている chip は、そもそも出さない**。
 * 詳細は `buildMyDishesFeedChips` 内の「#1629【42】」コメント。
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
	/** 押したときに `useMyDishesFilterStore.patch` へ渡す部分更新 */
	patch: Partial<MyDishesFilter>;
};

/** chips の並びを決める純粋関数。UI を持たないのでそのまま単体テストできる */
export const buildMyDishesFeedChips = (
	filter: MyDishesFilter,
	entry: Pick<NormalizedDishMediaEntry, "dish" | "dish_media"> | null,
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
		const name = resolveDishCategoryLabel(entry?.dish?.categoryLabels, i18n.locale);
		// 「置換」なので、ちょうどこのカテゴリ 1 件に絞られていれば、この chip は既に効いている
		const alreadyApplied = filter.categoryIds.length === 1 && filter.categoryIds[0] === categoryId;
		if (name !== null && !alreadyApplied) {
			chips.push({
				id: "category",
				label: i18n.t("MyDishes.feed.chips.filterCategory", { name }),
				patch: { categoryIds: [categoryId] },
			});
		}
	}

	/*
	#1629【42】【設計】**押した結果その絞り込みが効いている chip は、以後 1 つも出さない。**

	オーナー指示: 「フィード画面で『カレーで絞る』とか押したら、そのチップは非表示にして欲しい」。

	それまでは «効いている chip を選択状態で描き、押しても no-op» にしていた（トグルにすると
	«押すと棚が広がる» 経路ができてリーダー判断と食い違うため）。しかし結果として、
	«カレーで絞る» を押してカレーで絞られているのに «カレーで絞る» がそのまま残り、
	**押しても何も起きない chip が場所を占める**状態になっていた。片方向という設計は正しいので、
	no-op にする代わりに **chip 自体を作らない**。

	この規則は «その絞り込みが既に効いているか» を判定できる chip **すべて**に等しく当てる。
	この Feed が出す 4 種はいずれも該当するので、例外は無い:

	| chip | 「既に効いている」の条件 | 判定できる根拠 |
	| --- | --- | --- |
	| category | `categoryIds` がちょうどこのカテゴリ 1 件 | patch が «置換» なので、押しても同じ値になる |
	| statusEaten | `status === ["eaten"]` | 同上 |
	| statusWant | `status === ["want"]` | 同上 |
	| minRating | `minRating >= 4` | 押しても閾値は上がらない（patch は固定値 4） |

	⚠️ **エリア（`filter.area`）は元から chip を持たない**ので、ここで消すものは無い。
	エリアの確定は Map の「このエリアで再検索」だけが行う（`useMyDishesFilterStore` §3-2）。
	Feed には «いま見ているエントリの周辺で絞る» に相当する chip が無く、追加もしない
	（追加すると «棚を削る» と言えるかが緯度経度の広さ次第になる）。同じ理屈で、期間・並び替えも
	chip を持たないので対象外である。将来 chip を足すときは、この表に «既に効いている» の
	条件を書けることを先に確かめること。書けない chip は「押しても何も起きない」を再発させる。

	⚠️ chip が全部消えると帯ごと消える（`chips.length === 0` で `null` を返す）。これは意図どおりで、
	絞り込みを戻す手段は押した直後のスナックバー «元に戻す» と、フィルタ画面（`my-dishes/filters.tsx`）
	の «リセット» が担当する。chip はあくまで «ここからさらに削る» ための入口である。
	*/

	/*
	#1629【34】**状態 chip は «いま見ているエントリが実際にその状態のとき» だけ出す。**

	オーナー実機報告: 「食べたをしてないフィードで『食べたで絞る』と出る」。

	それまで `statusEaten` / `statusWant` は entry を一切見ずに無条件で積んでいた。この Feed は
	«食べたい» の記録も «食べた» の記録も同じ縦に並ぶ（`MyDishesFeedPage` の restaurant / date
	スコープ）ので、**まだ食べていない（食べたいだけの）料理を見ている最中に「食べたで絞る」**が出る。
	押せば棚からその料理自身が消えるので、chip の設計（このファイル冒頭「棚を削る方向にだけ働く」）
	以前に «いま見ているものと関係が無い導線» になっていた。

	正しい条件は、既にカテゴリ chip が満たしている «いま見ているエントリから作れるものだけ出す» である。
	その状態を持っているのは `dish_media` の 2 つのフラグで、右レールの «食べたを記録» ボタンが
	記録済みの色を出すのに使っているものと同じ（`features/dishMedia/components/ActionButtons.tsx`）:

	| フラグ | 意味（`shared/api/v1/res/dish-media.response.ts`） |
	| --- | --- |
	| `isEaten` | その料理に自分の `dish_reviews` が 1 件でもあるか（= 食べた） |
	| `isSaved` | その料理を保存しているか（= 食べたい） |

	⚠️ `isEaten` は optional で、詰めているのは `GET /v1/dish-media?ids=` だけである。
	   仕様どおり **`undefined` は `false` と同じに扱う**（この Feed は必ずその経路で読むので、
	   実機では必ず入っている）。entry がまだ確定していない（`null`）間は、カテゴリ chip と
	   同じく何も出さない。
	*/
	// #1629【42】既にその状態だけに絞られていれば出さない（押しても何も起きないため）
	const statusOnly = filter.status.length === 1 ? filter.status[0] : null;
	if (entry?.dish_media?.isEaten === true && statusOnly !== "eaten") {
		chips.push({
			id: "statusEaten",
			label: i18n.t("MyDishes.feed.chips.filterStatusEaten"),
			patch: { status: ["eaten"] },
		});
	}
	if (entry?.dish_media?.isSaved === true && statusOnly !== "want") {
		chips.push({
			id: "statusWant",
			label: i18n.t("MyDishes.feed.chips.filterStatusWant"),
			patch: { status: ["want"] },
		});
	}

	// ★N 以上は `status` が `["eaten"]` のときだけ出す（#1395 m-4: want 行は rating を持たないので、
	// 評価で絞ると「食べたい」が全消しになる）。判定は store 側の唯一の実装を使う
	// #1629【42】既に ★N 以上で絞られていれば出さない（patch は固定値なので閾値は上がらない）
	const minRatingApplied = filter.minRating !== null && filter.minRating >= MY_DISHES_FEED_CHIP_MIN_RATING;
	if (isRatingFilterEnabled(filter) && !minRatingApplied) {
		chips.push({
			id: "minRating",
			label: i18n.t("MyDishes.feed.chips.filterMinRating", { count: MY_DISHES_FEED_CHIP_MIN_RATING }),
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
			// #1629【42】既に効いている絞り込みの chip は `buildMyDishesFeedChips` が作らないので、
			// ここへ来る chip は必ず «まだ効いていない» もの。解除に回さない（棚を広げない）のは従来どおり
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
						style={styles.chip}
						onPress={() => handlePress(chip)}
						accessibilityRole="button"
						accessibilityLabel={chip.label}
						hitSlop={4}>
						<Text style={styles.chipText} numberOfLines={1}>
							{chip.label}
						</Text>
					</Pressable>
				))}
			</ScrollView>
		</View>
	);
}

const createStyles = (_c: Palette) =>
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
		// #1629【42】選択状態（`chipActive` / `chipTextActive`）は削除した。
		// 効いている絞り込みの chip はそもそも描かれないので、選択中の見た目は存在しえない
		chipText: {
			fontSize: 13,
			fontWeight: "600",
			color: FixedColors.onMedia,
		},
	});
