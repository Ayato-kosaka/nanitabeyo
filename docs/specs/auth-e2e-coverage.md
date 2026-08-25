# 認証フローの自動テストカバレッジ

このドキュメントは「**認証フローのどこが自動テストで守られていて、どこが守られていないか**」を 1 か所にまとめたものです。
#1124（ログアウトすると ①ホームへ戻らない ②API が全滅する ③画面が固まる）が、E2E が 1 本も無かったために
実機で触るまで誰も気付けなかったことを受け、#1131 で作成しました。

新しく認証まわりを触るときは、まずこの表で「今どこに穴があるか」を確認してください。
**穴が埋まった / 増えたときは、この表を更新するのが実装の一部です。**

---

## 1. 認証フローの全体像

このアプリの認証は Supabase Auth の 1 本道ですが、入口と出口が複数あります。

```
                       ┌──────────────────────────────┐
   起動 ───────────────►│ AuthProvider.runAuthAttempt  │
                       │  1. セッション復元            │
                       │  2. 無ければ匿名サインイン    │
                       └───────┬──────────────────────┘
                               │
        ┌──────────────────────┼───────────────────────┐
        │                      │                       │
   [匿名ユーザー]        [ログイン済み]           [確立できない]
        │                      │                       │
        │ ログインモーダル      │ 設定 → ログアウト      │ エラー UI + 再試行
        ▼                      ▼                       ▼
  signInWithOAuth /       supabase.auth.signOut    retryAuth()
  linkIdentity                 │                    AppState 復帰
        │                      │
        ▼                      ▼
  外部 IdP（Google/Apple）  SIGNED_OUT ハンドラ
        │                      │  ・匿名サインインをやり直す
        ▼                      │  ・ホーム（検索画面）へ遷移する
  /[locale]/auth/callback      ▼
        │                  ホーム（匿名ユーザーとして継続）
        ▼
   プロフィール作成 → /[locale]/profile
```

---

## 2. 経路 × 防御手段のマトリクス

「どの経路が、どの層で守られているか」の一覧です。個々のテストが何を保証しているかは §3、
守られていない理由は §4 を参照してください。

凡例: ✅ 守っている ／ ⚠️ 部分的（下の注を参照）／ ❌ 守っていない ／ — 対象外（その層で表現できない）

| #   | 経路                                                | ユニット | E2E (web) | E2E (mobile) | 実機（手動） |
| --- | --------------------------------------------------- | -------- | --------- | ------------ | ------------ |
| 1   | 起動：セッション復元（ログイン済みで起動する）      | ✅       | ✅        | ✅           | 任意         |
| 2   | 起動：匿名サインイン（セッションが無いとき）        | ✅       | ✅        | ✅           | 任意         |
| 3   | 起動：匿名サインイン失敗（429）のエラー UI と再試行 | ✅       | ✅        | ❌           | 任意         |
| 4   | 起動：AppState 復帰・リフレッシュ失効での再確立     | ⚠️ E     | ❌        | ❌           | 任意         |
| 5   | ログイン：CTA からログインモーダルが開く            | —        | ✅        | ✅           | 任意         |
| 6   | ログイン：外部 IdP（Google / Apple）の往復          | —        | ❌        | ❌           | **必須**     |
| 7   | ログイン：コールバック画面の分岐（成功 / 失敗）     | ⚠️ A     | ❌        | ❌           | **必須**     |
| 8   | ログイン：匿名からの昇格（linkIdentity）と衝突処理  | ⚠️ A     | ❌        | ❌           | **必須**     |
| 9   | ログイン：プロフィール自動作成                      | ❌       | ❌        | ❌           | **必須**     |
| 10  | ログイン：dev client（QR 起動）での起動 URL 解決    | ✅ B     | —         | ❌           | **必須**     |
| 11  | ログアウト：行の表示制御（匿名には出さない）        | —        | ✅        | ✅           | 任意         |
| 12  | ログアウト：実行 → ホーム（検索画面）へ遷移         | ✅       | ✅        | 🆕 C         | 任意         |
| 13  | ログアウト：匿名セッションの再確立と API 継続       | ✅       | ✅        | 🆕 C         | 任意         |
| 14  | ログアウト：画面が固まらない                        | ✅       | ⚠️ D      | 🆕 C         | 任意         |
| 15  | セッション維持：401 リトライ / トークンリフレッシュ | ⚠️ F     | ❌        | ❌           | 任意         |

- **A** … 部品（`pickOAuthResultUrl` / `handleOAuthResultUrl` が投げるエラー形状）はユニットで固定済みだが、
  **コールバック画面そのもの（`app/[locale]/auth/callback.tsx`）にはテストが 1 本も無い**。判断は §5。
- **B** … 「dev launcher の起動 URL を認証結果と誤認しない」ロジックは `lib/oauthResultUrl.test.ts` /
  `__tests__/index.test.tsx` で固定済み。ただし **QR 起動そのものの再現**は CI では行えない（§4-5）。
- **C** … #1131 で追加した `e2e-mobile/tests/authenticated/logout.test.ts`。
  **この run では実走していない**（エミュレータビルドに時間がかかるため）。合否の判定基準は §6-2。
- **D** … #1124 の「固まる」は web では _DOM が固まる_ 形では現れないため、web の E2E は等価な症状
  （①②）で検知する。**本当のフリーズとして検知できるのはネイティブ側だけ**（§6-1）。
- **E** … 「クールダウン中は匿名サインインを叩かない／ユーザー操作起点なら必ず叩く」という
  **判断ロジック**は `AuthProvider.test.tsx` が固定しているが、AppState 復帰イベントで実際に
  再確立が走る**配線**は検証していない。
- **F** … `useAPICall.test.tsx` が固定しているのは「access_token が無いときに `unauthenticated` で
  落ちる」ところまで。**401 → `refreshSession()` → 再送**の経路にはテストが無い
  （アクセストークンの寿命が 1 時間で、E2E の実時間では期限切れを再現できない）。

---

## 3. 守られている範囲（テストの一覧）

| #   | 経路                                        | 何を保証しているか                                                                                                    | テスト                                                                                                                                   |
| --- | ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | 起動時の匿名サインイン                      | 未ログインで起動すると匿名セッションが自動確立され、検索画面まで到達する                                              | `e2e-web/tests/smoke/boot.spec.ts` / `e2e-mobile/tests/smoke/boot.test.ts`（後者は唯一セッションを注入せずに起動する spec）              |
| 2   | 匿名サインインの失敗(429)                   | 空画面で黙るのではなくエラー UI と再試行ボタンが出る（Supabase 応答を `page.route` で差し替えるので実枠は消費しない） | `e2e-web/tests/auth/auth-failure.spec.ts`                                                                                                |
| 3   | 429 クールダウン / 多重実行防止             | クールダウン中の SIGNED_OUT では匿名サインインを叩かない。ユーザー操作起点の再試行は必ず叩く                          | `app-expo/contexts/AuthProvider.test.tsx`                                                                                                |
| 4   | SIGNED_OUT のデッドロック防止               | `onAuthStateChange` のコールバック内で `supabase.auth.*` を await しない。抜けた直後に 1 回だけ匿名サインインする     | `app-expo/contexts/AuthProvider.test.tsx`                                                                                                |
| 5   | セッション復元（ログイン済み）              | 注入したセッションでログイン済みとして起動し、お知らせタブ・食べたい/食べたタブの記録 CTA などログイン限定 UI が出る                    | `e2e-web/tests/authenticated/profile-authenticated.spec.ts` / `e2e-mobile/tests/authenticated/profile-authenticated.test.ts`             |
| 6   | 復元と OAuth の競合（#1135）                | 認証初期化の最中に別経路が載せたセッションを、古い読み取り結果で巻き戻さない                                          | `app-expo/contexts/AuthProvider.test.tsx`                                                                                                |
| 7   | ゲスト向けのログイン導線                    | 匿名ユーザーにログイン CTA が出て、**ログイン画面（/auth/login）へ遷移する**（#1359。戻る導線まで）                   | `e2e-web/tests/profile/login-screen.spec.ts` ほか / `e2e-mobile/tests/profile/login-screen.test.ts`・`tests/my-dishes/my-dishes-guest.test.ts`（#1396 でレビュータブから差し替え） |
| 8   | ログアウト行の表示制御                      | 匿名ユーザーにはマイページにログアウトが出ない / ログイン済みには出る                                                   | `e2e-web/tests/profile/settings.spec.ts` / `e2e-mobile/tests/profile/settings.test.ts`                                                   |
| 9   | **ログアウトの実行（web）**（#1131）        | ログアウトすると ①ホームへ遷移し ②匿名セッションが別ユーザーとして再確立され実 API が成功し ③UI 操作を受け付け続ける  | `e2e-web/tests/authenticated/logout.spec.ts`                                                                                             |
| 10  | **ログアウトの実行（ネイティブ）**（#1131） | 同上をネイティブで検証する。web では通らない `Platform.OS !== "android"` 分岐と「本当のフリーズ」を押さえる（未実走） | `e2e-mobile/tests/authenticated/logout.test.ts`                                                                                          |
| 11  | 認証結果 URL の選択ロジック                 | `?code=` / `#access_token` / エラー応答の判別。dev launcher の起動 URL を認証結果と誤認しない                         | `app-expo/lib/oauthResultUrl.test.ts`                                                                                                    |
| 12  | ログアウト後の行き先（起動時 URL の扱い）   | 起動時 URL をディープリンクとして採用するのは初回マウントだけ。ログアウト由来なら常にホームへ                         | `app-expo/__tests__/index.test.tsx`                                                                                                      |
| 13  | ゲスト判定・エラー分類                      | `isGuestUser` / 429 判定 / Retry-After のパース                                                                       | `app-expo/lib/authGuest.test.ts` / `lib/authRecovery.test.ts`                                                                            |
| 14  | トークン未確立時の API 呼び出し             | access_token が無いときは送信前に `unauthenticated` で落ち、呼び出し側が code で判別できる（401 再送の経路は未検証）  | `app-expo/hooks/useAPICall.test.tsx`                                                                                                     |
| 15  | プロフィール解決の決着                      | ログイン済み／ゲスト／取得失敗のいずれでも `isProfileResolved` が決着し、ローディングで固着しない                     | `app-expo/features/profile/hooks/useEnsureOwnProfileLoaded.test.tsx`                                                                     |

---

## 4. 守られていない範囲と、その理由

「テストを書き忘れている」のではなく **構造的に自動化できない**ものが大半です。理由ごとにまとめます。

### 4-1. 外部 IdP（Google / Apple）の画面操作 — 自動化しない（方針として確定）

対象: マトリクス #6、および #7〜#9 のうち「実際に `code` を持って戻ってくる」部分。

- 外部 IdP のログイン画面は **bot 検知に掛かる**（自動操作は各社の利用規約上もアンチパターン）。
- そのため e2e-web / e2e-mobile はどちらも **OAuth をバイパスして「ログイン済み状態」から始める**設計を採っている
  （`e2e-web/tests/setup/auth.setup.ts` の storageState、`app-expo/lib/e2e/injectTestSession.ts` の launchArgs 注入）。
- **代替の担保**: 前後の経路を個別に固める（#5 のモーダル表示、#11 の URL 選択ロジック）＋ §7 の本番監視。

### 4-2. 匿名サインインの実行回数 — 30 回/時/IP・dev/prod で同一プロジェクト

Supabase の匿名サインインは **30 回/時/IP でカスタマイズ不可**、かつ dev と prod で同じプロジェクトを共有しています。
そのため E2E は「run に 1 回だけ匿名セッションを確立して全 spec で共有する」設計になっており、
**「アプリ自身に匿名サインインさせる」spec を増やせません**。

現在この枠を消費してよいのは次の 3 つだけです。

| 消費する spec                                   | 回数         | 理由                                       |
| ----------------------------------------------- | ------------ | ------------------------------------------ |
| `e2e-*/tests/smoke/boot.*`                      | run あたり 1 | 匿名サインインの自動確立そのものが検証対象 |
| `e2e-web/tests/authenticated/logout.spec.ts`    | run あたり 1 | ログアウト後の**再確立**が検証対象         |
| `e2e-mobile/tests/authenticated/logout.test.ts` | run あたり 1 | 同上（プラットフォームごとに 1）           |

このため **ログアウトの spec は 1 本・1 テストに留めること**（3 症状を 1 テスト内で検証している理由）。

### 4-3. テストユーザーは共有 — セッションを壊す操作は「使い捨てセッション」で行う

`logout({ scope: "local" })` は端末のストレージを消すだけでなく `POST /auth/v1/logout?scope=local` で
**サーバ側のセッションも失効させます**。テストユーザーは e2e-web / e2e-mobile で共用のため、共有セッションで
ログアウトすると後続の authenticated テストが軒並み落ちます（web で実測済み: 403 でゲスト扱いになった）。

- web … テスト内で `signInTestUser()` を 1 回実行して専用セッションを作る（`e2e-web/utils/testUserSession.ts`）
- mobile … `createDisposableAuthenticatedSession()` で専用セッションを発行して launchArgs で渡す
  （`e2e-mobile/utils/disposableSession.ts`）

### 4-4. コールバック画面の分岐 — 「成功」を作れない（→ §5 の判断へ）

`?code=` を付けて `/[locale]/auth/callback` を直接開いても、**成功分岐には到達できません**。
PKCE の `exchangeCodeForSession()` は `signInWithOAuth()` が保存した `code_verifier` を必要とし、
IdP が発行した本物の `code` も要るためです。到達できるのは失敗分岐（`no_result` / `oauth_callback_error`）だけです。

### 4-5. dev client（QR 起動）固有の経路 — CI で再現できない

#1062 の実害は「Android の development build を QR / `expo start` の `a` キーで起動すると
`Linking.getInitialURL()` が dev launcher の URL を返し続ける」ことでした。
Detox の `launchApp` と実機のコールドスタートで `getInitialURL()` が一致する保証が無く、
**確認できていない前提の上に別の前提を重ねる**ことになるため、CI 再現は対象外です（#1131 本文の「対象外」）。
ロジック側（その URL を認証結果として採用しない）はユニットで固定済み（マトリクス #10 の B 注）。

### 4-6. `pull_request` で走る E2E が無い

`.github/workflows/` の E2E は `workflow_dispatch` / nightly cron のみで、`pull_request` で回るのは
`pr-check.yml`（app-expo の typecheck + jest）だけです。つまり **ここに挙げた E2E は PR ゲートではありません**。
トリガ新設の判断は #1112 に係属中で、本ドキュメントの対象外です。

---

## 5. 提案 B（コールバック画面の統合テスト）の判断

**結論: Issue #1131 の提案 B（Web で `/[locale]/auth/callback` へ直接遷移する E2E）は「やらない」。**
理由は「オーナーがそう決めたから」ではなく、次の 3 点です（コードを読んで確認した事実に基づきます）。

### 5-1. 検証したい「成功分岐」に到達できない

提案 B の狙いは `oauth_callback_success` / `oauth_callback_no_result` の**出し分け**の確認でした。
しかし §4-4 のとおり、成功分岐には本物の `code` と `code_verifier` の両方が要ります。
E2E で作れるのは次の 3 つで、いずれも **失敗側**です。

| 直接開く URL                | 実際に通る分岐                                                 |
| --------------------------- | -------------------------------------------------------------- |
| パラメータ無し              | `pickOAuthResultUrl` が null → `oauth_callback_no_result`      |
| `?code=<偽物>`              | `exchangeCodeForSession` が 4xx → `oauth_callback_error`       |
| `?error=...&error_code=...` | `handleOAuthResultUrl` が throw → 衝突ダイアログ or error 記録 |

つまり **#1062 で壊れていた側（成功したのに成功と記録されない）を作れない**。守れるのは既にユニットで
固定済みの失敗分岐だけになります。

### 5-2. 分岐の結果が UI に出ない（判定は「ログの中身」でしかできない）

`callback.tsx` はどの分岐でも同じスピナーを出し、最後は必ず `/[locale]/profile` へ遷移します。
成功と失敗を分けているのは **`logFrontendEvent` の中身だけ**です。E2E でこれを判定するには、

- ログはバッチ送信で、既定 5 秒間隔 or 20 件たまるまで飛ばない（`app-expo/lib/logQueue.ts`）
- 送るかどうかは Remote Config の `v1_min_frontend_log_level` に依存する（閾値次第で**そもそも送られない**）

という 2 つの都合を E2E 側で吸収する必要があり、テストが「実装のミラー」になります。
**ユーザーに見える振る舞いを検証する E2E の役割から外れている**ため、この形では入れません。

### 5-3. 保守コストの見積もりが Issue の想定より高い

Issue 本文も「実 Supabase のエラー応答形状に依存するため保守コストの見積もりが必要」と書いています。
実際に見積もると、5-1 のケース 2・3 は **Supabase のエラー応答（`error_code` の語彙）に依存**します。
これは我々が制御できない外部仕様で、変わったときに壊れるのはテストだけ（プロダクトは無傷）です。

### 5-4. 代わりにやるべきこと（未実施・別 Issue 化を推奨）

**`callback.tsx` に 1 本もテストが無い**という事実自体は残ります（マトリクス #7・#8 の ⚠️）。
埋めるなら E2E ではなく **jest + React Testing Library の統合テスト**が適切です。

- `useAuth().handleOAuthResultUrl` をモックして、`authenticated` / `no_result` / throw（`identity_already_exists`）を返させる
- 検証対象は「どのイベント名で記録したか」「衝突ダイアログを開いたか」「どこへ遷移したか」
- 実 Supabase も外部 IdP も不要。`app-expo/__tests__/index.test.tsx` と同じ手口で書ける

これは提案 B とは別物（E2E ではない）なので、**#1131 のスコープでは実施していません**。
着手するときは、この節を「実施済み」に書き換えてください。

---

## 6. #1131 で追加したログアウト E2E の実効性

「テストがあること」と「テストが壊れたときに赤くなること」は別なので、実測結果を分けて記録します。

### 6-1. web 版（実測済み）

#1124 の修正を**一時的に戻したビルド**を作って実測しました。

| 戻した修正                                                                  | 症状                                                | このテストは検知したか                                                                     |
| --------------------------------------------------------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `68d44720`（SIGNED_OUT コールバック内で `supabase.auth.*` を await しない） | ①ホームへ戻らない                                   | ✅ **赤くなる**（マイページに留まり、検索画面が出ない）                                      |
| 同上                                                                        | ②匿名セッションが再確立されず API が全滅する        | ✅ **赤くなる**（localStorage に匿名セッションが現れず、場所オートコンプリートも空のまま） |
| 同上                                                                        | ③画面が固まる                                       | ❌ **緑のまま**（→ 下記）                                                                  |
| `f8c6a437`（ログアウト後の行き先を `app/index.tsx` へ明示的に引き継ぐ）     | ①ホームへ戻らない（プロフィールタブへ戻ってしまう） | ✅ **赤くなる**                                                                            |

**③を web で直接検知できない理由**: web ビルドでの #1124 は React の描画スレッドが止まる種類のフリーズではなく、
`GoTrueClient` のロックが解放されないまま `supabase.auth.*` が永久に解決しなくなるものです。
DOM 操作（タブ切り替え・トグル・入力）は壊れたビルドでも普通に効きます（実測で緑のまま）。
ユーザーから見た「固まった」は _ログアウト後に再ログインしようとしても何も起きない_ という形で現れますが、
その検証は Google のログイン画面へ実際にリダイレクトすることになり、§4-1 の方針と衝突します。
症状 ①② が同じ根本原因から出ているため、結果的にこの 1 本で #1124 のデッドロックは検知できます。

### 6-2. ネイティブ版（**この run では未実走**）

`e2e-mobile/tests/authenticated/logout.test.ts` は追加済みですが、**エミュレータビルドの所要時間の都合で
実走していません**。型検査（`pnpm --filter e2e-mobile typecheck`）のみ通しています。
次に実走する人は、以下が観測できればクリアです。

1. マイページでログアウト行が見えている（＝ 使い捨てセッションの注入が効いている）
2. 確定後、**検索画面（`search-header-title`）が表示される**／マイページの要素が消える
3. レビュータブが**ゲスト表示**になる（`review-guest-login-button` が出る。
   ここが `review-post-button` なら **注入が再発動している** ＝ `injection: "once"` の回帰）
4. 場所オートコンプリートに**サジェストが出る**（＝ 匿名セッションが再確立され、実 API に通っている）
5. 詳細条件トグル → 距離スライダーが描画される（＝ 純クライアント操作も生きている）
6. **後続の `tests/authenticated/` が落ちていない**（＝ 共有セッションを壊していない）

失敗したときの切り分けの起点:

| 症状                                             | 疑うところ                                                                       |
| ------------------------------------------------ | -------------------------------------------------------------------------------- |
| ログアウト後もログイン済みのまま（3 が投稿 CTA） | `e2eSessionInjection` が届いていない（E2E ビルドのフック / launchArgs の型変換） |
| 4 だけ落ちる                                     | 匿名サインインが 429（枠切れ）。他の E2E workflow と同時実行していないか         |
| 6 が落ちる                                       | 使い捨てセッションではなく共有セッションで走った（`session` の受け渡し）         |

### 6-3. ネイティブ側で解いた 2 つの障害（設計メモ）

Detox でログアウトを書くには、e2e-web には無い障害が 2 つありました。#1131 で次のように解いています。

**(1) ログアウトするとテスト用セッションが再注入される**
`AuthProvider` の SIGNED_OUT ハンドラは `runAuthAttempt()` を呼び直し、その先頭で `injectTestSession()` が走ります。
`injectTestSession` は「セッションの有無」ではなく「launchArgs の期待ユーザーと一致するか」で注入を判断するため、
そのままでは「ログアウトしたのにログイン済みへ戻る」テストになります。
→ launchArgs に **`e2eSessionInjection: "once"`** を追加し、**プロセス内で 1 回成立したら以降は素通り**させました
（既定は従来どおり `"always"`。E2E ビルド専用ファイルへの変更で、本番バンドルには 1 行も入りません）。
2 回目以降は本番と同じ `signInAnonymously()` の経路へ合流するので、**匿名サインインは実際に 1 回発生します**
（§4-2 のとおり、それ自体が検証対象なので潰してはいけません）。

**(2) 共有セッションを失効させてしまう**
→ §4-3 のとおり、spec 専用の使い捨てセッションを発行して注入します。

**(3) 確認ダイアログの OK が押せない**
`DialogProvider` の確認ボタンには testID が無く、Detox は `by.text("ログアウト")` が
「マイページのログアウト行」と「ダイアログのボタン」の 2 件に一致して操作できませんでした。
→ `DialogProvider` の OK / キャンセルへ既定 testID（`dialog-confirm-button` / `dialog-cancel-button`）を追加しました。

---

## 7. 自動テストで守れない範囲を BigQuery で監視する（#1131 の D）

§4-1・§4-5 のように**原理的に自動化できない**範囲は、本番の `frontend_event_logs` で継続監視します。
イベントの意味と落とし穴は `.codex/bigquery/event-catalog.md`（Profile, Auth, And Settings）に集約されています。
**クエリを書く前に必ずそちらを読んでください。** ここでは「何をどう見るか」だけを書きます。

### 7-1. 判定に使うイベント（間違えやすい点つき）

| 見たいこと                    | 使うイベント                                                  | ⚠️ 注意                                                                                                                                                                                                  |
| ----------------------------- | ------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ログインが成立したか          | `oauth_callback_success`（`payload.via` / `source`）          | **`oauth_signin_*` で判定しないこと。** Android は成功時でも `oauth_signin_browser_dismissed` を出す                                                                                                     |
| ログインの無言の失敗（#1062） | `oauth_callback_no_result`                                    | 候補が 1 つも認証結果を持たなかった場合は `payload.candidates`（**どの URL 候補が何を持っていたか**）、交換まで進んで失敗した場合は `payload.source` / `url_shape` が入る。QR 起動の切り分けは前者を見る |
| コールバックの例外            | `oauth_callback_error`                                        | #1062 以前の値と混ぜないこと（カタログの互換表を参照）                                                                                                                                                   |
| 匿名昇格の衝突                | `oauth_link_conflict` / `oauth_conflict_switch_*`             | ユーザー操作を伴うので件数は少ない。0 件が正常とは限らない                                                                                                                                               |
| ログアウトの成否              | `settings_logout_pressed` → `logout_success` / `logout_error` | **押下と成功の差分**が #1124 の症状（固まって完了しない）。件数比で見る                                                                                                                                  |
| ログアウト後の再確立          | `signInAnonymously` / `authInitError`                         | 匿名サインインは 30 回/時/IP。多発は経路の疑い                                                                                                                                                           |
| 認証初期化の競合（#1135）     | `sessionRestoreSuperseded` ほか                               | `sessionRestoreSuperseded` は**正常起動でも出る**。`stale_user_id != current_user_id` だけが異常                                                                                                         |

### 7-2. 最低限見るクエリ

`.codex/bigquery/query-patterns.md` の書式に合わせています（実行前に `--dry_run`、および `safety-policy.md` を確認）。

ログイン（コールバック）の成否比 — §4-1 で自動化を諦めた範囲の代替監視:

```sql
select
  date(created_at) as day,
  event_name,
  count(1) as count
from `food-scroll.nanitabeyo_logs_prod.frontend_event_logs`
where event_name in ('oauth_callback_success', 'oauth_callback_no_result', 'oauth_callback_error')
  and created_at >= timestamp_sub(current_timestamp(), interval 14 day)
group by day, event_name
order by day desc, count desc;
```

ログアウトの取りこぼし — §6-1 ③（web の E2E では検知できない「完了しない」症状）の代替監視:

```sql
select
  date(created_at) as day,
  countif(event_name = 'settings_logout_pressed') as pressed,
  countif(event_name = 'logout_success') as succeeded,
  countif(event_name = 'logout_error') as failed
from `food-scroll.nanitabeyo_logs_prod.frontend_event_logs`
where event_name in ('settings_logout_pressed', 'logout_success', 'logout_error')
  and created_at >= timestamp_sub(current_timestamp(), interval 14 day)
group by day
order by day desc;
```

`pressed > succeeded + failed` が続く日は、**押したのに完了へ到達していない**ことを意味します
（確認ダイアログのキャンセル分が含まれる点に注意。急に比率が動いたかを見る）。

### 7-3. 監視で代替できないもの

BigQuery は「壊れたことに**後から**気付く」手段であって、リリース前に止める手段ではありません。
§4 に挙げた範囲は、リリース前は引き続き**実機での手動確認**が必要です。
手動確認を依頼するときは、必ず「何が観測できたらクリアか」を判定可能な形で書いてください（§6-2 の書き方に倣う）。

---

## 8. このドキュメントの更新規約

- 認証まわりのテストを**足した / 消した**ときは、§2 のマトリクスと §3 の一覧を同じ PR で更新する
- 「自動化できない」と判断したものは、**理由と代替の担保（監視 or 手動確認）まで**書く。判断だけ残さない
- 実測していない項目に ✅ を付けない。未実走・未検証は §6-2 のように**そう書く**
