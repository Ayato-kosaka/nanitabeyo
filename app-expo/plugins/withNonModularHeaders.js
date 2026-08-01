const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "# #1156 allow-non-modular-headers";

/**
 * #1156 【設計】use_frameworks! 環境で非モジュラーヘッダの include をエラーにしない。
 *
 * 背景:
 *   `app.config.ts` の expo-build-properties は iOS を `useFrameworks: "static"` で
 *   ビルドしている。これは `@react-native-firebase` が Swift 混在のため要求する設定。
 *
 *   `use_frameworks!` を有効にすると各 Pod は framework module として扱われ、
 *   framework module の公開ヘッダから「モジュール化されていないヘッダ」を include
 *   することが `-Wnon-modular-include-in-framework-module` で警告される。React Native の
 *   Pods は `-Werror` 相当でビルドされるため、これがそのままビルドエラーになる。
 *
 *   Expo SDK 54 (React Native 0.81) へ上げた際、`react-native-maps` が実際にこれを踏んだ。
 *
 *     include of non-modular header inside framework module
 *     'react_native_maps.AIRMap': '.../Pods/Headers/Public/React-Core/React/RCTComponent.h'
 *     [-Werror,-Wnon-modular-include-in-framework-module]
 *
 *   React Native Core のヘッダ自体がモジュールマップを持たないため、React Native Core の
 *   ヘッダを公開ヘッダから include している Pod はすべて同じ問題を踏みうる。
 *
 * 他案を採らなかった理由:
 *   expo-build-properties の `ios.forceStaticLinking` は、該当 Pod を framework ではなく
 *   static library として扱わせる公式オプションだが、
 *   expo-modules-autolinking の `cocoapods/installer.rb` を読むと、この patch は
 *   `should_disable_use_frameworks_for_core_expo_pods?` が真のとき、つまり
 *   `RCT_USE_PREBUILT_RNCORE == "1"` のときにしか適用されない。
 *   SDK 54 の precompiled React Native for iOS は `use_frameworks!` と併用できず
 *   ソースビルドへフォールバックするため、本プロジェクトではこの条件を満たさず効かない。
 *
 * 対処:
 *   Podfile の post_install で全 Pod ターゲットに
 *   `CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES = YES` を設定し、
 *   この警告自体を出さないようにする。CocoaPods + use_frameworks! での定番の回避策であり、
 *   個別 Pod のバージョンに依存しないため、他の Pod が同じ問題を踏んでも追加対応が要らない。
 */
const withNonModularHeaders = (config) =>
	withDangerousMod(config, [
		"ios",
		(cfg) => {
			const podfilePath = path.join(cfg.modRequest.platformProjectRoot, "Podfile");
			const contents = fs.readFileSync(podfilePath, "utf8");

			if (contents.includes(MARKER)) {
				return cfg;
			}

			const anchor = "post_install do |installer|";
			if (!contents.includes(anchor)) {
				throw new Error(`withNonModularHeaders: Podfile に "${anchor}" が見つからない`);
			}

			const injection = `${anchor}
    ${MARKER}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_configuration|
        build_configuration.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
      end
    end
`;

			fs.writeFileSync(podfilePath, contents.replace(anchor, injection), "utf8");
			return cfg;
		},
	]);

module.exports = withNonModularHeaders;
