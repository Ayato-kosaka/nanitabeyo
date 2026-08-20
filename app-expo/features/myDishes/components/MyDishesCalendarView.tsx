import React, { memo, useCallback, useMemo } from "react";
import { FlatList, Pressable, StyleSheet, Text, View } from "react-native";
import { Image } from "expo-image";
import { router } from "expo-router";
import { EmptyState } from "@/components/EmptyState";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { PrimaryButton } from "@/components/PrimaryButton";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { getCacheKeyForImage } from "@/lib/image";
import i18n from "@/lib/i18n";
import {
	CALENDAR_WEEKDAY_KEYS,
	buildCalendarMonths,
	canLoadOlderMonths,
	resolveDayThumbnailUrl,
	toDayRange,
	toYearMonth,
	type CalendarDayCell,
	type CalendarMonth,
} from "../calendar";
import { useMyDishesFilterStore } from "../stores/useMyDishesFilterStore";
import { useMyDishesQuery } from "../hooks/useMyDishesQuery";

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
 * ## 副作用の申し送り（§4-5）
 *
 * web ではリスト全体に `transform: scaleY(-1)` が掛かる（セル側は打ち消される）。
 * 月ヘッダを sticky にしない。また DOM 順（最新→過去）が視覚順（過去→最新）と逆になるため、
 * スクリーンリーダーの読み上げ順は視覚順と一致しない。
 */

const WEEKDAY_COUNT = 7;

type DayPressHandler = (cell: CalendarDayCell) => void;

const DayCell = memo(function DayCell({ cell, onPress }: { cell: CalendarDayCell | null; onPress: DayPressHandler }) {
	const handlePress = useCallback(() => {
		if (cell) onPress(cell);
	}, [cell, onPress]);

	if (!cell) return <View style={styles.dayCell} />;

	const count = cell.items.length;
	const representative = count > 0 ? cell.items[0] : null;
	// #1396 【仕様】写真なしの記録（dishMedia === null）でも灰色プレースホルダーにしない。
	// categoryImageUrl → restaurant.image_url の順で実画像へ落とす（#1375 追補2 決定3）
	const thumbnailUrl = representative ? resolveDayThumbnailUrl(representative) : null;

	return (
		<Pressable
			testID={count > 0 ? "my-dishes-calendar-day" : "my-dishes-calendar-day-empty"}
			style={styles.dayCell}
			onPress={handlePress}
			disabled={count === 0}
			accessibilityRole="button"
			accessibilityState={{ disabled: count === 0 }}
			accessibilityLabel={i18n.t("MyDishes.calendar.dayA11yLabel", { date: cell.dateKey, count })}>
			<View style={styles.dayInner}>
				{thumbnailUrl ? (
					<Image
						source={{ uri: thumbnailUrl, cacheKey: getCacheKeyForImage(thumbnailUrl) }}
						cachePolicy="memory-disk"
						transition={100}
						style={StyleSheet.absoluteFill}
						contentFit="cover"
						alt=""
						accessibilityElementsHidden
						importantForAccessibility="no"
					/>
				) : null}
				<Text style={[styles.dayNumber, thumbnailUrl ? styles.dayNumberOnImage : null]}>{cell.day}</Text>
				{count > 1 && (
					<View style={styles.countBadge}>
						<Text style={styles.countBadgeText}>{count}</Text>
					</View>
				)}
			</View>
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
	const weeks = useMemo(() => {
		const rows: (CalendarDayCell | null)[][] = [];
		for (let i = 0; i < month.cells.length; i += WEEKDAY_COUNT) {
			rows.push(month.cells.slice(i, i + WEEKDAY_COUNT));
		}
		return rows;
	}, [month.cells]);

	return (
		<View style={styles.month}>
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

export function MyDishesCalendarView() {
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();
	const patch = useMyDishesFilterStore((s) => s.patch);
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
	} = useMyDishesQuery();

	// 「今月」はマウント時に 1 度だけ決める（毎レンダー new Date() すると months が作り直される）
	const nowYm = useMemo(() => toYearMonth(new Date()), []);
	const months = useMemo(
		() => buildCalendarMonths({ items, nowYm, oldestOccurredAt }),
		[items, nowYm, oldestOccurredAt],
	);

	// #1396 §4-4: 自動ループを書かない。`onEndReached` 1 回につきページ 1 回で、
	// 終了条件は `nextCursor === null`（`hasNextPage === false`）だけ。
	// 足りなければユーザーがもう一度スクロールしたときに次が発火する
	const handleEndReached = useCallback(() => {
		if (!canLoadOlderMonths({ hasNextPage, isLoadingMore })) return;
		loadMore();
	}, [hasNextPage, isLoadingMore, loadMore]);

	// #1396 §4-5: 日セルタップで期間（from / to）を確定し、リストビューへ切り替える。
	// 3 ビューが同じフィルタ状態を共有していることの、そのままのデモになる
	const handlePressDay = useCallback(
		(cell: CalendarDayCell) => {
			if (cell.items.length === 0) return;
			lightImpact();
			const range = toDayRange(cell.dateKey);
			logFrontendEvent({
				event_name: "my_dishes_calendar_day_selected",
				error_level: "log",
				payload: { date: cell.dateKey, count: cell.items.length },
			});
			patch({ from: range.from, to: range.to });
			router.setParams({ view: "list" });
		},
		[lightImpact, logFrontendEvent, patch],
	);

	// #1396 PR4 レビュー M-1: 失敗をユーザーに伝え、手動リトライの出口を必ず UI に出す。
	// `hasFetchedInitial` は成功時にしか立たないので、これでガードすると
	// 「失敗したことが伝わらないまま復帰不能」になる（Map ビューで実際に踏んだ形）。
	// error があれば `hasFetchedInitial` に関係なくエラー + 再試行を出す。
	const retryOlder = useCallback(() => {
		if (hasNextPage) loadMore();
		else refresh();
	}, [hasNextPage, loadMore, refresh]);

	const renderMonth = useCallback(
		({ item }: { item: CalendarMonth }) => <MonthGrid month={item} onPressDay={handlePressDay} />,
		[handlePressDay],
	);

	// inverted なので ListFooterComponent は**視覚的な最上部**（= 一番古い月の上）に出る
	const renderFooter = useCallback(() => {
		if (error !== null) {
			return (
				<View style={styles.footer} testID="my-dishes-calendar-load-error">
					<Text style={styles.footerErrorText}>{error}</Text>
					<PrimaryButton
						label={i18n.t("Profile.tabError.retry")}
						onPress={retryOlder}
						testID="my-dishes-calendar-load-error-retry"
					/>
				</View>
			);
		}
		if (isLoadingMore) {
			return (
				<View style={styles.footer} testID="my-dishes-calendar-loading-more">
					<LoadingIndicator size="small" />
				</View>
			);
		}
		if (!hasNextPage && hasFetchedInitial) {
			return (
				<View style={styles.footer} testID="my-dishes-calendar-reached-oldest">
					<Text style={styles.footerText}>{i18n.t("MyDishes.calendar.reachedOldest")}</Text>
				</View>
			);
		}
		return null;
	}, [error, hasFetchedInitial, hasNextPage, isLoadingMore, retryOlder]);

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
			<View style={[styles.container, styles.centered]} testID="my-dishes-calendar">
				<LoadingIndicator size="large" />
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
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		flex: 1,
	},
	centered: {
		alignItems: "center",
		justifyContent: "center",
	},
	listContent: {
		paddingHorizontal: 12,
		paddingVertical: 8,
	},
	month: {
		marginBottom: 20,
	},
	monthLabel: {
		fontSize: 15,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 8,
	},
	weekdayRow: {
		flexDirection: "row",
		marginBottom: 4,
	},
	weekdayLabel: {
		flex: 1,
		textAlign: "center",
		fontSize: 10,
		color: "#9CA3AF",
	},
	weekRow: {
		flexDirection: "row",
	},
	dayCell: {
		flex: 1,
		aspectRatio: 1,
		padding: 1,
	},
	dayInner: {
		flex: 1,
		borderRadius: 4,
		overflow: "hidden",
		backgroundColor: "#F3F4F6",
		alignItems: "center",
		justifyContent: "center",
	},
	dayNumber: {
		fontSize: 11,
		color: "#6B7280",
	},
	dayNumberOnImage: {
		color: "#FFFFFF",
		fontWeight: "700",
		textShadowColor: "rgba(0,0,0,0.6)",
		textShadowRadius: 3,
	},
	countBadge: {
		position: "absolute",
		right: 2,
		bottom: 2,
		minWidth: 14,
		paddingHorizontal: 3,
		borderRadius: 7,
		backgroundColor: "rgba(17,24,39,0.75)",
		alignItems: "center",
	},
	countBadgeText: {
		fontSize: 9,
		fontWeight: "700",
		color: "#FFFFFF",
	},
	footer: {
		alignItems: "center",
		gap: 12,
		paddingVertical: 16,
	},
	footerText: {
		fontSize: 12,
		color: "#9CA3AF",
		textAlign: "center",
	},
	footerErrorText: {
		fontSize: 13,
		color: "#B91C1C",
		textAlign: "center",
	},
});
