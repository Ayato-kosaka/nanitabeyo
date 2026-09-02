import React from "react";
import { StyleSheet, Text, View } from "react-native";
import { ImageOff } from "lucide-react-native";
import i18n from "@/lib/i18n";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import type { Palette } from "@/constants/Palette";

/**
 * #1513 【設計】自分の投稿が削除済みの行に出す «墓標»。
 *
 * ## なぜ行を消さずに墓標を出すのか（オーナー確定）
 * my-dishes の行は「自分がその料理を食べた」という記録であり、写真は記録の付属物である。
 * 写真を消したからといって記録そのものを消してはいけない（消すと「食べた」件数と
 * カレンダーの日付が黙って減り、利用者から見て記録が失われたのと区別できない）。
 * 同じ理由で **別の写真へ差し替えてもいけない**（`isOwnMediaDeleted === true` のとき
 * サーバーは `dishMedia` を null にして返す。#1513 の API 側で確定済み）。
 * `dish.categoryImageUrl` / `restaurant.image_url` への通常のフォールバックもここでは行わない。
 * 「自分が消した写真の跡地」に別の絵が入ると、消えたことが伝わらない。
 *
 * ## 墓標を出す画面 / 黙って除外する画面
 * - **墓標**: いいね一覧 / 保存一覧 / 通知 / レビューのサムネイル / my-dishes（一覧・カレンダー・地図のピン）
 * - **黙って除外**: 検索結果 / 店舗フィード / 投票候補
 *
 * ## 色
 * テーマ追従のトークン（`constants/Palette.ts`）だけで組む。墓標は写真の代わりに
 * **アプリの地の上へ**出るものなので、`FixedColors`（写真・動画の上専用）は使わない。
 * ダークで地に沈まないよう、面は `divider`（地より一段明るい / 暗い面）を使う。
 *
 * 文字は `textSecondaryAlt`、アイコンは `textSecondary`。ここは実測して決めた値で、
 * **一段淡いトークンでは WCAG を割る**（`divider` の面に対するコントラスト比）:
 *
 * |            | ライト | ダーク | 必要 |
 * | ---------- | ------ | ------ | ---- |
 * | 文字 `textSecondaryAlt` | 6.87:1 | 8.44:1 | 4.5:1 (AA・小さい文字) |
 * | 文字 `textSecondary`（不可） | **4.39:1** | 6.20:1 | 同上 |
 * | アイコン `textSecondary` | 4.39:1 | 6.20:1 | 3:1 (1.4.11 非文字) |
 * | アイコン `textTertiary`（不可） | **2.31:1** | 4.52:1 | 同上 |
 *
 * 文字は 10pt（= 小さい文字）なので AA は 4.5:1 が要る。ライトで 4.39:1 は割っている。
 * アイコンだけの variant（`cell` / `pin`）では、そのアイコンが «削除された» を伝える
 * 唯一の手掛かりなので、3:1 は必ず満たすこと。
 */

/*
#1513 【設計】置き場所と名前について。

最初は my-dishes 専用のつもりで `features/myDishes/` に置いたが、いいね一覧・通知・
レビューのサムネイルでも同じ墓標を出すことになったので `components/` へ移した。
同じ見た目を 2 通り作らないためである。

⚠️ 文言キーは `MyDishes.deleted.*` のまま据え置いている。既に 8 ロケールへ配ってあり、
   キー名を変えても利用者から見て何も変わらない（文言は «削除されました» で汎用）。
   キーの改名だけのために 8 ファイルを触る価値は無いと判断した。
*/

/** Detox / Playwright が墓標の有無を確かめるための testID */
export const DELETED_MEDIA_TOMBSTONE_TEST_ID = "my-dishes-deleted-tombstone";

/**
 * 出す場所ごとの寸法。
 *
 * - `tile`: 一覧ビューの 3 列タイル。文字を出せる幅がある
 * - `cell`: カレンダーの日セル（直径 40pt 弱の丸）。**文字は入らないのでアイコンだけ**にし、
 *   「削除されました」は `accessibilityLabel` で読み上げへ回す
 * - `pin`: 地図ピンの吹き出し（直径 37〜48pt）。`cell` と同じ理由でアイコンだけ
 */
export type DeletedMediaTombstoneVariant = "tile" | "cell" | "pin";

const ICON_SIZE: Record<DeletedMediaTombstoneVariant, number> = { tile: 20, cell: 14, pin: 18 };

export function DeletedMediaTombstone({
	variant = "tile",
	style,
	testID = DELETED_MEDIA_TOMBSTONE_TEST_ID,
}: {
	variant?: DeletedMediaTombstoneVariant;
	style?: React.ComponentProps<typeof View>["style"];
	testID?: string;
}) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	const showLabel = variant === "tile";

	return (
		<View
			testID={testID}
			// `cell` はカレンダーの丸の中に日付の数字と同居する。アイコンを中央に置くと数字と
			// 重なるので下寄せにする（数字は呼び出し側が中央に置いたまま）
			style={[styles.container, variant === "cell" && styles.cellContainer, style]}
			// 文字を出さない variant でも、削除されたことは支援技術へ必ず伝える
			accessibilityLabel={i18n.t("MyDishes.deleted.a11yLabel")}>
			<ImageOff size={ICON_SIZE[variant]} color={colors.textSecondary} />
			{showLabel && (
				<Text testID={`${testID}-label`} style={styles.label} numberOfLines={2}>
					{i18n.t("MyDishes.deleted.label")}
				</Text>
			)}
		</View>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			alignItems: "center",
			justifyContent: "center",
			gap: 4,
			paddingHorizontal: 6,
			backgroundColor: colors.divider,
		},
		cellContainer: {
			justifyContent: "flex-end",
			paddingBottom: 3,
		},
		label: {
			fontSize: 10,
			color: colors.textSecondaryAlt,
			textAlign: "center",
		},
	});
