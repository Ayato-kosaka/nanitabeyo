# 店舗ページから Instagram URL を抽出する用途の利用規約調査

- 調査日: 2026-08-26（UTC）
- 取得方法: `curl -s -A "nanitabeyo-research/1.0"`（robots.txt と規約ページのみ取得。店舗ページは取得していない）
- 判定基準: 依頼元 nanitabeyo は**商用の飲食アプリ**。したがって「非営利なら可」の条項は該当しない。
  既判定の食べログ（「営業活動その他の営利を目的とした行為又はそれに準ずる行為やそのための準備行為を目的として、利用又はアクセスしてはならない」）と
  ホットペッパーグルメ（飲食店から対価を得るビジネスに関わるサイトでの利用禁止）は**不可**。
- 本書の引用はすべて上記日時に実際に取得した原文からの逐語引用。要約していない。

---

## 1. 一覧表

| # | サイト | robots.txt（店舗詳細ページ） | 規約の該当条文の要点 | 判定 |
|---|--------|------------------------------|----------------------|------|
| 1 | ぐるなび（r.gnavi.co.jp） | HTTP 200。`/<店舗ID>/` 形式の店舗ページは `User-agent: *` で Disallow されていない（都道府県パス `/tokyo/` 等は Disallow）。ただし `ClaudeBot` / `anthropic-ai` / `GPTBot` / `CCBot` 等は `Disallow: /` | 第7条(12)「ぐるなびに無断でぐるなびサイトを営利目的に利用する行為」禁止、(13) 無断転載・蓄積の禁止、第9条2「私的利用の範囲に限って」ダウンロード可。リンクポリシーで「営利目的のリンク」もお断り（要問い合わせ） | **不可**（ぐるなびの事前承諾があれば可の余地） |
| 2 | ヒトサラ（hitosara.com） | HTTP 200。Baiduspider のみ `Disallow: /`。他は制限なし | 第6条「本ツール及び本サービス（**これらへのアクセスを含みます。**）について、その全部あるいは一部を問わず、**私的に閲覧して楽しむ以外の目的で利用**（使用、複製、複写、販売、上映など形態のいかんを問いません。）する行為」を禁止。第6条「商業目的で使用すること」も禁止 | **不可**（食べログ型。アクセスまで禁止） |
| 3 | Retty（retty.me） | HTTP 200。`/restaurant/*/amp` は Disallow だが店舗ページ本体は Disallow されていない | 第14条(15)「**本サービスと競合するサービスに利用することを目的とした行為（情報収集等を目的とした行為を含む）**」を禁止。第13条2 無断複製・転載等の禁止 | **不可**（競合サービス目的の情報収集を名指しで禁止） |
| 4 | エキテン（ekiten.jp） | HTTP 200。店舗ページは Disallow されていない（`Allow: /api/shops/*/instagram/` の記載すらある）。`GoogleOther` / `Bytespider` は `Disallow: /` | 第12条(1)「自らまたは第三者のための**営業活動および営利を目的とする行為またはそれに準ずる行為**等を目的として、**閲覧、利用またはアクセスしてはならない**」。加えて「クローラー、スクレイピング、RPA等の自動化された手段を用いた情報の取得、収集」も禁止 | **不可**（食べログ型＋自動取得の明示禁止） |
| 5 | まいぷれ（mypl.net） | HTTP 200。`Disallow: /user/` `/m/` のみ。店舗ページは許可。**`Crawl-delay: 90`** | 営利目的の利用を禁じる条項なし。掲載情報の転載を禁じる条項もなし。禁止事項は「本サイトのサーバーに過度の負担を及ぼす行為」「本サイトの運営を妨害する行為、運営会社が不適切であると判断する行為」等 | **条件付き可**（条件は §5 に明記） |
| 6 | Yahoo!ロコ（loco.yahoo.co.jp） | robots.txt は HTTP 200 で残存するが、サイト本体は `https://thanks.yahoo.co.jp/`（サービス終了ページ）へリダイレクト | Yahoo!ロコ自体が終了。後継の Yahoo!マップ等に適用される LY利用規約 14.「当社サービス等の再利用の禁止」「当社サービスやそれらを構成するデータを、その提供目的を超えて利用することができません」、15.(11) 営利目的行為の禁止、8.3 転載の禁止 | **不可**（サービス終了。後継サービスも LY規約で不可） |
| 7 | 一休.comレストラン（restaurant.ikyu.com） | **robots.txt が HTTP 403**（`https://restaurant.ikyu.com/robots.txt`、`https://www.ikyu.com/robots.txt` とも 403） | 規約ページも全て HTTP 403 で**取得できなかった** | **不可（取得不能・実質アクセス拒否）**。規約原文が確認できないため契約面は**判断保留** |
| 8 | SAVOR JAPAN（savorjapan.com） | HTTP 200。`Disallow: /reservations/` `/members/` のみ | Article 8「Use of the service or **access to the site**, in whole or in part, **for purposes other than enjoying private browsing**」を禁止。「Users utilizing all or part of the service and its tools or commercial purposes.」も禁止 | **不可**（ヒトサラと同型。運営は同じ USEN） |
| 9a | 京都市観光協会（www.kyokanko.or.jp） | HTTP 200。`Disallow: /wp/wp-admin/` のみ（`Disallow:` 空＝全許可） | 「利用者は、**私的使用など法律によって認められる範囲を超えて無断で転用、複製等をすることはできません。**」営利アクセス禁止・自動取得禁止の条項はなし | **条件付き可**（事前許諾が条件） |
| 9b | 札幌観光協会（www.sapporo.travel） | HTTP 200。`Content-Signal: search=yes,ai-train=no,use=reference`、`ClaudeBot` `GPTBot` `CCBot` 等は `Disallow: /`。一般 UA は `Allow: /` | 「私的使用のための複製や、引用など著作権法上認められた場合を除き、当WEBサイトの掲載コンテンツを複製・転用する際は、**必ず事前に一般社団法人札幌観光協会にご相談ください**」 | **条件付き可**（事前相談・許諾が必須） |
| 9c | 福岡市観光情報 よかなび（yokanavi.com） | HTTP 200。ルールなし（コメント1行のみ＝全許可） | 「コンテンツを当事務局、原著作者またはその他の権利者の**許諾を得ることなく、複製、公衆送信、改変、切除、お客様のサイトへの転載等する行為は著作権法により禁止**されていますので、事前に当事務局にご連絡の上、許諾を得ていただくようお願いいたします。」 | **条件付き可**（事前許諾が必須） |
| 10a | 戸越銀座商店街（www.togoshiginza.jp） | HTTP 200。`Disallow: /wp-admin/` のみ | 「著作権法により認められている引用の範囲である場合を除き『内容、テキスト、画像等』の**無断転載・使用を固く禁じます。**」 | **条件付き可**（事前許諾が必須。無許諾では不可） |
| 10b | 巣鴨地蔵通り商店街（sugamo.or.jp） | HTTP 200。`Disallow: /wp-admin/` のみ | 利用規約・サイトポリシーのページが見つからない（`/policy/` `/privacy/` はいずれも HTTP 404） | **規約が見つからない** |
| 10c | 天神橋筋商店街（www.tenjin123.com） | HTTP 200。`Disallow: /wp-admin/` のみ | 同上（`/policy/` `/privacy/` `/about/` はいずれも HTTP 404） | **規約が見つからない** |
| 11 | OpenStreetMap | HTTP 200。robots.txt 冒頭に「We encourage you to use these instead of scraping our site.」（planet / 地域抽出の利用を推奨）。`/node` `/way` `/api/` 等は Disallow | ODbL：「You are free to copy, distribute, transmit and adapt our data, as long as you credit OpenStreetMap and its contributors. If you alter or build upon our data, you may distribute the result only under the same license.」 | **可**（ODbL の帰属表示＋Share-Alike 遵守が条件。取得は planet/Overpass 等の一括配布経由） |

---

## 2. サイトごとの逐語引用

### 1. ぐるなび

- robots.txt: `https://r.gnavi.co.jp/robots.txt`（HTTP 200, 175,139B）、`https://www.gnavi.co.jp/robots.txt`（HTTP 200）
- 利用規約: `https://corporate.gnavi.co.jp/agreement/`（HTTP 200）
- リンクポリシー: `https://corporate.gnavi.co.jp/policy/linkpolicy/`（HTTP 200）
- 利用条件: `https://corporate.gnavi.co.jp/agreement/webuse/`（HTTP 200。推奨ブラウザ等の技術的事項のみで、営利・自動取得に関する記載なし）

robots.txt（`r.gnavi.co.jp`、末尾部分の逐語）:

```
User-agent: CCBot
Disallow: /

User-agent: GPTBot
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: Amazonbot
Disallow: /

User-agent: FacebookBot
Disallow: /

User-agent: anthropic-ai
Disallow: /

User-agent: Claude-Web
Disallow: /
...
User-agent: ClaudeBot
Disallow: /

User-agent: claudebot
Disallow: /
```

店舗詳細ページ（`https://r.gnavi.co.jp/<店舗ID>/`）に対応する `Disallow` は `User-agent: *` セクションに存在しない（`Disallow: /tokyo/` 等の都道府県一覧パス、`/list/`、`/reserve/`、`/rsapi/`、各種クエリ付き URL は Disallow）。

利用規約 第7条（禁止事項）逐語:

> (12) ぐるなびに無断でぐるなびサイトを営利目的に利用する行為
> (13) ぐるなびサイト若しくはぐるなびが提供する各種サービス、ぐるなびコンテンツ（第９条に定義します。）の全部または一部を、ぐるなびに無断で転載、蓄積、販売、再許諾、自己が利用する範囲を超えて複製、複写する行為

第9条（知的財産権）逐語:

> 1.  ぐるなびサイト内に掲載されている各種コンテンツ（以下「ぐるなびコンテンツ」といい、各種情報、データ、ソフトウェア、音楽、音声、写真、画像、映像等を含みますが、これらに限られません。）についての一切の権利（所有権、知的財産権、肖像権、パブリシティー権等）は、ぐるなびまたはぐるなびが許諾を受けている当該権利を有する第三者に帰属します。
> 2.  お客様は、私的利用の範囲に限って、ぐるなびコンテンツをダウンロードや印刷をしてご利用することができます。但し、ぐるなびコンテンツに表示される著作権表示、商標権表示、その他の権利者を示す表示を削除・改定・変更して利用することはできません。

リンクポリシー逐語（抜粋）:

> 1. 以下に該当するリンクはお断りします。また、これらを発見した場合には、当社はリンク元に対し、リンクの中止等を要請する場合があります。その際は速やかにご対応ください。
> ・レストラン検索ページ・お店のページ以外へのリンク
> （提携先との共同サイト、記事コンテンツへのリンクは禁止します）
> ・ぐるなびのページのコンテンツが、リンク元のページに取り込まれて表示されるような態様のリンク（著作権侵害に該当するようなリンク方法）
> ・営利目的のリンク（営利目的のリンクをご希望の場合は、下記にお問い合わせください）

**判定: 不可。** 「アクセス」「準備行為」という食べログ型の文言はないが、(12) が**営利目的利用そのものを無断では禁止**しており、第9条2 が**私的利用の範囲に限定**している。商用アプリのための抽出は明確にこの範囲外。ぐるなびの事前承諾（＝提携・API 契約）を得れば可の余地がある。

---

### 2. ヒトサラ

- robots.txt: `https://hitosara.com/robots.txt`（HTTP 200, 100B）

```
User-agent: Baiduspider
Disallow: /

User-agent: *
Sitemap: https://hitosara.com/sitemap_index.xml
```

- 利用規約: `https://usen.media/rules/hitosara/`（HTTP 200。hitosara.com のフッターからのリンク先）

第6条（禁止事項）逐語（該当行）:

> ユーザーが、本ツール及び本サービスの全部あるいは一部を、商業目的で使用すること。

> 本ツール及び本サービス（これらへのアクセスを含みます。）について、その全部あるいは一部を問わず、私的に閲覧して楽しむ以外の目的で利用（使用、複製、複写、販売、上映など形態のいかんを問いません。）する行為

第10条（知的財産権）逐語（抜粋）:

> ① 本サービスを通じて入手したコンテンツを複製すること。
> ② 本サービスのコンテンツの全部または一部を送信、送信可能化または第三者に頒布、販売、譲渡、貸与、翻訳、翻案、もしくは使用を許諾すること。

第9条（リンクの取扱い）逐語（抜粋）:

> ⑧ 営利目的や販売目的であること。

**判定: 不可。**「（これらへのアクセスを含みます。）」「私的に閲覧して楽しむ以外の目的で利用」は食べログの「アクセス」禁止と同等かそれ以上に広い。

---

### 3. Retty

- robots.txt: `https://retty.me/robots.txt`（HTTP 200, 1,751B）。店舗詳細ページ（`/restaurant/...`）自体は Disallow されていない（`Disallow: /restaurant/*/amp` のみ）。`Disallow: /API/`, `/restaurant-search/`, `/search/` 等あり。
- 利用規約: `https://retty.me/announce/tos/`（HTTP 200）

第14条（禁止行為）逐語（抜粋）:

> (8)営利を目的としたものや個人的な売買・譲渡を持ちかける内容、宣伝行為(当社の同意がある場合を除く)
> (14)本サービスと競合するサービスの提供、運営を自ら行い、または第三者をして行わせる行為並びにそれらのサービスへ他の利用者を勧誘する行為(当社の同意がある場合を除く)
> (15)本サービスと競合するサービスに利用することを目的とした行為（情報収集等を目的とした行為を含む）
> (19)通常利用の範囲を超えてサーバーに負担をかける行為

第13条（著作権等）2 逐語:

> 2.前項に定める著作権を除き、本サービスに関する著作権その他の権利は当社に帰属し、利用者は、本サービスに関するコンテンツを無断で複製、編集、改編、掲載、転載、公衆送信、上映、展示、提供、販売、譲渡、貸与、翻訳、翻案、二次利用等することはできません。

**判定: 不可。** nanitabeyo は飲食店を探すアプリであり Retty と競合する。第14条(15) が「情報収集等を目的とした行為を含む」と明記しているため、本件用途は直撃する。

---

### 4. エキテン

- robots.txt: `https://www.ekiten.jp/robots.txt`（HTTP 200, 1,796B）逐語（抜粋）:

```
User-agent: GoogleOther
User-agent: Bytespider
Disallow: /

User-Agent:*
# --- 検索結果・コンテンツ生成に必須のAPIを解放 ---
Allow: /api/shop-search/
...
Allow: /api/shops/*/instagram/
...
Disallow: /api/
```

- 利用規約: `https://www.ekiten.jp/documents/rule/`（HTTP 200。末尾に「2026年7月6日改定」）

第9条2 逐語（抜粋）:

> (4). 当サイトで提供される情報を私的な利用以外の目的(営利の目的を含む)で利用する行為
> (9). クローラー、スクレイピング、RPA（ロボティック・プロセス・オートメーション）等の自動化された手段を用いて、当サイトにアクセスし、当サイトの情報を取得・収集し、または当サイト上で自動化された操作（店舗情報の自動更新等を含みます）を行う行為

第12条(1) 逐語:

> (1). ユーザーは、当サイトに掲載される情報について、その全部もしくは一部に関わらず、自らまたは第三者のための営業活動および営利を目的とする行為またはそれに準ずる行為等を目的として、閲覧、利用またはアクセスしてはならないものとします。また、クローラー、スクレイピング、RPA等の自動化された手段を用いた情報の取得、収集、またはサイトの操作（自動更新等を含みます）を行ってはならないものとします。

**判定: 不可。** 食べログとほぼ同一文言（「営利を目的とする行為またはそれに準ずる行為等を目的として、閲覧、利用またはアクセスしてはならない」）に加え、スクレイピングを明示的に禁止している。robots.txt が `Allow: /api/shops/*/instagram/` を掲げていても、規約側が上位で禁止しているため不可。

---

### 5. まいぷれ

- robots.txt: `https://mypl.net/robots.txt`（HTTP 200, 69B）逐語:

```
User-agent: *
Allow: /
Disallow: /user/
Disallow: /m/
Crawl-delay: 90
```

- 利用規約: `https://mypl.net/use_policy/`（HTTP 200）

禁止事項 逐語（全項）:

> ・法令に違反する行為及び違反する行為を幇助・勧誘・強制・助長する行為
> ・本サイトのサーバーに過度の負担を及ぼす行為
> ・本サイトの運営を妨害する行為、運営会社が不適切であると判断する行為
> ・他の利用者の本サイト利用を妨害する行為
> ・選挙の事前運動、選挙運動又はこれらに類似する行為、及び公職選挙法に抵触する行為
> ・他人の名誉、社会的信用、プライバシー、肖像権、パブリシティ権、著作権その他の知的財産権、その他の権利を侵害する行為(法令で定めたもの及び判例上認められたもの全てを含む)
> ・他の利用者への中傷、脅迫、いやがらせに該当する行為
> ・差別につながる民族・宗教・人種・性別・年齢等に関する表現行為
> ・自殺、集団自殺、自傷、違法薬物使用、脱法薬物使用等を勧誘・誘発・助長するような行為
> ・性交及びわいせつな行為を目的とした出会い等を誘導する行為
> ・性的、わいせつ的、暴力的な表現行為、その他人に過度の不快感を及ぼすおそれのある行為
> ・児童買春・ポルノ、無修正ビデオ動画のダウンロードサイト等へのリンク掲載
> ・運営会社の許諾を得ない売買行為、オークション行為、金銭支払やその他の類似行為
> ・運営会社の許諾を得ない商品やサービスの広告、宣伝を目的としたプロフィール内容の公開、その他スパムメール、チェーンメール等の勧誘を目的とする行為
> ・他人の名義、その他会社等の組織名を名乗ること等による、なりすまし行為
> ・公序良俗、一般常識に反する行為
> ・その他上記に準じる行為

著作権に関する記載は、利用者の書き込みテキストについてのみ:

> 本サイトにおける利用者の書き込みテキストに関する著作権については、利用者が書き込みした時点においてその一切が運営会社に譲渡されるものとし、（略）

**判定: 条件付き可。** 営利目的の利用・アクセス・準備行為を禁じる条項は**存在しない**。自動取得・スクレイピングを禁じる条項も**存在しない**。掲載情報の転載を禁じる条項も**存在しない**。

条件（すべて満たすこと）:
1. `Crawl-delay: 90` を遵守する（1リクエスト/90秒）。「本サイトのサーバーに過度の負担を及ぼす行為」が禁止事項に含まれるため、これは必須。
2. `/user/` `/m/` 配下は取得しない。
3. 取得するのは Instagram の URL（事実情報）に限り、紹介文・写真等の著作物性のあるコンテンツは複製しない。
4. 「運営会社が不適切であると判断する行為」という包括条項があるため、継続利用するなら運営（株式会社フューチャーリンクネットワーク）への事前連絡が望ましい。

---

### 6. Yahoo!ロコ / Yahoo!プレイス

- robots.txt: `https://loco.yahoo.co.jp/robots.txt`（HTTP 200, 928B。`Disallow: /place/*/information/` 等を含むが、`/place/<id>/` 本体は Disallow されていない）
- サイト本体: `https://loco.yahoo.co.jp/` および `https://loco.yahoo.co.jp/terms/` は **`https://thanks.yahoo.co.jp/` へリダイレクト**（HTTP 200）。そのページ逐語:

> サービス終了のお知らせ
> いつもYahoo! JAPANのサービスをご利用いただき誠にありがとうございます。
> お客様がアクセスされたサービスは本日までにサービスを終了いたしました。

- `https://places.yahoo.co.jp/` は HTTP 403。
- 適用規約（終了ページからリンクされている「利用規約」）: `https://www.lycorp.co.jp/ja/company/terms/`（HTTP 200）

LY利用規約 逐語（抜粋）:

> 8.3. お客様は、本コンテンツを、当社サービスが予定している利用態様を超えて利用（複製、送信、転載、改変を含みます。）をしてはなりません。

> 14. 当社サービス等の再利用の禁止
> お客様は、別途当社が定める場合を除き、当社サービスやそれらを構成するデータを、その提供目的を超えて利用することができません。この場合、当社は、それらの行為を差し止める権利ならびにそれらの行為によってお客様が得た利益相当額を請求する権利を有します。

> （11）営業、宣伝、広告、勧誘、その他営利を目的とする行為や面識のない第三者との出会いや交際を目的とする行為（当社の認めたものを除きます。）、（略）その他当社サービスが予定している利用目的と異なる目的で当社サービスを利用する行為

参考（後継となる Yahoo!マップ）: `https://map.yahoo.co.jp/robots.txt`（HTTP 200）逐語（抜粋）:

```
User-agent: GPTBot
Disallow: /

User-agent: ChatGPT-User
Disallow: /

User-agent: ClaudeBot
Disallow: /

User-agent: Claude-User
Disallow: /

User-agent: Claude-Web
Disallow: /

User-agent: PerplexityBot
Disallow: /
```

**判定: 不可。** Yahoo!ロコ自体が終了しており対象が存在しない。後継の LY 系サービスは規約14.「再利用の禁止」と15.(11) 営利目的利用の禁止により不可。

---

### 7. 一休.comレストラン

取得結果（すべて `curl -s -A "nanitabeyo-research/1.0"`、`Accept: text/html,*/*` / `Accept-Language: ja` を付けても同じ）:

| URL | HTTP |
|-----|------|
| `https://restaurant.ikyu.com/robots.txt` | 403 |
| `https://www.ikyu.com/robots.txt` | 403 |
| `https://restaurant.ikyu.com/` | 403 |
| `https://restaurant.ikyu.com/terms/` | 403 |
| `https://www.ikyu.com/terms/` | 403 |
| `https://www.ikyu.com/guide/agreement/` | 403 |
| `https://www.ikyu.com/guide/` | 403 |

403 のレスポンス本文の冒頭（逐語）:

> [一休.com] アクセスしようとしたページは表示できませんでした。

**判定: 不可（取得不能・実質アクセス拒否）／規約面は判断保留。** robots.txt そのものが 403 を返すため、ロボット排除規約の慣行上は「全面 Disallow」として扱うべき状態。規約原文が取得できていないので、契約上の可否は**判断保留**とする。利用したい場合は一休へ直接照会が必要。

---

### 8. SAVOR JAPAN

- robots.txt: `https://savorjapan.com/robots.txt`（HTTP 200, 406B）逐語:

```
User-agent: *
Sitemap: https://savorjapan.com/en_sitemap.xml
...
Disallow: /reservations/
Disallow: /members/
```

- 利用規約: `https://savorjapan.com/terms`（HTTP 200。英文。運営は USEN CORPORATION）
- 参考: `https://usen.media/rules/savorjapan/`（HTTP 200）は**加盟店向けの掲載契約約款**であり、サイト利用者向け規約ではない。

Article 8 (Prohibitions) 逐語（抜粋）:

> Users utilizing all or part of the service and its tools or commercial purposes.

> Use of the service or access to the site, in whole or in part, for purposes other than enjoying private browsing (regardless of the form of use, such as use, duplication, copy, sale or screening etc.).

Article 11 (Intellectual Property) 逐語（抜粋）:

> Duplication of content obtained through the service.
> Transmit or enable the transmission of all or part of the content of the service, or the distribution, sale, transfer, lease, translation, adaptation or licensing to third parties.

Article 10 (Handling Links) 逐語（抜粋）:

> Not for commercial or sales purposes

**判定: 不可。** ヒトサラの日本語条文の英訳に相当し、「access to the site ... for purposes other than enjoying private browsing」を明示的に禁止している。

---

### 9. 自治体観光協会サイト（3件）

#### 9a. 公益社団法人 京都市観光協会

- robots.txt: `https://www.kyokanko.or.jp/robots.txt`（HTTP 200, 250B）逐語:

```
User-agent: *
Disallow: /wp/wp-admin/
Allow: /wp/wp-admin/admin-ajax.php

# START YOAST BLOCK
# ---------------------------
User-agent: *
Disallow:

Sitemap: https://www.kyokanko.or.jp/sitemap_index.xml
# ---------------------------
# END YOAST BLOCK
```

- 規約: `https://www.kyokanko.or.jp/terms/`（HTTP 200）逐語（該当箇所）:

> 本サイトにて提供されているコンテンツに関する権利は、京都市観光協会またはコンテンツ提供者に帰属しています。（文章・画像・イラスト等すべてを含む。） 利用者は、私的使用など法律によって認められる範囲を超えて無断で転用、複製等をすることはできません。

> 当サイトに掲載されているすべての名称、商標、ロゴマーク、商号に関する権利は、京都市観光協会事務所またはそれぞれの権利の所有者に帰属しますので、無断で使用することはできません。

**判定: 条件付き可。** 営利目的の利用・アクセスを禁じる条項も、自動取得を禁じる条項も**存在しない**。ただし「私的使用など法律によって認められる範囲を超えて無断で転用、複製等」は禁止されているため、**協会への事前照会・許諾取得**を条件とする。無許諾の場合は、Instagram URL が著作物にあたらない事実情報であるという解釈に依存するため**判断保留**。

#### 9b. 一般社団法人 札幌観光協会（www.sapporo.travel）

- robots.txt: `https://www.sapporo.travel/robots.txt`（HTTP 200, 1,963B）逐語（抜粋）:

```
User-agent: *
Content-Signal: search=yes,ai-train=no,use=reference
Allow: /

User-agent: Amazonbot
Disallow: /
...
User-agent: ClaudeBot
Disallow: /
...
User-agent: GPTBot
Disallow: /
```

- 規約: `https://www.sapporo.travel/about-us/copyright/` → `https://www.sapporo.travel/info/about/copyright/`（HTTP 200）逐語（該当箇所）:

> 私的使用のための複製や、引用など著作権法上認められた場合を除き、当WEBサイトの掲載コンテンツを複製・転用する際は、必ず事前に一般社団法人札幌観光協会にご相談ください（ご連絡は こちら から）。

> 本サイトに掲載された文章、写真等の無断転載は固くお断りいたします。画像の使用をご希望の方は、観光写真ライブラリーをご活用ください。

**判定: 条件付き可。** 営利目的アクセスの禁止条項はないが、複製・転用には**事前相談が必須**と明記。加えて `ai-train=no` / `use=reference` のコンテンツシグナルが宣言されており、AI学習用途は明確に不可。

#### 9c. 福岡市観光情報サイト よかなび（yokanavi.com）

- robots.txt: `https://yokanavi.com/robots.txt`（HTTP 200, 99B）逐語:

```
# See https://www.robotstxt.org/robotstxt.html for documentation on how to use the robots.txt file
```

（ルール記述なし＝全許可）

- 規約: `https://yokanavi.com/terms`（HTTP 200）逐語（該当箇所）:

> 個人的な利用を目的として印字や保存等する場合、その他著作権法により認められる場合を除き、コンテンツを当事務局、原著作者またはその他の権利者の許諾を得ることなく、複製、公衆送信、改変、切除、お客様のサイトへの転載等する行為は著作権法により禁止されていますので、事前に当事務局にご連絡の上、許諾を得ていただくようお願いいたします。なお、肖像、第三者の著作物・商標等が含まれている場合、当事務局が不適切と判断する場合等、ご利用をお断りする場合もあります。

> 当事務局の許諾を得てコンテンツを利用する場合、当事務局指定の著作権表示を行ってください。当事務局の事前の了承なく、著作権表示を変更、削除することを禁止します。

**判定: 条件付き可。** 営利目的アクセスの禁止条項はない。ただし転載には**事前連絡と許諾が必要**、かつ許諾時は**指定の著作権表示**を行う義務がある。

---

### 10. 商店街の店舗一覧サイト（3件）

#### 10a. 戸越銀座商店街（www.togoshiginza.jp）

- robots.txt: `https://www.togoshiginza.jp/robots.txt`（HTTP 200, 67B）逐語:

```
User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php
```

- 規約（サイトポリシー）: `https://www.togoshiginza.jp/policy/`（HTTP 200）逐語（該当箇所）:

> 著作権について
> 当サイトに掲載されている情報についての著作権は放棄しておりません。
> 著作権法により認められている引用の範囲である場合を除き「内容、テキスト、画像等」の無断転載・使用を固く禁じます。

**判定: 条件付き可（無許諾では不可）。** 営利目的アクセスの禁止条項はないが、「無断転載・使用を固く禁じます」と明記されているため、事前許諾が必須。

#### 10b. 巣鴨地蔵通り商店街（sugamo.or.jp）

- robots.txt: `https://sugamo.or.jp/robots.txt`（HTTP 200, 113B）逐語:

```
User-agent: *
Disallow: /wp-admin/
Allow: /wp-admin/admin-ajax.php

Sitemap: https://sugamo.or.jp/wp-sitemap.xml
```

- 規約: `https://sugamo.or.jp/policy/` HTTP 404、`https://sugamo.or.jp/privacy/` HTTP 404。トップページ HTML 内に著作権・利用条件の記載を発見できず。

**判定: 規約が見つからない。**

#### 10c. 天神橋筋商店街（www.tenjin123.com）

- robots.txt: `https://www.tenjin123.com/robots.txt`（HTTP 200, 166B）逐語:

```
User-agent: *
Allow: /wp-admin/admin-ajax.php
Disallow: /wp-admin/

Sitemap: https://www.tenjin123.com/sitemap.xml
Sitemap: https://www.tenjin123.com/sitemap.rss
```

- 規約: `https://www.tenjin123.com/policy/` `https://www.tenjin123.com/privacy/` `https://www.tenjin123.com/about/` すべて HTTP 404。トップページ HTML 内に著作権・利用条件の記載を発見できず。

**判定: 規約が見つからない。**

> 注: 商工会議所サイト（`https://www.jcci.or.jp/robots.txt` HTTP 200、`https://www.tokyo-cci.or.jp/robots.txt` HTTP 200）も robots.txt を確認したが、いずれも飲食店の店舗詳細ページ（Instagram URL を含むもの）を持つ「店舗一覧サイト」ではないため、上記の商店街サイト3件を例として調査した。

---

### 11. OpenStreetMap

- robots.txt: `https://www.openstreetmap.org/robots.txt`（HTTP 200）逐語（冒頭）:

```
# OpenStreetMap's data is available for free in bulk from https://planet.openstreetmap.org
# For regional extracts and documentation, see https://wiki.openstreetmap.org/wiki/Planet.osm
# We encourage you to use these instead of scraping our site.
# Scraping puts a high load on our donated resources and will lead to your IP being blocked.
# Please respect our resources, and help us keep the service free and accessible for everyone.

User-agent: *
Disallow: /user/*/traces/
Disallow: /user/*/history
Allow: /user/
Disallow: /traces
Disallow: /api/
Disallow: /edit
Disallow: /changeset
Disallow: /node
Disallow: /note
Disallow: /relation
Disallow: /way
...
```

- ライセンス: `https://www.openstreetmap.org/copyright`（HTTP 200）逐語:

> OpenStreetMap is open data, licensed under the Open Data Commons Open Database License (ODbL) by the OpenStreetMap Foundation (OSMF). In summary:
> You are free to copy, distribute, transmit and adapt our data, as long as you credit OpenStreetMap and its contributors. If you alter or build upon our data, you may distribute the result only under the same license. The full legal code at Open Data Commons explains your rights and responsibilities.

> Where you use OpenStreetMap data, you are required to do the following two things:
> Provide credit to OpenStreetMap by displaying our attribution notice.
> Make clear that the data is available under the Open Database License.

#### socials タグの扱い

- `https://wiki.openstreetmap.org/wiki/Key:contact:instagram`（HTTP 200）逐語（抜粋）:

> Username or URL of the Instagram page at which the point of interest can be contacted. Also used on Threads.

> Status: de facto

> To define a Instagram page or profile of an object. The value is the page/profile URL or the Pagename. In most cases, the full URL is used as value. It is also possible to add the username or page name only (the part after the last '/'). This requires the user software to add the appropriate URL prefix, but it makes it easier to adapt to special needs like offering the mobile version of the page or a random language version.

> contact:instagram = https://www.instagram.com/InstagramUserName
> contact:instagram = InstagramUserName
> As described above, both versions are valid.

関連キーとして wiki は `brand:instagram=*`、`operator:instagram=*`、`instagram=*` を挙げている。

**判定: 可（ODbL 条件付き）。** 実装上の注意:
1. 取得は `www.openstreetmap.org` のスクレイピングではなく、planet ファイル / 地域抽出 / Overpass API 経由で行う（robots.txt 冒頭で明示的にそう要請されている。`/node` `/way` は Disallow）。
2. 帰属表示（"© OpenStreetMap contributors"）と ODbL である旨の明示が必須。
3. 値は URL 形式とユーザー名のみの形式の両方が有効なので、`contact:instagram` / `instagram` / `brand:instagram` / `operator:instagram` を読み、`https://www.instagram.com/` プレフィックスの有無を正規化する必要がある。
4. Share-Alike（派生データベースの同一ライセンス配布義務）は「Produced Work」としてアプリ画面に表示する限り通常は発生しないが、**OSM 由来データを含む DB そのものを第三者に配布する場合は ODbL の適用を受ける**。

---

## 3. 取得できなかったもの

| URL | HTTP | 備考 |
|-----|------|------|
| `https://restaurant.ikyu.com/robots.txt` | 403 | 本文「[一休.com] アクセスしようとしたページは表示できませんでした。」 |
| `https://www.ikyu.com/robots.txt` | 403 | 同上 |
| `https://restaurant.ikyu.com/` | 403 | 同上 |
| `https://restaurant.ikyu.com/terms/` | 403 | 同上 |
| `https://www.ikyu.com/terms/` | 403 | 同上 |
| `https://www.ikyu.com/guide/agreement/` | 403 | 同上 |
| `https://www.ikyu.com/guide/` | 403 | 同上 |
| `https://about.yahoo.co.jp/common/terms/` | 000（接続失敗） | 代替として `https://www.lycorp.co.jp/ja/company/terms/`（HTTP 200）を取得 |
| `https://loco.yahoo.co.jp/terms/` | 200 だが `https://thanks.yahoo.co.jp/` にリダイレクト | Yahoo!ロコはサービス終了 |
| `https://places.yahoo.co.jp/` | 403 | Yahoo!プレイス側の入口は確認できず |
| `https://www.gotokyo.org/robots.txt` | 000（接続失敗） | 観光協会サイトの候補から除外 |
| `https://ja.kyoto.travel/robots.txt` | 404 | 代わりに `https://www.kyokanko.or.jp/` を調査 |
| `https://sugamo.or.jp/policy/`, `/privacy/` | 404 | 規約ページを発見できず |
| `https://www.tenjin123.com/policy/`, `/privacy/`, `/about/` | 404 | 規約ページを発見できず |
| `https://corporate.retty.me/terms/` | 000（接続失敗） | 代替として `https://retty.me/announce/tos/`（HTTP 200）を取得 |
| `https://retty.me/terms/`, `https://retty.me/announce/terms/` | 404 | 同上 |
| `https://www.gnavi.co.jp/sitemanager/kiyaku/` ほか候補 | 404 | 代替として `https://corporate.gnavi.co.jp/agreement/`（HTTP 200）を取得 |

---

## 4. 結論: 商用アプリが店舗の Instagram URL を抽出する用途で使えるサイト

| サイト | 判定 | 満たすべき条件 |
|--------|------|----------------|
| **OpenStreetMap** | **可** | ODbL の帰属表示（"© OpenStreetMap contributors"）と ODbL 明示。取得は planet / 地域抽出 / Overpass 経由（サイト本体をスクレイピングしない）。`contact:instagram` / `instagram` / `brand:instagram` / `operator:instagram` を読む。DB そのものを再配布する場合は Share-Alike が発生 |
| **まいぷれ（mypl.net）** | **条件付き可** | `Crawl-delay: 90` 厳守（1req/90秒）。`/user/` `/m/` は取得しない。Instagram URL 等の事実情報のみを取得し、紹介文・写真は複製しない。包括条項があるため運営（フューチャーリンクネットワーク）への事前連絡を推奨 |
| **京都市観光協会（www.kyokanko.or.jp）** | **条件付き可** | 「私的使用の範囲を超えた無断転用・複製」が禁止されているため、**協会への事前照会・許諾取得が条件**。無許諾での実施は判断保留 |
| **札幌観光協会（www.sapporo.travel）** | **条件付き可** | 「複製・転用する際は、必ず事前に…ご相談ください」＝**事前相談・許諾が必須**。`ai-train=no` のため AI 学習用途は不可 |
| **よかなび（yokanavi.com）** | **条件付き可** | **事前連絡と許諾が必須**。許諾時は事務局指定の著作権表示を行う |
| **戸越銀座商店街（www.togoshiginza.jp）** | **条件付き可** | 「無断転載・使用を固く禁じます」＝**商店街振興組合の事前許諾が必須** |
| 巣鴨地蔵通り商店街 / 天神橋筋商店街 | **規約が見つからない** | robots.txt は全許可だが、利用条件の明文がないため、実施するなら運営者への直接照会が必要 |

**使えないサイト（不可）**: ぐるなび、ヒトサラ、Retty、エキテン、SAVOR JAPAN、Yahoo!ロコ（サービス終了・後継も LY規約で不可）、一休.comレストラン（robots.txt を含め全面 403、規約取得不能）。既判定の食べログ・ホットペッパーグルメも不可。

**実務上の含意**: 無条件に使えるのは **OpenStreetMap のみ**。次点が **まいぷれ**（明文の禁止条項がなく、Crawl-delay 遵守で技術的にも問題が少ない）。観光協会・商店街サイトは営利禁止条項こそ無いものの、いずれも「無断転載・複製の禁止」を掲げており、**個別に許諾を取る運用**（＝スケールしない）になる。大手グルメメディアは例外なく不可。
