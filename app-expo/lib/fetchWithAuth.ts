import { Env } from "@/constants/Env";
import { Platform } from "react-native";

const buildRequestBody = <TRequest extends Record<string, any> | FormData>(
    method: "GET" | "POST" | "DELETE",
    shouldUseQuery: boolean,
    isMultipart: boolean,
    requestPayload: TRequest,
): BodyInit | undefined => {
    if (method === "POST") {
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
    }: {
        method?: "GET" | "POST" | "DELETE";
        requestPayload: TRequest;
        isMultipart?: boolean;
    },
    accessToken: string,
) {
    const appVersion = Env.APP_VERSION;
    // 🧾 リクエストヘッダー構築
    const headers: Record<string, string> = {
        "x-app-version": appVersion,
        Authorization: `Bearer ${accessToken}`,
    };

    // GET/DELETE で FormData でも multipart でもない場合はクエリに展開
    const shouldUseQuery =
        (method === "GET" || method === "DELETE") && !(requestPayload instanceof FormData) && !isMultipart;
    const qs = shouldUseQuery ? `?${new URLSearchParams(requestPayload as Record<string, string>).toString()}` : "";
    const endpoint = `${Env.BACKEND_BASE_URL}/${endpointName}${qs}`;

    const willSendBody = method === "POST" || (method === "DELETE" && !shouldUseQuery);

    if (willSendBody && !isMultipart) headers["Content-Type"] = "application/json";
    return {
        response: await fetch(endpoint, {
            method,
            headers,
            body: buildRequestBody(method, shouldUseQuery, isMultipart, requestPayload),
            // Include credentials for web to receive CDN signed cookies
            credentials: Platform.OS === "web" ? "include" : "same-origin",
        }),
        endpoint,
    };
}