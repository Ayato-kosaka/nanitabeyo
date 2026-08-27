import React from "react";
import { Text, StyleSheet } from "react-native";
import { Env } from "@/constants/Env";
import type { Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";
import { UNKNOWN_BUILD_META_CLIENT } from "@shared/api/v1/constants/build-meta";

const SHORT_COMMIT_ID_LENGTH = 7;

/**
 * #1495 【設計】サポート問い合わせで「どのビルドを使っているか」を特定するための表示。
 *
 * バージョン番号（Env.APP_VERSION）だけでは、同じバージョン内で配信される OTA 更新
 * （EAS Update）を区別できない。短縮コミット ID（#1078 で全 API/ログに乗っている build meta
 * と同じ値、created_commit_id で BigQuery と突合可能）を併記することで、問い合わせ時に
 * 「今どの OTA 更新が動いているか」まで特定できるようにする。
 *
 * EXPO_PUBLIC_COMMIT_ID が注入されていないローカル開発では Env.COMMIT_ID が
 * UNKNOWN_BUILD_META_CLIENT へ落ちる。その値の先頭 7 桁をそのまま出すと "unknown" という
 * 紛らわしい文字列になるため、ここだけ "dev" に読み替える。
 *
 * selectable にしているのは、問い合わせ時にそのままコピーして送ってもらうため。
 */
export function VersionInfo() {
	const styles = useThemedStyles(createStyles);
	const shortCommitId =
		Env.COMMIT_ID === UNKNOWN_BUILD_META_CLIENT ? "dev" : Env.COMMIT_ID.slice(0, SHORT_COMMIT_ID_LENGTH);

	return (
		<Text style={styles.versionText} selectable testID="settings-version-section">
			{`${Env.APP_VERSION}(${shortCommitId})`}
		</Text>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		versionText: {
			fontSize: 13,
			color: colors.textTertiary,
			textAlign: "center",
			paddingTop: 24,
			paddingHorizontal: 16,
		},
	});
