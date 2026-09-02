const { withAppBuildGradle } = require("expo/config-plugins");

const MARKER = "// #1016 detox-protobuf-fix";

/**
 * #1016 / #1025 【設計】Detox の androidTest APK が持ち込む古い protobuf-javalite を除外する。
 *
 * 背景:
 *   `@react-native-firebase/perf` が入れる firebase-perf の生成クラス
 *   (`com.google.firebase.perf.v1.TraceMetric`) は、新しい protobuf-javalite にしか無い
 *   `GeneratedMessageLite.registerDefaultInstance(Class, GeneratedMessageLite)` を呼ぶ。
 *
 *   一方 Detox が入れる `com.wix:detox` は androidx.test / espresso 経由で古い
 *   protobuf-javalite を androidTest APK へ同梱する。Android の instrumentation は
 *   テスト APK の dex をアプリのプロセスへ載せるため、古い `GeneratedMessageLite` が
 *   アプリ側の新しいものを覆い隠す。結果、`FirebaseInitProvider.onCreate`（= JS が動く前、
 *   Application の bind 中）で `NoSuchMethodError` が出てプロセスが即死する。
 *
 * 対処:
 *   androidTest の classpath から protobuf を落とす。アプリ APK 側には firebase が持ってきた
 *   新しい protobuf-javalite が残るので、espresso から参照されても解決できる（新しい方に寄る）。
 *
 * このプラグインは app.config.ts 側で E2E_DETOX=1 のときだけ適用する。
 * 通常の EAS ビルドには androidTest APK が無く、そもそもこの競合は起きない。
 */
const withDetoxProtobufFix = (config) =>
	withAppBuildGradle(config, (cfg) => {
		if (cfg.modResults.language !== "groovy") {
			throw new Error("withDetoxProtobufFix は groovy の app/build.gradle にのみ対応している");
		}

		if (cfg.modResults.contents.includes(MARKER)) {
			return cfg;
		}

		cfg.modResults.contents += `
${MARKER}
configurations.matching { it.name.startsWith("androidTest") }.configureEach {
    exclude group: "com.google.protobuf", module: "protobuf-javalite"
    exclude group: "com.google.protobuf", module: "protobuf-lite"
}
`;

		return cfg;
	});

module.exports = withDetoxProtobufFix;
