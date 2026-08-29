const { withDangerousMod } = require("expo/config-plugins");
const fs = require("fs");
const path = require("path");

const MARKER = "# #1156 use-frameworks-module-fixes";

/**
 * framework module 化をやめさせる Pod。
 *
 * React Native Core のヘッダは module map を持たないため、React Native Core の型を
 * 公開ヘッダで晒している Pod は use_frameworks! 下で必ず modular header 制約に抵触する。
 * そういう Pod は framework ではなく素の静的ライブラリとしてビルドさせるのが確実。
 */
const STATIC_LIBRARY_PODS = ["react-native-maps", "RNFBApp", "RNFBPerf", "RNFBCrashlytics"];

/**
 * #1156 【設計】use_frameworks! 環境で発生する modular header 由来のビルドエラーを回避する。
 *
 * 背景:
 *   `app.config.ts` の expo-build-properties は iOS を `useFrameworks: "static"` で
 *   ビルドしている。これは `@react-native-firebase` が Swift 混在のため要求する設定。
 *
 *   use_frameworks! を有効にすると各 Pod は framework module として扱われる。
 *   framework module の公開ヘッダから「module map を持たないヘッダ」を include すると
 *   Clang が警告し、React Native の Pods は -Werror 相当のためビルドエラーになる。
 *   React Native Core のヘッダ自体が module map を持たないので、React Native Core の
 *   型を公開ヘッダで使っている Pod はすべてこれを踏みうる。
 *
 *   #1641 `@react-native-firebase/crashlytics` を足したとき、同じ形のエラーが出た。
 *
 *     declaration of 'RCTBridgeModule' must be imported from module
 *     'RNFBApp.RNFBAppModule' before it is required
 *
 *   ⚠️ **落ちている Pod（RNFBCrashlytics）だけを差し替えても直らない**
 *   （run 33267301639 / 33268418817 で 2 回とも同じ。`Forcing static library build for
 *   RNFBCrashlytics` はログに出ているので差し替え自体は効いていた）。
 *
 *   犯人は **依存されている側の `RNFBApp`** である。framework module としてビルドされると、
 *   `RNFBAppModule.h` が `#import <React/RCTBridgeModule.h>` しているせいで
 *   **React の宣言が RNFBApp のモジュールへ吸い込まれる**。その後 `RNFBCrashlytics` が
 *   同じヘッダを include すると、clang は «その宣言はモジュール RNFBApp.RNFBAppModule の
 *   ものだから、先に import しろ» と言って止まる。
 *
 *   同じ 25.1.0 の `RNFBPerf` が踏まなかったのは、**RNFBApp のモジュールが出来る前に
 *   コンパイルされていたから**にすぎない（＝ビルド順まかせで、いつ壊れてもおかしくない）。
 *   そこで **RNFB の 3 つをまとめて** module 化から外し、この失敗の形自体を無くしてある。
 *   3 つとも Swift を 1 行も含まない（podspec の source_files は .h と .m だけ）ので
 *   static library にできる。⚠️ この行に閉じコメント記号を含む glob を書かないこと。
 *
 *   Expo SDK 54 (React Native 0.81) へ上げた際、`react-native-maps` が実際に踏んだ。
 *   EAS Build Develop の iOS が 2 回連続で XCODE_BUILD_ERROR になった。
 *
 *     1 回目: include of non-modular header inside framework module
 *             'react_native_maps.AIRMap': '.../React-Core/React/RCTComponent.h'
 *             [-Werror,-Wnon-modular-include-in-framework-module]
 *
 *     2 回目: declaration of 'RCTViewManager' must be imported from module
 *             'react_native_maps.AIRMapCalloutManager' before it is required
 *
 *   2 回目は 1 回目の対処（CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES）
 *   だけでは足りず、framework module 化そのものが問題であることを示している。
 *
 * 対処は 2 段構え:
 *
 *   1. pre_install で `react-native-maps` の build_type を static_library へ差し替える。
 *      framework ではなくなるため modular header の制約自体が適用されなくなる。
 *      expo-modules-autolinking が ExpoModulesCore / Expo / expo-dev-menu へ
 *      行っているのと同じ手法（scripts/ios/cocoapods/installer.rb 参照）。
 *
 *   2. post_install で全 Pod へ CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES=YES
 *      を設定する。1 を適用していない他の Pod が同種の警告を出しても止まらないようにする保険。
 *
 * expo-build-properties の `ios.forceStaticLinking` を使わない理由:
 *   同じ static_library 差し替えを行う公式オプションだが、expo-modules-autolinking の
 *   `cocoapods/installer.rb` を読むと `should_disable_use_frameworks_for_core_expo_pods?`
 *   が真のとき、つまり `RCT_USE_PREBUILT_RNCORE == "1"` のときにしか適用されない。
 *   SDK 54 の precompiled React Native for iOS は use_frameworks! と併用できず
 *   ソースビルドへフォールバックするため、本プロジェクトではこの条件を満たさない。
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

			const replacement = `${MARKER}
  pre_install do |installer|
    installer.pod_targets.each do |pod_target|
      if ${JSON.stringify(STATIC_LIBRARY_PODS)}.include?(pod_target.name)
        Pod::UI.puts("[#1156] Forcing static library build for #{pod_target.name}")
        def pod_target.build_type
          Pod::BuildType.static_library
        end
      end
    end
  end

  ${anchor}
    installer.pods_project.targets.each do |target|
      target.build_configurations.each do |build_configuration|
        build_configuration.build_settings['CLANG_ALLOW_NON_MODULAR_INCLUDES_IN_FRAMEWORK_MODULES'] = 'YES'
      end
    end
`;

			fs.writeFileSync(podfilePath, contents.replace(anchor, replacement), "utf8");
			return cfg;
		},
	]);

module.exports = withNonModularHeaders;
