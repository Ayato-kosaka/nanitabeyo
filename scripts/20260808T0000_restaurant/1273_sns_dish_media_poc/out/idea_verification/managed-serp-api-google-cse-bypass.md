# idea検証: managed-serp-api-google-cse-bypass

**title**: SerpApi等マネージド型SERP APIで自社GCP CSEの403を回避したキーワード検索
**判定**: ブロック(検証不能) — 技術的な却下ではなく、APIキー取得に人間のブラウザ操作(サインアップ)が
必須で、本セッションにはブラウザ/Chrome MCPもメール受信手段も無いため

## 実施内容と生の結果

### 1. SerpApi (serpapi.com) 疎通確認

```
$ curl -s -o /dev/null -w "HTTP %{http_code}\n" https://serpapi.com/
HTTP 200
```

APIキー無しで `search.json?engine=google&q=test&num=10` を叩くと **HTTP 200** で結果らしきJSONが返った:

```
{
  "search_metadata": {
    "id": "6a7d73afef15ce91e1a4098d",
    "status": "Success",
    "created_at": "2026-08-13 07:35:11 UTC",
    ...
```

一見「キー無しでも動く」ように見えたため、本命クエリで再検証したところ **HTTP 401**:

```
$ curl -s "https://serpapi.com/search.json?engine=google&q=site%3Atiktok.com%20ラーメン%20渋谷&num=10&hl=ja&gl=jp"
{
  "error": "Invalid API key. Your API key should be here: https://serpapi.com/manage-api-key"
}
```

`q=test` を複数回・時間を空けて再実行しても `id` と `created_at` が毎回完全に同一
(`6a7d73afef15ce91e1a4098d` / `2026-08-13 07:35:11 UTC`) だったことから、これは
**トップページのデモ用に固定キャッシュされた静的レスポンス**であり、キー無しでの実クエリ実行は
一切できないことを確認した(`q=hello world` など他の文字列は即 401)。

### 2. Serper.dev (google.serper.dev) 疎通確認

```
$ curl -s -o /dev/null -w "HTTP %{http_code}\n" https://google.serper.dev/search
HTTP 403

$ curl -s -X POST https://google.serper.dev/search -H "Content-Type: application/json" -d '{"q":"test"}'
{"message":"Unauthorized. Sign up for a free account.","statusCode":403}
```

こちらはキー無しでは最初から一貫して403で、デモ抜け道は存在しない。

### 3. サインアップ要件の確認(WebFetchで signup/紹介ページを取得)

- `serpapi.com/users/sign_up`: 「Sign up with Github」「Sign up with Google」等の**OAuth連携ボタン**が
  中心で構成されており、規約への同意が必須と明記。実フォームはJS描画のため詳細フィールドはWebFetchでは
  取得しきれなかったが、いずれにせよ**実在のGitHub/Googleアカウントに紐づくブラウザ操作でのサインアップ**
  が前提。
- `serper.dev`: トップページに「Get 2,500 free queries」「No credit card required」と明記されており
  クレジットカードは不要と読み取れるが、アカウント作成自体はブラウザでのメール/OAuth登録が前提。

### 4. 本セッションでの実行可否

- 現在のツールセットに **ブラウザ操作(Chrome MCP)やメール受信手段は存在しない**
  (`ToolSearch`で確認したが、利用可能なのは読み取り専用の `WebFetch` のみで、フォーム送信・
  メール確認リンクのクリック・OAuth同意画面の操作はできない)。
- そのため test_plan の手順(1)「人間の手でメールアドレスのみでサインアップしAPIキーを取得」を
  **本セッション内で自動実行することができない**。この制約は既知情報にある Google CSE の
  「Chrome UI操作が必要で検証できない」問題と本質的に同種であり、`GOOGLE_API_KEY`側の403問題を
  回避する目的とは裏腹に、結局同じ「人間のブラウザ操作が必要」という壁に行き着いた。
- 従って test_plan (2)〜(5) (実クエリでの `organic_results` 取得、reverse-matchパイプラインへの投入、
  ヒット率測定)は**未実施**。

## 結論

- **仮説の技術的な骨子**(SerpApi/Serper.devが自社GCPプロジェクトの設定に依存しない独立したSaaSであり、
  無料キー無しでは動作しない=有料/無料枠ともにAPIキー必須であること)は実機で確認できた。
- しかし**サインアップ自体がAPIキー無しの自動化手段では突破できない**(GitHub/Google OAuth or
  メール確認を伴うブラウザ操作が必須)ため、「自社GCP CSEの403を回避できるか」という当初の狙い
  (=Chrome UI無しで検証を進められるか)は**達成できなかった**。むしろ「Chrome UI必須」という
  制約自体は温存されたままで、CSE問題からSerpApi/Serper.devの問題へスライドしただけ、というのが
  実態に近い。
- **次アクション**: 人間オペレーターがブラウザで実際にSerpApi(GitHub/Googleアカウントでサインアップ)
  または Serper.dev(クレジットカード不要・2,500クレジット無料と明記)のいずれかでAPIキーを発行し、
  そのキーをこのPoCディレクトリの `.env` (例: `SERPAPI_KEY=`, `SERPER_API_KEY=`) に追記してくれれば、
  test_plan (2)以降(`site:tiktok.com`/`site:instagram.com` クエリでの実データ取得と
  reverse-matchパイプラインでの店舗特定率測定)は即座に再開できる状態にある。

## 実行コマンド一覧(再現用)

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://serpapi.com/
curl -s "https://serpapi.com/search.json?engine=google&q=test&num=10"
curl -s "https://serpapi.com/search.json?engine=google&q=site%3Atiktok.com%20%E3%83%A9%E3%83%BC%E3%83%A1%E3%83%B3%20%E6%B8%8B%E8%B0%B7&num=10&hl=ja&gl=jp"
curl -s -o /dev/null -w "HTTP %{http_code}\n" https://google.serper.dev/search
curl -s -X POST "https://google.serper.dev/search" -H "Content-Type: application/json" -d '{"q":"test"}'
```
