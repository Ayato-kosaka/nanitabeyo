import { Env } from "@/constants/Env";
import { Platform } from "react-native";
import i18n from "@/lib/i18n";

/**
 * // #596 【バグ】GET/DELETE の querystring 生成で `undefined/null` が文字列化される不具合修正
 * クエリストリング生成時に undefined/null/空文字を除外する
 *
 * @param payload - リクエストパラメータオブジェクト（プリミティブ値のみを想定）
 * @returns クエリストリング（先頭に ? を含む。パラメータなしの場合は空文字）
 *
 * 【仕様】以下の値はクエリに含めない:
 * - undefined: 未選択・未指定の状態を表す
 * - null: 明示的な null 値
 * - "": 空文字列（「未指定」として扱う。空文字を送る必要がある場合は別途対応）
 *
 * 【注意】0, false などの falsy だが有効な値は保持される
 */
const toQueryString = (payload: Record<string, unknown>): string => {
	const entries = Object.entries(payload)
		.filter(([, v]) => v !== undefined && v !== null && v !== "")
		.map(([k, v]) => [k, String(v)]);
	const qs = new URLSearchParams(entries).toString();
	return qs ? `?${qs}` : "";
};

const buildRequestBody = <TRequest extends Record<string, any> | FormData>(
	method: "GET" | "POST" | "PATCH" | "DELETE",
	shouldUseQuery: boolean,
	isMultipart: boolean,
	requestPayload: TRequest,
): BodyInit | undefined => {
	if (method === "POST" || method === "PATCH") {
		return isMultipart ? (requestPayload as FormData) : JSON.stringify(requestPayload);
	}
	if (method === "DELETE") {
		if (shouldUseQuery) {
			return undefined;
		}
		return isMultipart ? (requestPayload as FormData) : JSON.stringify(requestPayload);
	}
	return undefined;
};

export async function fetchWithAuth<TRequest extends Record<string, any> | FormData>(
	endpointName: string,
	{
		method = "POST",
		requestPayload,
		isMultipart = false,
		signal,
	}: {
		method?: "GET" | "POST" | "PATCH" | "DELETE";
		requestPayload: TRequest;
		isMultipart?: boolean;
		// #940 【設計】応答が返らないまま無期限に待ち続けるのを防ぐためのタイムアウト用シグナル
		signal?: AbortSignal;
	},
	accessToken: string,
) {
	const appVersion = Env.APP_VERSION;
	// 🧾 リクエストヘッダー構築
	const headers: Record<string, string> = {
		"x-app-version": appVersion,
		// #1052 端末言語。API はこれをレビューの優先言語として使う。
		// 各エンドポイントの DTO へ個別に足すと配線を 1 か所忘れただけで
		// 「検索では日本語なのに店舗ページでは英語」に戻るため、
		// 全リクエスト共通のヘッダとしてここ 1 か所で付ける。
		"x-app-language": i18n.locale,
		Authorization: `Bearer ${accessToken}`,
	};

	// GET/DELETE で FormData でも multipart でもない場合はクエリに展開
	const shouldUseQuery =
		(method === "GET" || method === "DELETE") && !(requestPayload instanceof FormData) && !isMultipart;
	// #596 【バグ】undefined/null が "undefined"/"null" 文字列化されるのを防ぐため toQueryString でフィルタ
	const qs = shouldUseQuery ? toQueryString(requestPayload as Record<string, unknown>) : "";
	const endpoint = `${Env.BACKEND_BASE_URL}/${endpointName}${qs}`;

	const willSendBody = method === "POST" || method === "PATCH" || (method === "DELETE" && !shouldUseQuery);

	if (willSendBody && !isMultipart) headers["Content-Type"] = "application/json";
	return {
		response: await fetch(endpoint, {
			method,
			headers,
			body: buildRequestBody(method, shouldUseQuery, isMultipart, requestPayload),
			// Include credentials for web to receive CDN signed cookies
			credentials: Platform.OS === "web" ? "include" : "same-origin",
			signal,
		}),
		endpoint,
	};
}
