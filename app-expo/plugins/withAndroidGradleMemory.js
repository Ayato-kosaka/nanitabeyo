const { withGradleProperties } = require("expo/config-plugins");

const KEY = "org.gradle.jvmargs";
const VALUE = "-Xmx4096m -XX:MaxMetaspaceSize=2048m -Dfile.encoding=UTF-8";

/**
 * #1156 【設計】Gradle JVM の metaspace を広げ、release ビルドの lint が OOM で落ちるのを防ぐ。
 *
 * 背景:
 *   Expo のテンプレートが生成する `android/gradle.properties` は
 *   `org.gradle.jvmargs=-Xmx2048m -XX:MaxMetaspaceSize=512m` を既定にしている。
 *
 *   Expo SDK 54 (React Native 0.81 / AGP 8.11) では autolink されるモジュール数と
 *   各モジュールのクラス数が増え、AGP が release ビルドで走らせる `lintVitalAnalyzeRelease`
 *   が 512m の metaspace を使い切って落ちるようになった。
 *
 *     Execution failed for task ':expo-modules-core:lintVitalAnalyzeRelease'.
 *     > Unexpected failure during lint analysis
 *         Message: Metaspace
 *         Stack: `OutOfMemoryError: ...`
 *
 *   lint は「クラスをロードして解析する」ため、ヒープ(-Xmx)ではなく metaspace を食う。
 *   ヒープだけ増やしても直らない。
 *
 * 影響範囲（重要）:
 *   落ちるのは **release ビルドだけ**。EAS の `development` プロファイルは debug ビルドで
 *   `lintVitalRelease` を通らないため、EAS Build Develop は成功していた。
 *   一方、Detox E2E（`assembleRelease`）と EAS の `preview` / `production` プロファイルは
 *   release ビルドなので、この対処が無いと同じ OOM を踏みうる。
 *
 * 他案を採らなかった理由:
 *   `android { lint { checkReleaseBuilds false } }` で lint 自体を止める手もあるが、
 *   release ビルド前の lint はマニフェスト不整合など出荷事故を防ぐ実質的な価値があるため
 *   無効化しない。必要なメモリを与えるだけにする。
 */
const withAndroidGradleMemory = (config) =>
	withGradleProperties(config, (cfg) => {
		cfg.modResults = cfg.modResults.filter((item) => !(item.type === "property" && item.key === KEY));
		cfg.modResults.push({
			type: "comment",
			value: `#1156 SDK 54 では lintVitalAnalyzeRelease が既定の MaxMetaspaceSize=512m を使い切って OOM になる`,
		});
		cfg.modResults.push({ type: "property", key: KEY, value: VALUE });
		return cfg;
	});

module.exports = withAndroidGradleMemory;
