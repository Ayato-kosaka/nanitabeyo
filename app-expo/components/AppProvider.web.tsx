import { ReactNode } from "react";
import { GoogleMapsScriptProvider } from "@/components/GoogleMapsScript";

/**
 * 🌐 web 版のアプリ共通プロバイダ。
 *
 * #1503 【バグ】以前はここで `<LoadScript>` がアプリ全体を包んでいて、Google Maps の
 * スクリプトが読み終わるまで **children を 1 つも描画しなかった**。その結果
 *
 * - prerender された HTML は公開 4 ルートすべてで `Loading...` だけ（＝直リンクの初回表示が空）
 * - スクリプトの読み込みが失敗・遅延すると、地図と無関係な画面まで白いまま固定される
 *
 * という状態だった。読み込みの管理は `GoogleMapsScriptProvider` へ移し、
 * **待つのは地図を描く画面だけ**にしてある（`components/GoogleMapsScript.web.tsx` 参照）。
 */
export const AppProvider = ({ children }: { children: ReactNode }) => (
	<GoogleMapsScriptProvider>{children}</GoogleMapsScriptProvider>
);
