/** クライアントが値を持っていなかった（ビルド時 env 注入漏れ等） */
export const UNKNOWN_BUILD_META_CLIENT = "unknown-client";

/** クライアントがキーごと送ってこなかった（古い／壊れたバンドル。サーバが補完） */
export const UNKNOWN_BUILD_META_SERVER = "unknown-server";
