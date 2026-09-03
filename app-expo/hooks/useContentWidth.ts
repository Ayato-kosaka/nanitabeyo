import { useSyncExternalStore } from "react";
import { Dimensions, Platform } from "react-native";
import { CONTENT_MAX_WIDTH } from "@/constants/layout";

/**
 * #1783 【設計】静的書き出し(SSG)を通っても壊れない「ウィンドウ由来の px」の入口。
 *
 * ## なぜフックが要るのか(実際に起きた本番バグ)
 *
 * `expo export --platform web` は各ルートの HTML を **Node 上で** 1 回描画して吐く。
 * そこには `window` が無いので `useWindowDimensions()` は **width=0 / height=0** を返す。
 * 0 を px 計算へ通すと負の値になり、それが HTML へそのまま焼き付く。
 * 検索画面の時間帯・同行者グリッドは実際に `style="width:-9.5px"` で出力されていた。
 *
 * さらに悪いことに、**React のハイドレーションは属性(style)の食い違いを直さない**。
 * クライアント側の描画結果が 120.5px でも DOM には -9.5px が残り続ける
 * (以後の再描画でも「ハイドレーション時に描画した値」と同じなら DOM への書き込みが起きない)。
 * 結果、web では画像グリッドが 0 サイズのまま = **画像が一切出ず、選択バッジだけが
 * ラベルへ重なる**という見た目になっていた。dev サーバ(SSG を通らない)では再現しない。
 *
 * ## なぜ useSyncExternalStore なのか
 *
 * 直し方の要点は「**その画面のハイドレーション描画** をサーバ描画と同じ値にし、
 * 完了後に実寸へ差し替える」ことに尽きる。React は `getServerSnapshot` を
 * **ハイドレーション中のコンポーネントにだけ**使い、完了後は `getSnapshot` へ切り替えて
 * 通常の更新として再描画する。これがこの用途にそのまま当たる。
 *
 * ⚠️ 「一度ハイドレーションが終わったらモジュール変数で覚えておく」式の自前実装にしないこと。
 * expo-router はルート本体を**シェルより後に**ハイドレートするため、その頃には
 * フラグが既に立っており、画面だけがサーバと違う値で描画されて食い違いが復活する
 * (この PR の途中で実際に踏んで、style が焼き付いたままになった)。
 *
 * ⚠️ ここを `useWindowDimensions()` の直接呼び出しへ戻さないこと。戻すと焼き付きが再発する。
 * 再発は `e2e-web/tests/config/static-render-sizes.spec.ts` が成果物を見て検知する。
 */

/** SSG と、その HTML をハイドレートする描画で使う既定のビューポート。 */
export const STATIC_RENDER_WINDOW = { width: CONTENT_MAX_WIDTH, height: 800 } as const;

// useSyncExternalStore の引数は「毎回同じ関数参照」である必要があるためモジュールスコープに置く
// (レンダーごとに新しい関数を渡すと購読し直しが起きる)。
const subscribe = (onStoreChange: () => void) => {
	const subscription = Dimensions.addEventListener("change", onStoreChange);
	return () => subscription.remove();
};
const getWindowWidth = () => Dimensions.get("window").width;
const getWindowHeight = () => Dimensions.get("window").height;
const getStaticWidth = () => STATIC_RENDER_WINDOW.width;
const getStaticHeight = () => STATIC_RENDER_WINDOW.height;

/**
 * #958 【設計】グリッド等の幅計算に使う「実際に描画されているコンテンツ幅」を返す。
 *
 * 背景: web は `components/CenteredAppShell.web.tsx` によりアプリ全体が
 * `maxWidth: CONTENT_MAX_WIDTH` の中央カラムに収まるが、`Dimensions.get("window")` /
 * `useWindowDimensions()` は依然としてブラウザウィンドウの実幅(例: 1280px)を返し続ける。
 * この2つが一致しないと、グリッドアイテムがカラム幅を無視して過大に計算され、
 * カラムの外へはみ出す(横スクロール・レイアウト崩れ)。
 *
 * このフックは CenteredAppShell が CSS で行っているのと同じ `min(windowWidth, CONTENT_MAX_WIDTH)`
 * のクランプをそのまま返すことで、両者を常に一致させる。onLayout 計測を使わないのは、
 * 初回描画後まで正しい値が得られず一瞬だけ誤ったサイズで描画される(レイアウトの一瞬のガタつき)
 * のを避けるため。
 *
 * native では CenteredAppShell が何もしない(全画面がそのままカラム)ため、
 * 常に実際のウィンドウ幅をそのまま返す。
 */
export function useContentWidth(): number {
	const width = useSyncExternalStore(subscribe, getWindowWidth, getStaticWidth);
	if (Platform.OS !== "web") return width;
	return Math.min(width, CONTENT_MAX_WIDTH);
}

/**
 * #1783 ウィンドウの高さ。`useContentWidth` と同じ理由で SSG 時に 0 を返さない。
 * 高さは中央カラムの制約を受けないのでクランプはしない。
 */
export function useWindowHeight(): number {
	return useSyncExternalStore(subscribe, getWindowHeight, getStaticHeight);
}
