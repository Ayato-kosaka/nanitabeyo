import { useJsApiLoader, type Libraries } from "@react-google-maps/api";
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { Env } from "@/constants/Env";
import { useLocale } from "@/hooks/useLocale";
import { useLogger } from "@/hooks/useLogger";
import type { GoogleMapsScriptState } from "./GoogleMapsScript";

/**
 * 🗺️ Google Maps JavaScript API の読み込み（web 版）
 *
 * ## #1503 なぜ `<LoadScript>` で包むのをやめたか
 * 以前はここが `<LoadScript>{children}</LoadScript>` で **アプリ全体**を包んでいた。
 * `LoadScript` の `render()` は
 *
 * ```js
 * this.state.loaded ? children : (loadingElement || <DefaultLoadingElement/>)
 * ```
 *
 * であり、`state.loaded` はスクリプト注入が完了するまで false のままである。つまり
 *
 * - **prerender（`expo export` の静的レンダリング）では children が 1 度も描画されない。**
 *   公開 4 ルートの `<body>` がバイト単位で同一（中身は英語の `Loading...` だけ）だったのは
 *   これが理由で、直リンクの初回 HTML には画面の中身も SEO 用のテキストも入っていなかった
 * - **スクリプトの読み込みに失敗すると、アプリ全体が「Loading...」のまま固定される。**
 *   API キーの不備・広告ブロッカ・ネットワーク断のいずれでも白画面になる。
 *   同型の事故は既に踏んでいて（`PushTokenRegistration.tsx` / `MetaAppEventsInitializer.tsx` の
 *   「`google api is already presented` で固まりアプリ全体が Loading のまま止まる」コメント）、
 *   あれは «再マウントで注入が失敗する» 経路から同じ状態へ落ちたもの
 *
 * ## 今の形
 * children は**読み込みを待たずに常に描画する**。スクリプトは
 * `useGoogleMapsScript()` を呼ぶコンポーネント（＝実際に地図を描く `MapView.web.tsx`）が
 * マウントされたときに初めて注入し、待つのもそのコンポーネントだけにする。
 * 地図を使わない画面は Maps API のロード有無に一切影響されない。
 */

/** `useJsApiLoader` に渡す libraries は**モジュール定数**にすること（毎レンダー新しい配列を渡すと再読込の警告が出る） */
const GOOGLE_MAPS_LIBRARIES: Libraries = ["places"];

/** `LoadScript` の既定値と同じ id。`<script>` の重複注入を避けるためのキー */
const GOOGLE_MAPS_SCRIPT_ID = "script-loader";

type GoogleMapsScriptContextValue = GoogleMapsScriptState & {
	/** 地図を使う画面がマウントされたことを知らせる（初回だけスクリプト注入が始まる） */
	requestLoad: () => void;
};

const GoogleMapsScriptContext = createContext<GoogleMapsScriptContextValue>({
	isLoaded: false,
	loadError: undefined,
	requestLoad: () => {},
});

/**
 * ロケール文字列から Maps API へ渡す language / region を作る。
 *
 * @param locale 例: `ja`, `en-US`, `zh-Hant-TW`
 * @returns Maps API の `language` と `region`
 */
export function deriveLanguageAndRegion(locale: string): { language: string; region: string } {
	const parts = locale.split("-");
	const language = parts[0];
	// 2 文字の地域コード（末尾側を優先）を拾う
	let region = parts.findLast?.((p) => /^[a-zA-Z]{2}$/.test(p)) || parts[1] || "US";
	region = region.toUpperCase();
	// フォールバック
	if (!region) {
		if (language === "ja") region = "JP";
		else if (language === "en") region = "US";
		else region = language.toUpperCase();
	}
	return { language, region };
}

/**
 * 実際に `<script>` を注入する部品。**要求があったときだけマウントされる**。
 *
 * DOM を持たない（`null` を返す）ので、マウントされても画面には影響しない。
 */
function GoogleMapsScriptLoader({
	locale,
	onStateChange,
}: {
	locale: string;
	onStateChange: (state: GoogleMapsScriptState) => void;
}) {
	const { logFrontendEvent } = useLogger();

	// ⚠️ language / region は**最初の要求時の値で固定する**。`useJsApiLoader` はこれらが変わると
	// 別の Loader を作り直し、2 本目の注入が「google api is already presented」で失敗する。
	// 以前の `LoadScript` 版はロケール変更（= URL の locale セグメント変更）で実際にこれを踏み、
	// アプリ全体が Loading のまま止まっていた。地図の表示言語が初回のロケールに固定される代わりに、
	// «固まらない» ことを取る。
	const [{ language, region }] = useState(() => deriveLanguageAndRegion(locale));

	const { isLoaded, loadError } = useJsApiLoader({
		id: GOOGLE_MAPS_SCRIPT_ID,
		googleMapsApiKey: Env.GOOGLE_MAPS_WEB_API_KEY,
		language,
		region,
		libraries: GOOGLE_MAPS_LIBRARIES,
	});

	useEffect(() => {
		onStateChange({ isLoaded, loadError });
	}, [isLoaded, loadError, onStateChange]);

	useEffect(() => {
		if (!loadError) return;
		// 白画面にはしない代わりに、地図が出ない事実は必ず観測できるようにする
		logFrontendEvent({
			event_name: "google_maps_script_load_failed",
			error_level: "error",
			payload: { message: loadError.message, language, region },
		});
	}, [loadError, logFrontendEvent, language, region]);

	return null;
}

/**
 * 🗺️ Google Maps のスクリプト読み込みを管理するプロバイダ（web 版）。
 *
 * **children は常に、読み込み状態に関係なく描画する。**
 */
export const GoogleMapsScriptProvider = ({ children }: { children: ReactNode }) => {
	const { locale } = useLocale();
	const [isRequested, setIsRequested] = useState(false);
	const [state, setState] = useState<GoogleMapsScriptState>({ isLoaded: false, loadError: undefined });

	const requestLoad = useCallback(() => setIsRequested(true), []);
	const value = useMemo<GoogleMapsScriptContextValue>(() => ({ ...state, requestLoad }), [state, requestLoad]);

	return (
		<GoogleMapsScriptContext.Provider value={value}>
			{isRequested ? <GoogleMapsScriptLoader locale={locale} onStateChange={setState} /> : null}
			{children}
		</GoogleMapsScriptContext.Provider>
	);
};

/**
 * 🗺️ 地図を描くコンポーネントから呼ぶ。**呼んだ時点で初めてスクリプトの読み込みが始まる。**
 *
 * @returns 読み込み状態。`isLoaded` が true になるまでは地図を描画してはいけない
 */
export const useGoogleMapsScript = (): GoogleMapsScriptState => {
	const { isLoaded, loadError, requestLoad } = useContext(GoogleMapsScriptContext);

	// 描画中ではなく effect で要求する（描画中に親の state を触るとサーバ HTML と食い違う）
	useEffect(() => {
		requestLoad();
	}, [requestLoad]);

	return { isLoaded, loadError };
};
