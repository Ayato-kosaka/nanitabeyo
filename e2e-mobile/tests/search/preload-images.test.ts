import { launchAppWithSession } from "../../fixtures/e2e";
import { PRELOAD_IMAGE_COUNT, PRELOAD_PROBE_TIMEOUT, SearchScreen } from "../../screens/SearchScreen";
import { TabBar } from "../../screens/TabBar";

/**
 * 🖼️ 先読み画像（PRELOAD_IMAGES）が native で実際にロードされることの回帰テスト（#1087・親 #1082）
 *
 * **このテストは通るのが正しい。** 赤くなったら先読みが native で効かなくなっている。
 *
 * ## 何を守っているか
 * 検索画面末尾の先読みブロックは 0×0 で描かれていたため、expo-image の native 実装が
 * **ロード要求そのものを発行せず、導入時（#656）から一度も効いていなかった**
 *（iOS: `getBestSource` が size<=0 で nil を返す / Android: `cleanIfNeeded` が width/height 0 で早期 return）。
 * #1087 で 1×1 へ修正し、iOS / Android の実機で解消を確認済み。
 *
 * 構造面の再発は app-expo の jest（features/search/searchScreenPreload.test.tsx）が守っているが、
 * それは **「style が非ゼロか」しか見ない構造テスト**で、
 * 「1×1 では足りなくなる」「`opacity: 0` で早期 return されるようになる」といった
 * **expo-image 側の振る舞いの変化を緑のまま見逃す**。今回の不具合が数ヶ月見つからなかったのは
 * まさにその種類の見逃しだった。
 * この spec は **native で実際にロード要求が発行され、全枚数とも完了すること**を end-to-end で確かめる、
 * その層の唯一のテスト。
 *
 * ## 観測の仕組み
 * アプリ側（app-expo/lib/e2e/preloadProbe.tsx）が、先読みブロックの各 `<Image>` の
 * `onLoad` / `onError` を数え、`loaded=<n>/<total>` を持つ `search-preload-probe` を描画する。
 * この spec はそれが `loaded=10/10` になるのを待つだけ。
 * **時間ではなく状態を見ている**ので「ランナーが遅い」では赤くならない
 *（e2e-web の tests/search/onboarding-preload.spec.ts と同じ観測原則）。
 *
 * ## 失敗したときの読み方
 * `expectPreloadImagesLoaded()` は失敗時に実測値（`loaded=<n> error=<n> total=<n>`）をメッセージへ載せる。
 * - `loaded=0 error=0` … **ロード要求が飛んでいない**。先読みブロックのサイズが 0 に戻った等、
 *   app-expo/app/[locale]/(tabs)/search/index.tsx 末尾を疑う（今回の #1087 と同じ壊れ方）
 * - `error>0` … 要求は飛んだが取得に失敗している。アセット解決やキャッシュ側を疑う
 *
 * ## 前提
 * プローブは **E2E ビルド限定**で描画される。`EXPO_PUBLIC_E2E_TUTORIAL_HOOK=1` を付けずに
 * ビルドすると要素ごと存在しないため、`expectPreloadImagesLoaded()` はその旨を名指しで報告して落ちる。
 */
describe("先読み画像のロード", () => {
	const tabBar = new TabBar();
	const search = new SearchScreen();

	beforeAll(async () => {
		// #1030 【設計】3-1: 匿名サインインのクォータを消費しないよう、確立済みセッションを注入して起動する。
		// #1027 オンボーディングは既定（tutorialSeen: true）で抑止する。**抑止は必須**で、
		// 開いてしまうとオンボーディング自身が同じ画像を描画し、
		// 「先読みブロックのおかげでロードされた」と言えなくなる（e2e-web が既読シードを要求しているのと同じ理由）
		await launchAppWithSession({ as: "anon" });
	});

	// ─ テストケース: 検索タブを開くと先読み画像が全枚数ロードされる ─
	// 手順:
	//   1. さがすタブを開く（先読みブロックは検索画面のマウントで描画される）
	//   2. 検索画面の描画完了を待つ
	//   3. プローブが `loaded=10/10` になるまで待つ（8 枚時代の実測 1873ms に対して上限 10 秒）
	it("検索タブを開くと先読み画像が全枚数ロードされる", async () => {
		await tabBar.gotoSearch();
		await search.expectLoaded();

		await search.expectPreloadImagesLoaded(PRELOAD_IMAGE_COUNT, PRELOAD_PROBE_TIMEOUT);
	});
});
