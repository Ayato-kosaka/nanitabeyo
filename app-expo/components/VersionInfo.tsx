import React from "react";
import { View, Text, StyleSheet } from "react-native";
import i18n from "@/lib/i18n";
import { Env } from "@/constants/Env";

/**
 * #1495 【設計】サポート問い合わせで「どのビルドを使っているか」を特定するための表示。
 *
 * バージョン番号（Env.APP_VERSION）だけでは、同じバージョン内で配信される OTA 更新
 * （EAS Update）を区別できない。runtimeVersion と commitId
 * （#1078 で全 API/ログに乗っている build meta と同じ値、created_commit_id で BigQuery と突合可能）
 * を併記することで、問い合わせ時に「今どの OTA 更新が動いているか」まで特定できるようにする。
 *
 * selectable にしているのは、問い合わせ時にそのままコピーして送ってもらうため。
 */
export function VersionInfo() {
	return (
		<View style={styles.container} testID="settings-version-section">
			<Text style={styles.versionText} selectable>
				{i18n.t("Settings.version", { version: Env.APP_VERSION })}
			</Text>
			<Text style={styles.buildInfoText} selectable testID="settings-build-info">
				{i18n.t("Settings.buildInfo", {
					runtimeVersion: Env.RUNTIME_VERSION,
					commitId: Env.COMMIT_ID,
				})}
			</Text>
		</View>
	);
}

const styles = StyleSheet.create({
	container: {
		alignItems: "center",
		paddingTop: 24,
		paddingHorizontal: 16,
	},
	versionText: {
		fontSize: 13,
		color: "#9CA3AF",
	},
	buildInfoText: {
		fontSize: 11,
		color: "#9CA3AF",
		marginTop: 4,
	},
});
