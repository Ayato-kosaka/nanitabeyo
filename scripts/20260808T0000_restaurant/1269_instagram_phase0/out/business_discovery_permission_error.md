# business_discovery が `(#10) Application does not have permission for this action` で全滅した件

測定日: 2026-08-27 / 実行元: EC2（`graph.facebook.com` はサンドボックスから proxy 403 で塞がっている）

## 結論

**トークンの権限不足。** 一次資料（`docs/02_business_discovery.md` A 節）が必須としている 3 つのうち
**`instagram_manage_insights` が付与されていない**。

一次資料の必須 permission: `instagram_basic` / `instagram_manage_insights` / `pages_read_engagement`
実際のスコープ: `instagram_basic` / `pages_read_engagement` / `pages_show_list` / `business_management` /
`instagram_content_publish` / `public_profile` → **`instagram_manage_insights` だけが無い**

## 「Standard Access だから他人を引けない」説は消えた

**自分が完全に管理している `nanitabeyo.social` を対象にした business_discovery（D）でも同じ #10 が出た。**
対象の所有関係と無関係にエラーになるので、これは access level の話ではなく permission の話である。
一次資料の表（"My app is only for a business I own or manage → Standard Access / App Review: Not required"）
と矛盾しない。

同じトークンで `instagram_basic` 系（A / B）と `pages_read_engagement`（C）は通っている。
つまりアプリ・ページ・IG アカウントの配線自体は正常。

## 生ログ
```
Thu Aug 27 23:06:10 UTC 2026
--- A. 自分の IG の基本情報（instagram_basic があれば通る）
  {"username":"nanitabeyo.social","media_count":5,"followers_count":18,"website":"https:\/\/app.nanitabeyo.net\/store","biography":"\\\u4f55\u98df\u3079\u305f\u3044\u304b\u3092\u63d0\u6848\u3057\u3066\u304f\u308c\u308b\u30a2\u30d7\u30ea\/\n.\n\ud83d\udc64\u958b\u767a\u8005: \u0040ayato.arigato \n\ud83c\udf74\u3082\u3046\u98f2\u98df\u5e97\u63a2\u3057\u3067\u56f0\u3089\u306a\u3044\uff01\n.\n\u2193\u30a2\u30d7\u30ea\u306e
--- B. 自分の IG の media（instagram_basic）
  {"data":[{"caption":"\u300e\u4f55\u3092\u98df\u3079\u305f\u3044\u304b\u300f\u3092\u6559\u3048\u3066\u304f\u308c\u308b\u30a2\u30d7\u30ea\n\n\u6761\u4ef6\u306b\u5408\u3063\u305f\u6599\u7406\u3001\u30ec\u30b9\u30c8\u30e9\u30f3\u3092\u63d0\u6848\u3057\u3066\u304f\u308c\u307e\u3059\u3002\u7d76\u5bfe\u8ff7\u308f\u306a\u3044\u3088\u3046\u8a2d\u8a08\u3055\u308c\u3066\u3044\u308b\u306e\u3067\u3001\u3059\u3050\u6c7a\u3081\u308
--- C. Page 情報（pages_read_engagement）
  {"name":"\u306a\u306b\u98df\u3079\u3088\uff5c\u30b0\u30eb\u30e1\u30a2\u30d7\u30ea","id":"942369855616691"}
--- D. business_discovery で「自分自身」を引く（相手の種別と無関係に権限だけを試す）
  {"error":{"message":"(#10) Application does not have permission for this action","type":"OAuthException","code":10,"fbtrace_id":"AT2i3Y5Qhnqd4cRMPST63x5"}}
--- E. business_discovery で他店（最小フィールド）
  {"error":{"message":"(#10) Application does not have permission for this action","type":"OAuthException","code":10,"fbtrace_id":"ApU1UEYuajHkct5EHl_hV7w"}}
--- F. business_discovery で他店（username だけ）
  {"error":{"message":"(#10) Application does not have permission for this action","type":"OAuthException","code":10,"fbtrace_id":"A8FSuol2Ik4MIfdbdfNPOwB"}}
--- G. アプリ自体の情報（Live/Development の手掛かり）
  {"id":"1605989120913742","name":"nanitabeyo-1273-sns-poc","link":"https:\/\/www.facebook.com\/games\/?app_id=1605989120913742"}
--- H. 現在のスコープ ---
{"data":[{"permission":"pages_show_list","status":"granted"},{"permission":"business_management","status":"granted"},{"permission":"instagram_basic","status":"granted"},{"permission":"instagram_content_publish","status":"granted"},{"permission":"pages_read_engagement","status":"granted"},{"permission":"public_profile","status":"granted"}]}
```
