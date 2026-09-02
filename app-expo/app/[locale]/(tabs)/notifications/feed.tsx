import { useLocalSearchParams } from "expo-router";
import { StyleSheet, Text, View } from "react-native";
import DishMediaFeed from "@/features/dishMedia/components/DishMediaFeed";
import { type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";

/*
#1375（全画面のクラッシュ棚卸し）**壊れた URL で throw しない。**

以前はここが

    if (idType !== "dish_media" && idType !== "dish_reviews") {
        throw new Error(`Invalid idType: ${idType}. …`);
    }

だった。これは **render 中の throw** なので、画面の一部ではなく
`app/[locale]/_layout.tsx` の最終防波堤（ErrorBoundary）まで一直線に抜け、
**アプリ全体が «予期しないエラーが発生しました»** になる。

`idType` が付いた状態でここへ来るのは通知一覧を経由したときだけで、

- web で URL を直打ち / 共有 / ブックマークした
- ディープリンクで着地した
- 遷移のパラメータが落ちた

のいずれでも `idType` は無い。**普通に起こることでアプリ全体が落ちていた。**

#1477 で `posts.tsx` が同じ問題を «見つかりません» に倒して解決しているので、
その前例に揃える。内部エラー文をユーザーに見せない、という判断もそちらと同じ。
*/
export default function NotificationFeedScreen() {
	const { idType } = useLocalSearchParams<{ idType?: string }>();
	const styles = useThemedStyles(createStyles);

	if (idType !== "dish_media" && idType !== "dish_reviews") {
		return (
			<View style={styles.container} testID="notification-feed-screen">
				<Text style={styles.notFoundText} testID="notification-feed-not-found">
					{i18n.t("Common.errors.notFound")}
				</Text>
			</View>
		);
	}

	return <DishMediaFeed entriesKey="notification" idType={idType} />;
}

const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
			padding: 24,
			backgroundColor: c.surface,
		},
		notFoundText: {
			fontSize: 14,
			color: c.textSecondary,
			textAlign: "center",
		},
	});
