export const CLS_KEY_REQUEST_ID = 'reqId';
export const CLS_KEY_USER_ID = 'userId';
export const CLS_KEY_API_LOG_BUFFER = 'apiLogBuffer';
export const CLS_KEY_BE_LOG_BUFFER = 'beLogBuffer';
export const CLS_KEY_APP_VERSION = 'appVersion';

/**
 * #1052 端末言語（`x-app-language` ヘッダ）。
 *
 * レビューの優先言語は search 以外の 5 経路（`?ids=` / 店舗詳細 / 投稿・いいね・保存タブ /
 * 通知）でも必要になる。各エンドポイントの DTO へ足して app 側から個別に渡すと、
 * 配線を 1 か所忘れただけで「検索では日本語なのに店舗ページでは英語」に戻る。
 * 全リクエスト共通のヘッダとして受け取り、CLS 経由で 1 か所から読む。
 */
export const CLS_KEY_APP_LANGUAGE = 'appLanguage';
