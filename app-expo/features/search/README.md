# 検索機能の設計概要

## ルーティング構成

- `/app/[locale]/(tabs)/search/_layout.tsx` で検索タブ配下のスタックを定義し、`index`（検索条件入力）、`dish-categories`（候補カード）、`result`（結果詳細）の 3 画面を管理する（`topics` は #1553 で残した旧ルートで、`dish-categories` へリダイレクトするだけ）。
- `result` 画面は `transparentModal` として表示され、タブ上にモーダル的に重ねる挙動をとる。

## 検索条件入力画面（index.tsx）

- `useLocale`・`useHaptics`・`useLogger` などのユーティリティと、位置情報取得用の `useLocationSearch`、トースト表示用の `useSnackbar` を組み合わせて UI 操作とログ採取を行う。初回マウント時に以下の初期化を実施する。
  - `useLocationSearch.getCurrentLocation()` で現在地を取得し、成功時はフォームを現在地で初期化する。
  - 現在時刻から時間帯（`timeSlot`）を自動選択する。
  - 画面表示イベントを `logFrontendEvent` で送信する。
- 状態管理
  - 位置情報（`location`）と入力中の検索クエリ文字列（`locationQuery`）を保持。
  - `timeSlot`・`scene`・`mood`・`restrictions`・`distance`・`priceLevels`・詳細フィルター表示有無（`showAdvancedFilters`）などをステートで管理。距離は 500m、価格帯は全選択をデフォルトとする。
  - ロケーション選択/クリア/現在地再取得、各フィルター変更時にハプティクスを鳴らしログを記録する。
- UI 構成
  - 位置入力には `LocationAutocomplete` を用い、現在地ボタンで `handleUseCurrentLocation` を呼び出す。
  - 時間帯・シーン・ムードは `constants.ts` のオプションをマッピングしてチップ UI として表示。
  - 「詳細フィルター」の開閉トグルで距離スライダー、価格帯マルチセレクト、食事制限チップ群を表示。
    - 距離は `DistanceSlider` コンポーネントでプリセット値をスライド選択。
    - 価格帯は `PriceLevelsMultiSelect` コンポーネントで複数選択対応。
  - フッターに検索ボタンを配置し、位置未選択時は無効化する。
- 検索実行
  - 必須の位置情報が欠けている場合はスナックバーを表示して終了。
  - 条件を `SearchParams` として組み立て、`dish-categories` 画面に JSON 文字列化したパラメーターを渡して遷移する。

## 料理カテゴリ選択画面（dish-categories.tsx）

- 画面遷移時に受け取った `searchParams` を JSON パースし、`useDishCategorySearch` の `searchDishCategories` で候補取得をトリガーする。パース失敗や検索失敗時はスナックバー表示の後、前画面へ戻す。
- 取得結果（`dishCategories`）から `isHidden` が立っていない項目のみをカルーセル表示する。
  - 表示には `react-native-reanimated-carousel` を使用し、ページ送りごとに `useHaptics.selectionChanged` を発火。
  - `DishCategoryCard` からのブロック（非表示）アクションは `useBlockDishCategory` が確認ダイアログを出して実行し、成功時はスナックバーで通知する。
- カード選択（「この料理にする！」）押下時の処理
  - 選択した料理カテゴリの `dishItemsPromise` を `useDishMediaEntriesStore.setDishePromises` に登録し、`result` 画面に遷移する。併せてロケーション情報を必要に応じて JSON 文字列で引き継ぐ。
- 画面表示・戻る・エラーなど主要イベントを `useLogger` で計測する。

## 結果表示画面（result.tsx）

- クエリから受け取った `dishCategoryId` と、必要なら位置情報を JSON パースして `initialLocation` として解釈する。
- `useSearchResult(dishCategoryId)` で以下の振る舞いを一元管理する。
  - カード位置（`currentIndex`）と完了モーダル表示フラグ（`showCompletionModal`）。
  - `useDishMediaEntriesStore` に保存済みの `dishPromisesMap[dishCategoryId]` を取り出し、`DishMediaMap` に `itemsPromise` として渡す。
  - インデックス変更・画面クローズ・カード一覧へ戻る操作のログ送信。
- 画面表示時に `screen_view` を記録し、戻るボタン (`X`) タップで軽いハプティクス後に前画面へ戻る。
- メインコンテンツはマップベースの `DishMediaMap` を使用し、`handleIndexChange` で選択状態を同期する設計。

## 検索機能の共通モジュール

- `constants.ts`
  - 時間帯・シーン・ムード・距離プリセット・価格帯・食事制限の静的データを保持。距離ラベルは `i18n.t` で多言語対応している。
- `components/DistanceSlider.tsx`
  - 距離プリセットを横スライダーで選択するコンポーネント。`PanResponder` でタッチ移動を監視し、スナップごとに `selectionChanged` ハプティクスを鳴らす。
- `components/PriceLevelsMultiSelect.tsx`
  - 価格帯アイコン（💰〜💰💰💰💰）をトグル式に選択するコンポーネント。親コンポーネントから受け取ったスタイルをそのまま適用できるよう `customStyles` を受け取る。
- `hooks/useSearchResult.ts`
  - 結果画面で使用する状態とナビゲーションロジックをカプセル化し、各イベントで `logFrontendEvent` を呼び出して分析用データを蓄積する。完了モーダル表示ロジックのための `showCompletionModal` ステートも保持している（現状 UI では未使用）。

## ログとハプティクスの一貫性

- 3 画面すべてで `useLogger` によるイベント送信を行い、ユーザー操作・画面表示・エラーをトラッキングする。
- 主要操作（ボタンタップ、スライダー移動、画面クローズなど）で `useHaptics` を呼び出し、触覚フィードバックを統一している。

## データ連携の流れ

1. `index` で検索条件を構築し、`dish-categories` へ JSON で引き渡す。
2. `dish-categories` が候補を検索し、ユーザー選択後に該当料理カテゴリの料理データ取得 Promise を `useDishMediaEntriesStore` に保存して `result` に遷移する。
3. `result` ではストアに保存された Promise を使って `DishMediaMap` を描画し、インタラクションの状態遷移を `useSearchResult` が管理する。
