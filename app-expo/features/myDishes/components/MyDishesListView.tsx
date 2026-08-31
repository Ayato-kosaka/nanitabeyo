import React, { memo, useCallback, useMemo, useState } from "react";
import { Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { LinearGradient } from "expo-linear-gradient";
import { ImageOff } from "lucide-react-native";
import { router } from "expo-router";
import { GridList } from "@/components/collapsible-tabs/GridList";
import { EmptyState } from "@/components/EmptyState";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import { useContentWidth } from "@/hooks/useContentWidth";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { getCacheKeyForImage } from "@/lib/image";
import i18n from "@/lib/i18n";
import type { MyDishItem } from "@shared/api/v1/res";
import { MyDishEatenButton } from "./myDishCard";
import { resolveDishCategoryLabel } from "../dishCategoryLabel";
import { DeletedMediaTombstone } from "@/components/DeletedMediaTombstone";
import { MY_DISHES_EVENTS } from "../analytics";
import { useMyDishesFeedScopeStore } from "../stores/useMyDishesFeedScopeStore";
import { buildMarkAsEatenRoute } from "../markAsEaten";
import { beginMarkAsEaten } from "../markAsEatenFunnel";
import { resolveMyDishThumbnail } from "../thumbnail";
import { resolveProviderIcon, resolveProviderLabel } from "@/features/dishMedia/providerIcon";
import { useMyDishesQuery } from "../hooks/useMyDishesQuery";
import { MY_DISH_STATUS_COLORS } from "@/features/myDishes/statusColors";

/**
 * #1396 my-dishes のリストビュー（設計書 (2/2) §7 の PR3）。
 *
 * - **料理画像主体のグリッド**。3 ビューのうち一番単純なので、共有フィルタ store の
 *   挙動（フィルタ変更で取り直す / ビュー切替では取り直さない）をここで固定する。
 * - `dishMedia === null`（写真なしの「食べた」記録）は**灰色プレースホルダーにしない**。
 *   `resolveMyDishThumbnailUrl`（`categoryImageUrl` → `restaurant.image_url` の順）で実画像へ
 *   フォールバックしつつ、「写真なし」であること自体は `MyDishes.list.noPhoto` バッジで示す
 *   （#1398 PR5 / #1375 追補2 決定3）。3 つとも無いときだけ従来どおりの無地プレースホルダー。
 * - #1513 `isOwnMediaDeleted`（自分の投稿が削除済み）の行は **フォールバックせず墓標**
 *   （`DeletedMediaTombstone`）を出す。行そのものは消さない。
 */

const COLUMNS = 3;
const GAP = 1;
const PADDING_HORIZONTAL = 16;
const ASPECT_RATIO = 9 / 16;

type MyDishGridItem = { id: string; item: MyDishItem };

const MyDishCard = memo(function MyDishCard({
	item,
	onPress,
	onPressMarkAsEaten,
}: {
	item: MyDishItem;
	onPress: (i: MyDishItem) => void;
	onPressMarkAsEaten: (i: MyDishItem) => void;
}) {
	const { colors } = useAppTheme();
	const styles = useThemedStyles(createStyles);
	const { lightImpact } = useHaptics();
	// #1629 表示名は `dish_categories.labels` から locale で引く（`dishes.name` は使わない）
	const { locale } = useLocale();
	// #958 と同じ理由で useWindowDimensions ではなく CenteredAppShell の中央カラム幅を使う
	const contentWidth = useContentWidth();
	const width = useMemo(() => (contentWidth - PADDING_HORIZONTAL * 2 - GAP * (COLUMNS - 1)) / COLUMNS, [contentWidth]);
	const height = width / ASPECT_RATIO;

	// #1398 PR5 写真なし（dishMedia === null）でも categoryImageUrl → restaurant.image_url へ
	// フォールバックする。3 つとも無いときだけ null（= 無地プレースホルダー）
	//
	// #1513 ただし «自分の投稿が削除済み»（isOwnMediaDeleted）はフォールバックしない。
	// 跡地に別の絵を入れず墓標を出す（判断は resolveMyDishThumbnail に集約）
	const thumbnail = resolveMyDishThumbnail(item);
	const thumbnailUrl = thumbnail.kind === "photo" ? thumbnail.url : null;
	const isNoPhoto = item.dishMedia === null;
	/*
	#1375（9 巡目・オーナー指摘）**取り込んだ投稿のサムネイルには provider のロゴを重ねる。**

	一覧に «自分で撮った写真» と «SNS から取り込んだもの» が混ざるので、
	タイルを見ただけでどちらか分かるようにする。

	⚠️ 判定は `render_type === "external_embed"` を先に見ること。`externalEmbed` は
	   «詰めているのは一部の経路だけ» という約束のフィールドで、`undefined` は
	   «stored である» ことを意味しない（`shared/api/v1/res/dish-media.response.ts`）。
	   ロゴの種類だけを `externalEmbed?.provider` から取り、取れなければ汎用リンクへ落とす。
	*/
	const isExternalEmbed = item.dishMedia?.render_type === "external_embed";
	const providerLabel = resolveProviderLabel(item.dishMedia?.externalEmbed?.provider);
	const ProviderIcon = resolveProviderIcon(item.dishMedia?.externalEmbed?.provider);
	/*
	#1629【オーナー実機報告】「レビュー投稿後、新規 «食べた» のサムネが白紙で、バグってるように見える」。

	投稿直後は **サムネイルの生成（リサイズ）がまだ終わっていない**ことがある。URL は返ってくるが
	実体が無いので画像取得が失敗し、`expo-image` は **何も描かない**（＝白紙）。
	行そのものは正しく増えているのに «壊れた» ように見えるのはこれである。

	失敗したら «カテゴリの画像 → プレースホルダー» の順に落とす。カテゴリの画像は
	`dish_categories.image_url` 由来で、ラーメン等には実際に入っている（実ログで確認）。

	⚠️ 行が変わったら失敗の記憶は捨てる（`item.key` を見る）。捨てないと、セルの使い回しで
	   **別の行が最初からプレースホルダー**になる。
	*/
	const [failedUrl, setFailedUrl] = useState<string | null>(null);
	const categoryImageUrl = item.dish.categoryImageUrl || null;
	const effectiveUrl = thumbnailUrl && thumbnailUrl !== failedUrl ? thumbnailUrl : categoryImageUrl;
	const source = useMemo(
		() => (effectiveUrl ? { uri: effectiveUrl, cacheKey: getCacheKeyForImage(effectiveUrl) } : null),
		[effectiveUrl],
	);

	const handlePress = useCallback(() => {
		lightImpact();
		onPress(item);
	}, [item, lightImpact, onPress]);

	// #1375（オーナー実機指摘「リストで食べたのうどんがローマ字になってる」）
	// カテゴリの正式表記だけを使う（規則は `dishCategoryLabel.ts` に集約）
	/*
	⚠️ #1629 3 行の並び（星 / 店名 / 料理名）では **`resolveMyDishTitle` を使わない**。
	   あれは «料理名が無ければ店名» へ落とすので、そのまま置くと店名が 2 行続けて出る
	   （自己レビューで検出）。ここは «カテゴリの表記そのもの» だけを使い、無ければ行ごと出さない。
	   タップ先の全画面 Feed は店名を必ず出すので、失われる情報は無い。
	*/
	const dishName = resolveDishCategoryLabel(item.dish.categoryLabels, locale) ?? undefined;
	const rating = item.myReview?.rating ?? null;

	return (
		<Pressable
			testID="my-dishes-list-item"
			style={[styles.card, { width, height }]}
			onPress={handlePress}
			android_ripple={{ color: "rgba(0,0,0,0.06)" }}
			accessibilityRole="button"
			accessibilityLabel={dishName ?? item.restaurant.name ?? i18n.t("ImageCardGrid.openItemDetails")}>
			{thumbnail.kind === "deleted" ? (
				// #1513 自分の投稿が削除済み。行は残したまま «削除されました» を出す（黙って消さない）
				<DeletedMediaTombstone style={StyleSheet.absoluteFill} />
			) : source ? (
				<Image
					source={source}
					cachePolicy="memory-disk"
					transition={100}
					/*
					#1375（9 巡目・オーナー指摘「読み込みが重い」）**セルの使い回しを画像へ伝える。**

					FlatList はスクロールでセル（＝この `Image`）を使い回す。`recyclingKey` を
					渡さないと、使い回された瞬間に **前の行の画像が残ったまま**新しい URL の
					読み込みが始まり、「一瞬別の写真が出てから差し替わる」ちらつきになる。
					人からは «読み込みが遅い» に見える。キーには行を一意に指す `item.key` を使う
					*/
					recyclingKey={item.key}
					// #1629 サムネイルの生成待ちで 404 になることがある。落ちたらカテゴリの画像へ替える
					onError={() => setFailedUrl(thumbnailUrl)}
					style={StyleSheet.absoluteFill}
					contentFit="cover"
					alt=""
					accessibilityElementsHidden
					importantForAccessibility="no"
				/>
			) : (
				// #1398 PR5 【仕様】categoryImageUrl / restaurant.image_url も無い異常系だけがここに来る
				// （dishMedia === null というだけではこの分岐に来ない。#1396 当時の「写真なし記録＝この
				// プレースホルダー」という前提は変わったが、testID は e2e から未参照のため残している）
				<View testID="my-dishes-list-item-placeholder" style={[StyleSheet.absoluteFill, styles.placeholder]}>
					<ImageOff size={20} color={colors.textTertiary} />
					<Text style={styles.placeholderText} numberOfLines={2}>
						{dishName ?? i18n.t("MyDishes.list.noPhoto")}
					</Text>
				</View>
			)}

			<LinearGradient
				colors={["rgba(0,0,0,0)", "rgba(0,0,0,0.55)"]}
				style={StyleSheet.absoluteFill}
				pointerEvents="box-none">
				<View style={styles.badgeRow}>
					<View style={[styles.statusBadge, item.status === "want" ? styles.statusWant : styles.statusEaten]}>
						{/* 白塗りの側は文字も赤でなければ読めない。色は statusColors から 1 組で取る */}
						<Text style={[styles.statusBadgeText, { color: MY_DISH_STATUS_COLORS[item.status].on }]}>
							{i18n.t(`MyDishes.filters.status.${item.status}`)}
						</Text>
					</View>
					{/* #1398 PR5 実画像へフォールバックしても「写真なし」自体は分かるようにする */}
					{source && isNoPhoto && (
						<View style={styles.noPhotoBadge} testID="my-dishes-list-item-no-photo-badge">
							{/* 写真の上に載る固定濃色バッジの中なので固定の白でよい */}
							<ImageOff size={10} color={FixedColors.onFilled} />
							<Text style={styles.noPhotoBadgeText}>{i18n.t("MyDishes.list.noPhoto")}</Text>
						</View>
					)}
					{/* #1375（9 巡目）取り込み元のロゴ。バッジ行の右端へ寄せる（左は状態バッジの列） */}
					{isExternalEmbed && (
						<View
							style={styles.providerBadge}
							/*
							#1641 ⚠️ **provider を testID に含めること。**

							これが無いと e2e から «鳴る投稿のカード» を狙えない。実際、
							run 33403385170 は «映像を持たない Instagram の素材» を踏んでしまい、
							再生を 1 度も観測しないまま «同時再生なし» と判定していた
							（＝ 何も起きなくても緑になる spec だった）。

							provider ごとに分けておけば «TikTok のカードを踏む» と名指しできる。
							⚠️ provider が分かるときは **必ず接尾辞が付く**（provider 無しの id は残らない）。
							   «バッジが在るか» を見るテストは接尾辞付きで書き直してある。
							*/
							testID={`my-dishes-list-item-provider-badge${
								item.dishMedia?.externalEmbed?.provider ? `-${item.dishMedia.externalEmbed.provider}` : ""
							}`}
							accessibilityElementsHidden
							importantForAccessibility="no-hide-descendants">
							{/* 写真の上に載る固定濃色バッジの中なので固定の白でよい */}
							<ProviderIcon size={12} color={FixedColors.onFilled} />
						</View>
					)}
				</View>
				{/*
				#1375（5 巡目・デザインレビュー #2 / #9）**3 列グリッドのタイルの密度を落とした。**

				幅 119pt のタイルに 6 要素（状態バッジ / 写真なしバッジ / ★ / 料理名 / 店名 /
				«食べたを記録»）が載っていて、どれも読めていなかった。落としたのは **★ と店名**の 2 つ。
				どちらもタップ先の全画面 Feed が必ず出しているので、ここに無くても失われない。

				«食べたを記録» は残す（1 タップの近道であり、消すと機能が減る）。ただし
				`footer` の `alignItems` 既定 = stretch でタイル全幅の赤いピルになっており、
				1 画面に 9〜12 本並んで **画面唯一の主アクセントであるべき FAB が負けていた**。
				そこで `alignSelf: "flex-end"` で内容幅へ縮め、色を赤から «写真の上の半透明黒» へ
				落としてある（`myDishCard.tsx` の `eatenButton`）。赤はこの画面では FAB と
				状態バッジだけが使う。
				*/}
				<View style={styles.footer}>
					{/*
					#1629【オーナー指示】**タイルの下は «自分の星評価 → 店名 → 料理名» の順**にする。

					5 巡目のデザインレビューで «密度を落とす» ために ★ と店名を落としていたが、
					一覧を眺めるときに «どの店の何を、自分は何点にしたか» が要る、というのが
					オーナーの判断である。3 行に戻すぶん、下の行ほど小さく・薄くして序列を付ける
					（同じ大きさで 3 行積むと、どれも読まれない元の状態へ戻る）。

					★ は **自分が付けた点数**（`myReview.rating`）。付けていない «食べたい» の行では
					出さない（0 個の星を並べると «0 点を付けた» に見える）。
					*/}
					{rating !== null && rating > 0 && (
						<Text style={styles.ratingText} numberOfLines={1} testID="my-dishes-list-item-rating">
							{"★".repeat(Math.round(rating))}
						</Text>
					)}
					{item.restaurant.name ? (
						<Text style={styles.footerText} numberOfLines={1} testID="my-dishes-list-item-restaurant">
							{item.restaurant.name}
						</Text>
					) : null}
					{dishName ? (
						<Text style={styles.footerSubText} numberOfLines={1} testID="my-dishes-list-item-dish">
							{dishName}
						</Text>
					) : null}
					{/* #1398 PR4: want 行だけ。押しても親（= 全画面 Feed への遷移）は走らない */}
					<MyDishEatenButton item={item} onPress={onPressMarkAsEaten} />
				</View>
			</LinearGradient>
		</Pressable>
	);
});

/**
 * @param enabled #1375（5 巡目・性能）取得を始めてよいか。
 *   3 ビューは keep-alive なので、**見えていないビューまで取り直しに行かない**ようにする
 *   （呼び出し元の `my-dishes/index.tsx` が「タブが前面 かつ このビューが選ばれている」を渡す）
 */
export function MyDishesListView({ enabled = true }: { enabled?: boolean } = {}) {
	const styles = useThemedStyles(createStyles);
	const { locale } = useLocale();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { items, isLoading, isLoadingMore, error, hasFetchedInitial, hasNextPage, loadMore, refresh } =
		useMyDishesQuery({ enabled });

	/*
	#1629【オーナー実機報告】「食べたい/食べた タブでログインすると初期に «候補がなく空です» が出てくる」。

	一覧の «読み込み中» の判定が `isLoading` だけだった。`isLoading` は **取得が始まってから**
	true になるので、画面が出てから最初の 1 本が飛ぶまでの数フレームは
	«読み込み中でもない / 行も 0 件» になり、そこで 0 件表示が一瞬描かれていた。
	ログイン直後は認証の解決を待つぶんこの隙間が長く、はっきり «空です» と読めてしまう。

	**まだ 1 度も取り切っていないあいだは «読み込み中» として扱う**（`hasFetchedInitial`）。
	⚠️ 失敗したときは `hasFetchedInitial` が false のままなので、`error` を除外しないと
	   スピナーで固着する（`EmptyState` が再試行を出す側へ渡す必要がある）。
	*/
	const showsInitialLoading = (isLoading || !hasFetchedInitial) && error === null;

	const data = useMemo<MyDishGridItem[]>(() => items.map((item) => ({ id: item.key, item })), [items]);

	/*
	#1375（9 巡目・オーナー指摘「読み込みが重い」）**1 行の実寸を FlatList へ渡す。**

	`GridList` は `getItemLayout` で «高さ 200px» という当てずっぽうの定数を返していた。
	実際のタイルは下（`MyDishCard`）と同じ式で決まり、iPhone 実機では 210 前後になる。
	FlatList は `getItemLayout` の値を実測より優先して信じるので、ずれていると
	**`onEndReached` の発火位置がずれて、要らない次ページまで読みに行く**。
	同じ式をここでも使い、実寸を渡す（式が 2 箇所になるので定数を共有する）。
	*/
	const contentWidth = useContentWidth();
	const itemHeight = useMemo(
		() => (contentWidth - PADDING_HORIZONTAL * 2 - GAP * (COLUMNS - 1)) / COLUMNS / ASPECT_RATIO,
		[contentWidth],
	);

	// #1397 (PR4/5) Q2 確定: リスト項目のタップ先は **全画面 Feed**（#1629 で «その項目 1 件» の
	// スコープへ変えた。以前は «その項目の店舗スコープ»）。
	// 代案（フィルタ済み一覧全体を縦スクロールする Feed）は ids を URL に積むか store 前提にするしか
	// なく、**web のリロード・直リンクで壊れる**ので採らない（設計 (2/2) §9-3 / Q2）。
	//
	// ⚠️ **index ではなく `itemKey` を渡す**（R1）。一覧の並びは写真なしの行を含み、Feed の並びは
	// 含まないので、index を渡すと写真なしが 1 件混ざった瞬間に別の料理が開く。
	// 写真なしの行（`dishMedia === null`）は Feed に入れられないので従来どおり店舗詳細へ。
	/** 店舗詳細へ送る。写真もクチコミも無い行（«食べたい» の行）の落とし先 */
	const openRestaurant = useCallback(
		(item: MyDishItem) => {
			router.push({
				pathname: "/[locale]/restaurant/[restaurantId]",
				params: { locale, restaurantId: item.restaurant.id },
			});
		},
		[locale],
	);

	const handlePressItem = useCallback(
		(item: MyDishItem) => {
			const hasPhoto = item.dishMedia !== null;
			logFrontendEvent({
				event_name: MY_DISHES_EVENTS.listItemSelected,
				error_level: "log",
				payload: { itemKey: item.key, status: item.status, hasPhoto },
			});
			/*
			#1761 写真もクチコミも無い行（«食べたい» の行）だけ、従来どおり店舗詳細へ落とす。
			フィードに置いても白紙のページになるだけで、読むものが無い。
			*/
			if (!hasPhoto && item.myReview === null) {
				openRestaurant(item);
				return;
			}
			/*
			#1629 【設計】**グリッドから開くフィードは «上下だけ»。1 セル = 1 ページ。**

			オーナー指摘「グリッドは上下だけ。同じ店 / 同じ日とかはマップとかカレンダーの話」。
			横（= そのスコープの中の別の記録）に意味があるのは **グルーピングがある入口**
			（Map = 同じ店 / Calendar = 同じ日）だけで、グリッドは何でもまとまっていない。

			以前はここで «店舗 id を重複排除して» 縦の並びとして置いていた。その結果
			**グリッドに 3 セル並んでいる同じ店が縦 1 ページへ潰れ、残り 2 件が横軸へ回っていた**。
			グリッドで見えているセルの数と縦に送れる数が食い違う（12 番目を開いて縦に払っても
			13 番目が出ない）。

			だから重複排除をやめ、**一覧に出ている行をその順のまま**置く。ページャの key は
			`itemKey`（行を一意に指す）なので、同じ店が何行あっても衝突しない。

			#1761 **写真の無い行も置く**（`dishMediaId: null`）。以前はここで除いてボトムシートへ
			逃がしていたが、Calendar / Map が #1752 でフィードへ寄ったので、グリッドだけ器を
			変える理由が無くなった。除くのは «クチコミも無い行» だけ（上の分岐で店舗詳細へ行く）。
			*/
			useMyDishesFeedScopeStore.getState().setListItems(
				items.flatMap((row) =>
					row.dishMedia === null && row.myReview === null
						? []
						: [
								{
									itemKey: row.key,
									dishMediaId: row.dishMedia === null ? null : String(row.dishMedia.id),
									// #1761 直リンク・リロードで «写真の無いページ» の行を引き直すための手がかり
									restaurantId: row.restaurant.id,
								},
							],
				),
			);
			router.push({
				pathname: "/[locale]/(tabs)/my-dishes/feed",
				params: {
					locale,
					scope: "list",
					itemKey: item.key,
					restaurantId: item.restaurant.id,
					...(item.dishMedia === null ? {} : { dishMediaId: String(item.dishMedia.id) }),
				},
			});
		},
		[items, locale, logFrontendEvent, openRestaurant],
	);

	// #1398 (PR4/7) want カードの「食べたを記録」。カード全体のタップ（= 全画面 Feed）とは別経路。
	// 押しても Feed が開かないことは `MyDishEatenButton` 側の stopPropagation が担保する
	const handleMarkAsEaten = useCallback(
		(item: MyDishItem) => {
			const route = buildMarkAsEatenRoute(item, locale);
			if (route === null) return;
			lightImpact();
			logFrontendEvent({
				event_name: MY_DISHES_EVENTS.markAsEatenPressed,
				error_level: "log",
				payload: { itemKey: item.key, from: "list" },
			});
			// #1403 (PR2) 出口（記録の完了）は共有ルート `review-from-media` にあり、そこは
			// my-dishes 以外からも入ってくる。ここで «my-dishes から押した» ことを預けておき、
			// 完了時に取り出して `my_dishes_mark_as_eaten_completed` を出す（markAsEatenFunnel）
			beginMarkAsEaten({
				from: "list",
				itemKey: item.key,
				restaurantId: route.params.restaurantId,
				dishMediaId: route.params.dishMediaId,
				startedAt: Date.now(),
			});
			router.push(route);
		},
		[lightImpact, locale, logFrontendEvent],
	);

	const renderItem = useCallback(
		({ item }: { item: MyDishGridItem }) => (
			<MyDishCard item={item.item} onPress={handlePressItem} onPressMarkAsEaten={handleMarkAsEaten} />
		),
		[handleMarkAsEaten, handlePressItem],
	);

	const renderEmpty = useCallback(
		() => (
			<EmptyState
				message={i18n.t("MyDishes.empty.description")}
				error={error}
				onRetry={refresh}
				testID="my-dishes-empty"
			/>
		),
		[error, refresh],
	);

	// #1396 【設計】終端（nextCursor === null）では onEndReached で何も投げない。
	// 追加取得の同時実行を 1 本に絞るのは store 側（fetchMore）の責務（設計書 (2/2) §4-4）
	const handleEndReached = useCallback(() => {
		if (!hasNextPage) return;
		loadMore();
	}, [hasNextPage, loadMore]);

	return (
		<>
			<GridList
				data={data}
				renderItem={renderItem}
				keyExtractor={(item) => item.id}
				numColumns={COLUMNS}
				contentContainerStyle={styles.gridContent}
				columnWrapperStyle={styles.gridRow}
				isLoading={showsInitialLoading}
				isLoadingMore={isLoadingMore}
				refreshing={isLoading}
				onRefresh={refresh}
				onEndReached={handleEndReached}
				ListEmptyComponent={renderEmpty}
				testID="my-dishes-list"
				itemHeight={itemHeight}
				// my-dishes は collapsible-tabs の外にいる単独ルートなので素の FlatList を使う（#1402 と同じ）
				standalone
			/>
		</>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		gridContent: {
			paddingHorizontal: PADDING_HORIZONTAL,
			paddingVertical: 8,
		},
		gridRow: {
			gap: GAP,
		},
		card: {
			marginBottom: GAP,
			borderRadius: 8,
			overflow: "hidden",
			backgroundColor: c.surfaceSubtle,
		},
		placeholder: {
			alignItems: "center",
			justifyContent: "center",
			gap: 4,
			paddingHorizontal: 6,
			backgroundColor: c.surfaceSubtle,
		},
		placeholderText: {
			fontSize: 10,
			color: c.textSecondary,
			textAlign: "center",
		},
		badgeRow: {
			flexDirection: "row",
			alignItems: "flex-start",
			padding: 6,
			gap: 4,
		},
		statusBadge: {
			paddingHorizontal: 6,
			paddingVertical: 2,
			borderRadius: 10,
		},
		noPhotoBadge: {
			flexDirection: "row",
			alignItems: "center",
			gap: 2,
			paddingHorizontal: 6,
			paddingVertical: 2,
			borderRadius: 10,
			backgroundColor: "rgba(17,24,39,0.6)",
		},
		// #1375（9 巡目）取り込み元のロゴ。バッジ行の **右端**（`marginLeft: "auto"`）へ寄せ、
		// 左の状態バッジ列とぶつからないようにする。丸にするのは «文字のバッジではない» ことを
		// 形でも分けるため
		providerBadge: {
			marginLeft: "auto",
			width: 20,
			height: 20,
			borderRadius: 10,
			alignItems: "center",
			justifyContent: "center",
			backgroundColor: "rgba(17,24,39,0.6)",
		},
		noPhotoBadgeText: {
			fontSize: 9,
			fontWeight: "700",
			color: FixedColors.onMedia,
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
		footer: {
			position: "absolute",
			left: 6,
			right: 6,
			bottom: 6,
			gap: 2,
		},
		ratingText: {
			fontSize: 11,
			fontWeight: "700",
			color: FixedColors.onMedia,
		},
		footerText: {
			fontSize: 11,
			color: FixedColors.onMedia,
		},
		footerSubText: {
			fontSize: 10,
			color: "rgba(255,255,255,0.85)",
		},
	});
