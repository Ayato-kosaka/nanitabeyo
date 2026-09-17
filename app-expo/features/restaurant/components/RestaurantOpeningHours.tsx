/*
#1666 店舗詳細に «通常の 1 週間の営業時間» を出す。

## なぜこの画面に無かったのか

営業時間は **集めるところ**（OSM ローダ / 公式サイトのクローラ）と **絞り込みに使うところ**
（#288 の時間帯フィルタ）が先に出来ていて、**ユーザーが見るところだけが無かった**。
「保存できた」は納品条件ではなく、「保存したものをユーザーが使えた」が納品条件である
（CLAUDE.md「全方位レビュー」の #1375 の事故と同じ形）。

## ⚠️ «営業中» のバッジは出さない

判定（`shared/utils/openingHours.ts` の `resolveOpeningStatus`）は **JST 固定**である。
店ごとのタイムゾーンを解決する仕組みがまだ無く、dev には韓国にある店が居る（#1881）。
JST で «営業中» と書くと、その店では嘘になる。

一方 `opens_at` / `closes_at` は **店の現地時刻**（TIME 型・タイムゾーン無し）なので、
時刻そのものはどの国の店でもそのまま出してよい。だから **一覧だけ**を出す。

## ⚠️ «その曜日に行が無い» は «定休» である。«不明» ではない

これは `resolveOpeningStatus` が既に採っている読み方で、営業時間データが 1 件でもあれば
窓に重ならない日を `closed` と判定する。表示だけ «不明» と書くと、
**絞り込みでは消える店が、詳細では «分からない» と出る**。

営業時間が 1 件も無い店では、**この欄ごと出さない**（「情報なし」とも書かない。
#1667 でレビュー 0 件のときに «何も出さない» と決めたのと同じ扱い）。
*/

import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { Clock } from "lucide-react-native";
import i18n from "@/lib/i18n";
import { useThemedStyles, useAppTheme } from "@/contexts/ThemeProvider";
import { type Palette } from "@/constants/Palette";
// ⚠️ 曜日の並び・ラベルはカレンダーと同じものを使う（週の始まりは日曜固定 = §4-1）。
//    ここへ ["月","火",…] を書き写すと、カレンダーと店舗詳細で週の始まりがずれる。
import { CALENDAR_WEEKDAY_KEYS } from "@/features/myDishes/calendar";
import type { GetRestaurantOpeningHoursResponse } from "@shared/api/v1/res";

/*
⚠️ **このコンポーネントは自分で取りに行かない。** 取得は
`features/restaurant/hooks/useRestaurantOpeningHours.ts` が持ち、画面が渡す。
理由はそのファイルの冒頭に書いてある（import グラフに `lib/supabase` が入り、
この画面を描く既存テストが suite ごと落ちた）。
*/
type Props = { hours: GetRestaurantOpeningHoursResponse | null };

/** `18:00–02:00` のような日またぎは、閉店側に «翌» を付ける（付けないと 8 時間営業に見える） */
function formatSpan(span: { opensAt: string; closesAt: string; crossesMidnight: boolean }): string {
	const closesAt = span.crossesMidnight
		? i18n.t("Restaurant.detail.openingHours.nextDay", { time: span.closesAt })
		: span.closesAt;
	return `${span.opensAt}–${closesAt}`;
}

export function RestaurantOpeningHours({ hours }: Props) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();

	/*
	データが無い店では欄ごと出さない（上の設計コメント）。

	⚠️ `days` が **配列であること自体を確かめる**。`hours.days.length` だけを見ていたら、
	   想定外の応答（この API を持たない古い API の 404 本文など）で
	   `Cannot read properties of undefined` になり、**店舗詳細ごと落ちた**（実測）。
	   営業時間は «あれば出す» 情報で、これが原因で店の画面が開けないのは割に合わない。
	*/
	if (!hours || !Array.isArray(hours.days) || hours.days.length === 0) return null;

	return (
		<View style={styles.container} testID="restaurant-opening-hours">
			<View style={styles.titleRow}>
				<Clock size={16} color={colors.textSecondary} />
				<Text style={styles.title}>{i18n.t("Restaurant.detail.openingHours.title")}</Text>
			</View>

			{CALENDAR_WEEKDAY_KEYS.map((key, dayOfWeek) => {
				const day = hours.days.find((d) => d.dayOfWeek === dayOfWeek);
				const spans = day?.spans ?? [];
				return (
					<View key={key} style={styles.dayRow} testID={`restaurant-opening-hours-day-${dayOfWeek}`}>
						<Text style={styles.dayLabel}>{i18n.t(`MyDishes.calendar.weekdays.${key}`)}</Text>
						<Text style={styles.daySpans}>
							{spans.length === 0
								? i18n.t("Restaurant.detail.openingHours.closed")
								: spans.map(formatSpan).join("  ")}
						</Text>
					</View>
				);
			})}

			{/* #1666 完了条件「**出所・鮮度を含めて**保持 / 表示できる」。
			    出所は曜日ごとに違いうるので、実際に採られたものを全部並べる（片方を偽らない） */}
			<Text style={styles.provenance} testID="restaurant-opening-hours-provenance">
				{i18n.t("Restaurant.detail.openingHours.provenance", {
					sources: hours.sources
						.map((source) =>
							i18n.t(`Restaurant.detail.openingHours.sources.${source}`, {
								defaultValue: source,
							}),
						)
						.join(" / "),
					date: hours.fetchedAt ? hours.fetchedAt.slice(0, 10) : "",
				})}
			</Text>
		</View>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		container: { marginTop: 14 },
		titleRow: { flexDirection: "row", alignItems: "center", gap: 6, marginBottom: 6 },
		// §2 セクション見出しは 14–15 / 700
		title: { fontSize: 14, fontWeight: "700", color: colors.textStrong },
		dayRow: { flexDirection: "row", alignItems: "flex-start", paddingVertical: 2 },
		// 曜日の列幅を固定して時刻の左端を揃える（揃っていないと表として読めない）
		dayLabel: { width: 28, fontSize: 13, color: colors.textSecondary },
		daySpans: { flex: 1, fontSize: 13, color: colors.textStrong },
		// §2 補足は 12–13 / 400、色は副文字色
		provenance: { marginTop: 8, fontSize: 12, color: colors.textSecondary },
	});
