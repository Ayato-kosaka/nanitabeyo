import React, { memo, useCallback, useMemo, useRef } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { EmptyState } from "@/components/EmptyState";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { PrimaryButton } from "@/components/PrimaryButton";
import { FixedColors, type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import { getCacheKeyForImage } from "@/lib/image";
import i18n from "@/lib/i18n";
import {
	CALENDAR_WEEKDAY_KEYS,
	buildCalendarMonths,
	canLoadOlderMonths,
	isoToLocalDateKey,
	resolveDayThumbnailUrl,
	shouldIgnoreEndReached,
	toYearMonth,
	type CalendarDayCell,
	type CalendarMonth,
} from "../calendar";
import { MY_DISHES_EVENTS } from "../analytics";
import { useMyDishesFeedScopeStore } from "../stores/useMyDishesFeedScopeStore";
import { useMyDishesCalendarQuery } from "../hooks/useMyDishesCalendarQuery";
import { countMyDishStatuses } from "@/features/myDishes/statusColors";
import { MyDishStatusLegend } from "@/features/myDishes/components/MyDishStatusLegend";
import { MyDishStatusCountBadges } from "@/features/myDishes/components/MyDishStatusCountBadges";
import { DeletedMediaTombstone } from "@/components/DeletedMediaTombstone";

/**
 * #1396 my-dishes の Calendar ビュー（設計書 (2/2) §4 / §7 の PR5）。
 *
 * ## Instagram のストーリーアーカイブと同じ UX：上へスクロールして過去へ遡る
 *
 * ## なぜ `inverted` FlatList なのか（§4-2。native と web の両方で動く唯一の手）
 *
 * | 方式 | 必要な API | 実測 |
 * | --- | --- | --- |
 * | 通常リスト + 先頭に prepend | `maintainVisibleContentPosition` | ❌ `react-native-web@0.21.2` の `dist/` に該当文字列が **0 件**。prepend のたびにスクロール位置が飛ぶ |
 * | 通常リスト + `onStartReached` | `onStartReached` | △ API は両者にあるが、prepend 時のスクロール位置維持は結局 `maintainVisibleContentPosition` 頼みで web に無い |
 * | **`inverted` + `onEndReached`** | `inverted` | ✅ RN 本体（`@react-native/virtualized-lists@0.81.5` の `VirtualizedList.js`）は `inversionStyle` をコンテナと各セルに適用し、react-native-web の vendored `VirtualizedList` には `REACT-NATIVE-WEB patch ... Support inverted wheel scroller.` が明示的に入っている |
 *
 * `inverted` では `data[0]` が画面**下端**（= 最新月）になり、`onEndReached` は
 * 「視覚的な上端に到達」で発火する。追加分はリストの末尾（= 視覚的な上）へ足されるので、
 * スクロール位置のアンカー（下端）が動かない。だから `maintainVisibleContentPosition` が要らない。
 *
 * ## `onEndReached` に自動ループを書かない（§4-4。確定事項2）
 *
 * `limit` 既定 42 は「件数」であって「月数」ではない。42 件が全部同じ月に入ると 1 ページ読んでも
 * 月が 1 つも増えないので、「一番古い月が完成するまで読む」ようなループを書くと暴走する。
 * ページ 1 回 = `onEndReached` 1 回に対応させ、終了条件は `nextCursor === null` だけにする。
 *
 * ⚠️ **`isLoadingMore` ガードだけでは足りない**（#1446 B-1 / M-1）。`onEndReached` は
 * 「contentLength が前回発火時と違う」だけで再発火し、スクロール以外（`_onContentSizeChange` /
 * `_onLayout`）からも判定が走る。したがって
 *
 * 1. `error === null` を `canLoadOlderMonths` の条件に入れる（エラー中の入口は再試行ボタンだけ）
 * 2. **フッタの高さを状態に依らず一定にする**（スピナー枠を常に確保する）
 * 3. **直前の `loadMore` で月が 1 つも増えなかったら次の `onEndReached` を無視する**
 *
 * の 3 つを揃えて初めて「指を離したままの自動連投」が止まる。1 と 3 の判定は
 * `../calendar.ts`（`canLoadOlderMonths` / `shouldIgnoreEndReached`）に純ロジックとして置いてある。
 *
 * ## 取得は Calendar 専用の派生 queryKey（#1446 M-2）
 *
 * `sort` が `-occurredAt` 以外だとページが日付順で届かず、Calendar として成立しない。
 * `useMyDishesCalendarQuery` が `sort` / `sceneKey` / `timeSlotKey` を落として読む
 * （#1397 PR2 の `selectRestaurantQueryKey` と同じ作法）。共有 `sort` が既定なら
 * base と同一キーなので、常用ケースでは追加の取得も LRU 消費も起きない。
 *
 * ## 副作用の申し送り（§4-5）
 *
 * web ではリスト全体に `transform: scaleY(-1)` が掛かる（セル側は打ち消される）。
 * 月ヘッダを sticky にしない。また DOM 順（最新→過去）が視覚順（過去→最新）と逆になるため、
 * スクリーンリーダーの読み上げ順は視覚順と一致しない。
 */

const WEEKDAY_COUNT = 7;

/**
 * #1513 墓標の上に残す日付の数字の色。
 *
 * この画面の既定（`dayNumberRecorded` の `#111827`）はダークで墓標の面に沈むため、
 * 墓標の上だけテーマ追従のトークン（ライト `#111827` / ダーク `#E5E2E1`）へ差し替える。
 * ファクトリはモジュールスコープに置く（`useThemedStyles` の useMemo を効かせるため）。
 */
const createDeletedDayStyles = (colors: Palette) =>
	StyleSheet.create({
		dayNumber: { color: colors.textPrimaryAlt, fontWeight: "700" },
	});

type DayPressHandler = (cell: CalendarDayCell) => void;

const DayCell = memo(function DayCell({ cell, onPress }: { cell: CalendarDayCell | null; onPress: DayPressHandler }) {
	const styles = useThemedStyles(createStyles);
	const handlePress = useCallback(() => {
		if (cell) onPress(cell);
	}, [cell, onPress]);

	const count = cell?.items.length ?? 0;
	// #1375 実機確認（5 巡目）: 1 つの黒バッジに合計を出していたが、その日に «行きたい» が
	// 何件で «食べた» が何件かは読めなかった。緑 / 赤に割って両方出す
	const counts = useMemo(() => countMyDishStatuses(cell?.items ?? []), [cell?.items]);
	const representative = cell && count > 0 ? cell.items[0] : null;
	// #1396 【仕様】写真なしの記録（dishMedia === null）でも灰色プレースホルダーにしない。
	// categoryImageUrl → restaurant.image_url の順で実画像へ落とす（#1375 追補2 決定3）
	//
	// #1513 代表の行が «自分の投稿が削除済み» のときはフォールバックせず墓標を出す。
	// 日付の数字は墓標の上に残す（記録がある日であることは変わらないため）ので、
	// 数字の色だけテーマ追従のトークンで塗り直す（この画面の既定 #111827 はダークで沈む）
	const isDeleted = representative?.isOwnMediaDeleted === true;
	const deletedStyles = useThemedStyles(createDeletedDayStyles);
	const thumbnailUrl = representative && !isDeleted ? resolveDayThumbnailUrl(representative) : null;
	// `source` は memo で identity を固定する（MyDishesListView と同じ作法。
	// インラインで作ると expo-image に毎レンダー新しい source が渡る。独立レビュー指摘）
	const source = useMemo(
		() => (thumbnailUrl ? { uri: thumbnailUrl, cacheKey: getCacheKeyForImage(thumbnailUrl) } : null),
		[thumbnailUrl],
	);

	if (!cell) return <View style={styles.dayCell} />;

	return (
		<Pressable
			testID={count > 0 ? "my-dishes-calendar-day" : "my-dishes-calendar-day-empty"}
			style={styles.dayCell}
			onPress={handlePress}
			disabled={count === 0}
			accessibilityRole="button"
			accessibilityState={{ disabled: count === 0 }}
			accessibilityLabel={i18n.t("MyDishes.calendar.dayA11yLabel", { date: cell.dateKey, count })}>
			{/* #1375 実機確認: 記録が無い日は «空の器» を描かない。Instagram のストーリーアーカイブと
			    同じく、日付の数字だけが淡く残る。記録がある日だけが円形のサムネイルとして浮き上がるので、
			    「どの日に記録があるか」が一目でわかる（以前は全日が同じ灰色の角丸で埋まっていた） */}
			{isDeleted ? (
				<>
					{/* #1513 自分の投稿が削除済みの日。日付は残し、写真の枠だけ墓標に差し替える */}
					<View style={styles.dayCircle}>
						<DeletedMediaTombstone variant="cell" style={StyleSheet.absoluteFill} />
						<Text style={[styles.dayNumber, deletedStyles.dayNumber]}>{cell.day}</Text>
					</View>
					<View style={styles.countBadgeRow}>
						<MyDishStatusCountBadges counts={counts} testIDPrefix="my-dishes-calendar-day-count" />
					</View>
				</>
			) : source ? (
				<>
					<View style={styles.dayCircle}>
						<Image
							source={source}
							cachePolicy="memory-disk"
							transition={100}
							/* #1375（9 巡目）セルの使い回しで «前の日の写真が一瞬残る» のを防ぐ。
							   理由は MyDishesListView の同じ prop のコメントを参照 */
							recyclingKey={cell.dateKey}
							style={StyleSheet.absoluteFill}
							contentFit="cover"
							alt=""
							accessibilityElementsHidden
							importantForAccessibility="no"
						/>
						{/* 画像の上に数字を直接置くと明るい写真で読めなくなるので、薄い暗幕を敷く */}
						<View style={styles.dayScrim} />
						<Text style={[styles.dayNumber, styles.dayNumberOnImage]}>{cell.day}</Text>
					</View>
					{/* ⚠️ 件数バッジは **円の外（セル側）**に置く。円は `overflow: "hidden"` の丸マスクなので、
					    中に置くと角が欠けて半月状に切れる（実 UI レビューで発見） */}
					{/* ⚠️ 円の **外**（セル側）に置くこと。円は overflow:"hidden" の丸マスクなので、
					    中へ入れると角が欠けて半月状に切れる（実 UI レビューで発見） */}
					<View style={styles.countBadgeRow}>
						<MyDishStatusCountBadges counts={counts} testIDPrefix="my-dishes-calendar-day-count" />
					</View>
				</>
			) : (
				<>
					<View style={styles.dayCircle}>
						<Text style={[styles.dayNumber, count > 0 ? styles.dayNumberRecorded : styles.dayNumberEmpty]}>
							{cell.day}
						</Text>
					</View>
					{/* 画像が引けなかった日も内訳は出す（数字だけの日が «記録ゼロ» に見えないように） */}
					<View style={styles.countBadgeRow}>
						<MyDishStatusCountBadges counts={counts} testIDPrefix="my-dishes-calendar-day-count" />
					</View>
				</>
			)}
		</Pressable>
	);
});

const MonthGrid = memo(function MonthGrid({
	month,
	onPressDay,
}: {
	month: CalendarMonth;
	onPressDay: DayPressHandler;
}) {
	const styles = useThemedStyles(createStyles);
	const weeks = useMemo(() => {
		const rows: (CalendarDayCell | null)[][] = [];
		for (let i = 0; i < month.cells.length; i += WEEKDAY_COUNT) {
			rows.push(month.cells.slice(i, i + WEEKDAY_COUNT));
		}
		return rows;
	}, [month.cells]);

	return (
		// testID に ym を持たせるのは e2e-web（Playwright）が「上へ遡ると古い月が増える」ことを
		// 月単位で確かめるため（#1446 M-3）
		<View style={styles.month} testID={`my-dishes-calendar-month-${month.ym}`}>
			{/* #1396 §4-5: sticky にしない（inverted で web の scaleY(-1) と噛み合わない） */}
			<Text style={styles.monthLabel}>
				{i18n.t("MyDishes.calendar.monthLabel", { year: month.year, month: month.month })}
			</Text>
			<View style={styles.weekdayRow}>
				{CALENDAR_WEEKDAY_KEYS.map((key) => (
					<Text key={key} style={styles.weekdayLabel}>
						{i18n.t(`MyDishes.calendar.weekdays.${key}`)}
					</Text>
				))}
			</View>
			{weeks.map((week, index) => (
				<View key={`${month.ym}-w${index}`} style={styles.weekRow}>
					{week.map((cell, cellIndex) => (
						<DayCell
							key={cell ? cell.dateKey : `${month.ym}-pad${index}-${cellIndex}`}
							cell={cell}
							onPress={onPressDay}
						/>
					))}
				</View>
			))}
		</View>
	);
});

/**
 * @param enabled #1375（5 巡目・性能）取得を始めてよいか。
 *   3 ビューは keep-alive なので、**見えていないビューまで取り直しに行かない**ようにする
 *   （呼び出し元の `my-dishes/index.tsx` が「タブが前面 かつ このビューが選ばれている」を渡す）
 */
export function MyDishesCalendarView({ enabled = true }: { enabled?: boolean } = {}) {
	const styles = useThemedStyles(createStyles);
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const { locale } = useLocale();
	const {
		items,
		isLoading,
		isLoadingMore,
		error,
		hasFetchedInitial,
		hasNextPage,
		oldestOccurredAt,
		loadMore,
		refresh,
	} = useMyDishesCalendarQuery({ enabled });

	// 「今月」はマウント時に 1 度だけ決める（毎レンダー new Date() すると months が作り直される）。
	// ⚠️ #1446 m-4（申し送り・本 PR では直さない）: keep-alive でアンマウントされないため、
	// アプリを開いたまま日付が変わっても「今月」は更新されない。その月に記録が入れば
	// `newestItemYm` 経由で救われるので実害は小さいと判断してリーダーが見送りとした。
	// 直すなら `nowYm` を state にして「日付が変わったときだけ」更新する（毎レンダー new Date() はしない）
	const nowYm = useMemo(() => toYearMonth(new Date()), []);
	// 前回の結果を渡し、中身が変わっていない月は**同じオブジェクト**を返してもらう。
	// これで行が 1 件増えても、変わった月以外は MonthGrid / DayCell の memo が効く（独立レビュー指摘）
	const previousMonthsRef = useRef<ReturnType<typeof buildCalendarMonths>>([]);
	const months = useMemo(() => {
		const next = buildCalendarMonths({ items, nowYm, oldestOccurredAt, previousMonths: previousMonthsRef.current });
		previousMonthsRef.current = next;
		return next;
	}, [items, nowYm, oldestOccurredAt]);

	// #1446 M-1: 直前に `loadMore` を投げた時点の月数。次の `onEndReached` の判定にだけ使う。
	// state にすると再レンダーを増やすだけなので ref で持つ（描画には一切使わない）
	const monthCountAtLastLoadRef = useRef<number | null>(null);

	// #1396 §4-4: 自動ループを書かない。`onEndReached` 1 回につきページ 1 回で、
	// 終了条件は `nextCursor === null`（`hasNextPage === false`）だけ。
	// 足りなければユーザーがもう一度スクロールしたときに次が発火する
	const handleEndReached = useCallback(() => {
		// #1446 B-1: エラー中は握り潰す。再取得の入口はフッタの再試行ボタンだけ
		if (!canLoadOlderMonths({ hasNextPage, isLoadingMore, error })) return;
		// #1446 M-1: 直前の loadMore で月が 1 つも増えなかったら、この 1 回は無視する。
		// （42 件が同一月に収まると月グリッドの高さが増えないため、フッタ高の往復だけで連投しうる）
		if (shouldIgnoreEndReached({ monthCountAtLastLoad: monthCountAtLastLoadRef.current, monthCount: months.length })) {
			monthCountAtLastLoadRef.current = null;
			return;
		}
		monthCountAtLastLoadRef.current = months.length;
		loadMore();
	}, [error, hasNextPage, isLoadingMore, loadMore, months.length]);

	// #1375 実機確認: 日セルタップは **Dish Feed へ遷移**する。
	//
	// 以前は共有フィルタへ期間（from / to）を書いてリストビューへ切り替えていた。
	// 3 ビューがフィルタを共有していることのデモとしては素直だったが、
	// 「1 日を見に行ったつもりが、戻ってきても絞り込みが残っている」状態を作っていた
	// （その戻り道として «この期間で絞り込み中» の帯まで必要になっていた）。
	// Feed へ push すれば、閉じれば元の Calendar がそのまま残る。
	//
	// Feed 側では **縦 = その日の記録、横 = 前後の日** になる（`my-dishes/feed.tsx`）。
	const handlePressDay = useCallback(
		(cell: CalendarDayCell) => {
			if (cell.items.length === 0) return;
			lightImpact();
			logFrontendEvent({
				event_name: MY_DISHES_EVENTS.calendarDaySelected,
				error_level: "log",
				payload: { date: cell.dateKey, count: cell.items.length },
			});
			// #1375 実機確認（2 巡目）: 縦フリックで行き来するのは **記録がある日だけ**にする。
			// ±1 日の計算だと隣の日が空で「見つかりません」ページが挟まる。読み込み済みの
			// 全記録から «記録がある日» の昇順を作り、遷移直前に scope store へ置く
			// （Map がピンの並びを置くのと同じ作法）
			const dateKeys = Array.from(
				new Set(items.map((item) => isoToLocalDateKey(item.occurredAt)).filter((key): key is string => key !== null)),
			).sort();
			useMyDishesFeedScopeStore.getState().setDateKeys(dateKeys);
			const first = cell.items.find((item) => item.dishMedia !== null) ?? cell.items[0];
			router.push({
				pathname: "/[locale]/(tabs)/my-dishes/feed",
				params: {
					locale,
					scope: "date",
					date: cell.dateKey,
					...(first ? { itemKey: first.key } : {}),
					...(first?.dishMedia ? { dishMediaId: String(first.dishMedia.id) } : {}),
				},
			});
		},
		[items, lightImpact, locale, logFrontendEvent],
	);

	// #1396 PR4 レビュー M-1: 失敗をユーザーに伝え、手動リトライの出口を必ず UI に出す。
	// `hasFetchedInitial` は成功時にしか立たないので、これでガードすると
	// 「失敗したことが伝わらないまま復帰不能」になる（Map ビューで実際に踏んだ形）。
	// error があれば `hasFetchedInitial` に関係なくエラー + 再試行を出す。
	//
	// #1446 m-2【意図】`hasNextPage === false` なのにフッタへエラーが出るのは
	// 「既に月が読めている状態で refresh（= fetchInitial）が失敗した」ときだけなので、
	// その場合は先頭ページから取り直す `refresh()` が正しい復帰手段である（非対称だが意図的）。
	const retryOlder = useCallback(() => {
		if (hasNextPage) loadMore();
		else refresh();
	}, [hasNextPage, loadMore, refresh]);

	const renderMonth = useCallback(
		({ item }: { item: CalendarMonth }) => <MonthGrid month={item} onPressDay={handlePressDay} />,
		[handlePressDay],
	);

	// inverted なので ListFooterComponent は**視覚的な最上部**（= 一番古い月の上）に出る。
	//
	// ⚠️ #1446 M-1: **フッタは常に描き、スピナー枠の高さを状態に依らず一定にする。**
	// 「スピナー（高さあり）↔ null（高さ 0）」で往復すると contentLength が往復し、
	// `contentLength !== _sentEndForContentLength` が成立し続けて `onEndReached` が
	// 指を離したまま再発火する（= 自動連投）。空の View を返して枠を確保するのが肝で、
	// 「読み込み中だけ描く」に戻してはいけない。
	const renderFooter = useCallback(
		() => (
			<View style={styles.footer} testID="my-dishes-calendar-footer">
				<View style={styles.footerSpinnerSlot}>
					{isLoadingMore ? (
						<View testID="my-dishes-calendar-loading-more">
							<LoadingIndicator size="small" />
						</View>
					) : null}
				</View>
				{error !== null ? (
					<View style={styles.footerBlock} testID="my-dishes-calendar-load-error">
						<Text style={styles.footerErrorText}>{error}</Text>
						<PrimaryButton
							label={i18n.t("Profile.tabError.retry")}
							onPress={retryOlder}
							testID="my-dishes-calendar-load-error-retry"
						/>
					</View>
				) : null}
				{error === null && !hasNextPage && hasFetchedInitial ? (
					<View style={styles.footerBlock} testID="my-dishes-calendar-reached-oldest">
						<Text style={styles.footerText}>{i18n.t("MyDishes.calendar.reachedOldest")}</Text>
					</View>
				) : null}
			</View>
		),
		[error, hasFetchedInitial, hasNextPage, isLoadingMore, retryOlder],
	);

	// #1375 実機確認: 「この期間で絞り込み中」の帯は廃止した。日セルタップが
	// フィルタを書かなくなった（Feed へ push する）ので、そもそも立たなくなったためである。
	// 1 行も読めていない状態での失敗は、月グリッドを出しても意味が無いので全面をエラーにする。
	// ここも `hasFetchedInitial` では判定しない（成功時にしか立たないため）
	if (error !== null && items.length === 0) {
		return (
			<View style={styles.container} testID="my-dishes-calendar">
				<EmptyState
					message={i18n.t("MyDishes.empty.description")}
					error={error}
					onRetry={refresh}
					testID="my-dishes-calendar-empty"
				/>
			</View>
		);
	}

	if (isLoading && !hasFetchedInitial) {
		return (
			<View style={styles.container} testID="my-dishes-calendar">
				<View style={[styles.container, styles.centered]}>
					<LoadingIndicator size="large" />
				</View>
			</View>
		);
	}

	if (hasFetchedInitial && items.length === 0) {
		return (
			<View style={styles.container} testID="my-dishes-calendar">
				<EmptyState message={i18n.t("MyDishes.empty.description")} testID="my-dishes-calendar-empty" />
			</View>
		);
	}

	return (
		<View style={styles.container} testID="my-dishes-calendar">
			<FlatList
				testID="my-dishes-calendar-list"
				// ★ ここが本ビューの肝。data[0] が画面下端（最新月）になり、
				//   onEndReached が「視覚的な上端」で発火する（§4-2）
				inverted
				data={months}
				keyExtractor={(month) => month.ym}
				renderItem={renderMonth}
				onEndReached={handleEndReached}
				onEndReachedThreshold={0.5}
				ListFooterComponent={renderFooter}
				initialNumToRender={2}
				windowSize={5}
				contentContainerStyle={styles.listContent}
				showsVerticalScrollIndicator={false}
			/>
			{/* #1375 実機確認（5 巡目）: 日バッジの緑 / 赤が何を指すかを画面の最下部で明かす。
			    ⚠️ inverted なリストの中へ入れないこと（scaleY(-1) で上下が反転して読めなくなる）。
			    リストの外へ固定して置くのが正しい */}
			<MyDishStatusLegend style={styles.legend} testID="my-dishes-calendar-legend" />
		</View>
	);
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
		},
		centered: {
			alignItems: "center",
			justifyContent: "center",
		},
		listContent: {
			paddingHorizontal: 16,
			paddingVertical: 12,
		},
		// #1375（9 巡目・オーナー指摘）**凡例に «ボックス» を作らない。左寄せにする。**
		// 上罫線を引くと «下に別の領域がある» ように見え、日付グリッドと切り離されて読める。
		// 凡例は日付グリッドの注釈なので、罫線を外して同じ左端（グリッドと同じ 16）へ揃える。
		// ⚠️ 中央寄せは MyDishStatusLegend 側の既定（`justifyContent: "center"`）なので、
		//    ここで打ち消す。部品側の既定を変えるとマップ下部シートの見出し行も動く
		legend: {
			justifyContent: "flex-start",
			paddingHorizontal: 16,
			paddingVertical: 10,
		},
		// #1375 実機確認: 月と月のあいだを広く取る。詰めると «どこからが次の月か» が読めない
		month: {
			marginBottom: 28,
		},
		// Instagram のストーリーズアーカイブと同じく **中央寄せ**。左寄せだと表ではなく見出しに見える
		monthLabel: {
			fontSize: 20,
			fontWeight: "700",
			color: c.textPrimaryAlt,
			textAlign: "center",
			marginBottom: 14,
		},
		weekdayRow: {
			flexDirection: "row",
			marginBottom: 4,
		},
		weekdayLabel: {
			flex: 1,
			textAlign: "center",
			fontSize: 14,
			color: c.textSecondary,
		},
		weekRow: {
			flexDirection: "row",
		},
		// #1375 実機確認（2 巡目）: 縦幅を詰める。正方形セル（aspectRatio: 1）だと行の高さが
		// 列幅そのままになり縦に間延びするので、円の直径をセル幅より小さい固定値にして
		// 行の高さもそれに合わせる
		dayCell: {
			flex: 1,
			// #1375（5 巡目・デザインレビュー #23）円がセル幅の 94%（48/51.1）で、
			// 記録が続く週は円が繋がって 1 本の帯に見えていた。要素は減らさず余白だけ作る
			height: 58,
			alignItems: "center",
			justifyContent: "center",
		},
		// 円形。`borderRadius: 999` ではなく `overflow: hidden` と併せて正円にする
		dayCircle: {
			width: 44,
			height: 44,
			borderRadius: 22,
			overflow: "hidden",
			alignItems: "center",
			justifyContent: "center",
		},
		dayScrim: {
			...StyleSheet.absoluteFillObject,
			backgroundColor: "rgba(0,0,0,0.18)",
		},
		dayNumber: {
			fontSize: 17,
			fontWeight: "600",
		},
		// 記録が無い日。円も背景も描かず、数字だけを灰で残す（参考画像はかなりはっきり見える灰）
		dayNumberEmpty: {
			color: c.textTertiary,
		},
		// 記録はあるがサムネイルが引けなかった日（画像 URL が無い）。数字を濃く残して押せると示す
		dayNumberRecorded: {
			color: c.textPrimaryAlt,
			fontWeight: "700",
		},
		dayNumberOnImage: {
			color: FixedColors.onMedia,
			fontWeight: "700",
			textShadowColor: "rgba(0,0,0,0.6)",
			// #1446 n-2: offset は既定値（{0,0}）でも、明示しないと web / native で解釈が揃う保証が無い
			textShadowOffset: { width: 0, height: 1 },
			textShadowRadius: 3,
		},
		countBadgeRow: {
			position: "absolute",
			right: 2,
			bottom: 0,
		},
		footer: {
			alignItems: "center",
			paddingVertical: 16,
		},
		// #1446 M-1: スピナーの有無で高さを変えないための固定枠。
		// ここを可変にすると contentLength が往復し、`onEndReached` が自動連投になる
		footerSpinnerSlot: {
			height: 24,
			alignItems: "center",
			justifyContent: "center",
		},
		footerBlock: {
			alignItems: "center",
			gap: 12,
			paddingTop: 8,
		},
		footerText: {
			fontSize: 12,
			color: c.textTertiary,
			textAlign: "center",
		},
		footerErrorText: {
			fontSize: 13,
			color: c.dangerEmphasis,
			textAlign: "center",
		},
	});
