# Event Catalog

> **Before running any of these queries:** the `*_event_logs` views cannot prune partitions,
> so a time-ranged query against them costs 18.4 GB/day instead of ~77 MB.
> Rewrite time-ranged queries onto `run_googleapis_com_stdout` filtered on `timestamp`.
> See [safety-policy.md](./safety-policy.md).

This file is a starting point for log investigations. It combines source-code
confirmed event names with queries that can refresh the production view of what
actually appears in BigQuery.

The BigQuery catalog queries should be run with `--dry_run` first. If estimated
bytes are 1 GB or more, ask the user before executing.

## Production Discovery Queries

Frontend:

```sql
select
  event_name,
  count(1) as count
from `food-scroll.nanitabeyo_logs_prod.frontend_event_logs`
group by event_name
order by count desc;
```

Frontend by screen/path:

```sql
select
  path_name,
  event_name,
  count(1) as count
from `food-scroll.nanitabeyo_logs_prod.frontend_event_logs`
group by path_name, event_name
order by count desc;
```

Backend:

```sql
select
  function_name,
  event_name,
  count(1) as count
from `food-scroll.nanitabeyo_logs_prod.backend_event_logs`
group by function_name, event_name
order by count desc;
```

External API:

```sql
select
  function_name,
  api_name,
  endpoint,
  method,
  count(1) as count
from `food-scroll.nanitabeyo_logs_prod.external_api_logs`
group by function_name, api_name, endpoint, method
order by count desc;
```

## Source-Confirmed Frontend Event Groups

Source checked with:

```bash
rg -o 'event_name:\s*"[^"]+"' app-expo --glob '!**/node_modules/**'
```

### Search Flow

- `screen_view`
- `location_cleared`
- `location_selected`
- `location_selection_failed`
- `current_location_requested`
- `current_location_success`
- `current_location_failed`
- `search_started`
- `search_tutorial_auto_opened`
- `search_tutorial_opened`
- `search_tutorial_completed`
- `search_tutorial_location_requested`
- `result_screen_invalid_entrieskey`
- `search_result_navigation`
- `search_result_exit`
- `search_result_return_to_cards`
- `search_result_closed`
- `search_result_bulk_share`
- `google_maps_fallback_dialog_shown`
- `google_maps_fallback_opened`
- `google_maps_fallback_open_failed`
- `google_maps_fallback_dismissed`

### Topic Flow

- `topic_view_details`
- `topic_swiped_next`
- `topic_deep_dive_selected`
- `topic_save_reaction_failed`
- `topic_impression`
- `topic_block_confirmed`
- `topic_block_success`
- `topic_block_failed`
- `topic_image_resource_load_error`
- `topic_image_manual_retry`
- `saved_topic_selected`
- `saved_topic_location_selected`
- `saved_topic_location_screen_back_pressed`

### Dish Media Flow

- `dish_media_entry_selected`
- `dish_media_swiped_next`
- `dish_media_impression_started`
- `dish_media_image_completed`
- `dish_media_video_completed`
- `dish_media_video_looped`
- `dish_media_view_send_cleanup_error`
- `dish_media_background_image_resource_load_error`
- `dish_like_reaction_failed`
- `dish_save_reaction_failed`
- `dish_share_attempted`
- `dish_share_success`
- `dish_share_failed`
- `dish_share_error`
- `dish_menu_opened`
- `dish_menu_option_selected`
- `restaurant_view_clicked`
- `creator_profile_clicked`
- `review_see_more_clicked`
- `review_like_reaction_failed`
- `map_pin_clicked`
- `map_pin_open_failed`
- `food_feed_mounted`
- `food_feed_swipe`

### Review And Restaurant Flow

- `review_post_button_clicked`
- `review_post_photo_video_button_press`
- `review_from_media_navigate`
- `review_from_media_screen_loaded`
- `review_from_media_screen_load_error`
- `review_screen_restaurant_loaded`
- `review_screen_load_error`
- `restaurant_detail_loaded`
- `restaurant_detail_load_error`
- `saved_restaurant_card_press`
- `saved_restaurant_review_button_press`
- `saved_restaurants_search_error`
- `restaurant_search_success`
- `restaurant_search_error`
- `restaurant_bid_submitted`
- `restaurant_bid_submission_failed`
- `restaurant_google_maps_clicked`
- `restaurant_google_maps_open_failed`
- `dish_category_selected`
- `video_duration_missing`
- `dish_review_submitted`
- `dish_review_submission_failed`
- `poi_press_error`
- `MapSearchError`
- `MapCurrentLocationError`

### Profile, Auth, And Settings

> **⚠️ #1062 以前の OAuth 系イベントの解釈について**
>
> #1062 の修正コミット以前、`oauth_callback_success` は「例外が投げられなかったこと」しか意味しておらず、
> **セッションを確立できていない失敗が混入している**（特に Android の development build を QR /
> `expo start` の `a` キーで起動したセッション。`Linking.getInitialURL()` が dev launcher の起動 URL を
> 返し続け、`code` が取り落とされていた）。同様に `oauth_signin_success` にはブラウザのキャンセルが
> 含まれている。過去分と比較する際はこの点に注意すること。
>
> 修正後は次の関係が成り立つ（発火条件を狭めただけで、旧系列は再構成できる）。
>
> ```
> 旧 oauth_signin_success                    ≡ 新 oauth_signin_success + oauth_signin_browser_dismissed
> 旧 oauth_callback_success + 旧 oauth_callback_error
>                                            ≡ 新 oauth_callback_success + oauth_callback_no_result + oauth_callback_error
> ```
>
> callback 側を「旧 success ≡ 新 success + no_result + error」と書くのは誤り。旧コードでも
> throw 経路（iOS / Web でのエラー応答・exchange 失敗）は旧 `oauth_callback_error` を出していた。
> 新 `oauth_callback_error` には「旧 success に化けていた分（Android QR 起動で握り潰されていたエラー）」と
> 「旧 error 相当分」が混在する。
>
> ログインが成立したかを判定するには `oauth_callback_success`（`payload.via` / `payload.source` /
> `payload.is_anonymous` を持つ）を使い、`onAuthStateChange:SIGNED_IN` の追随を確認すること。
>
> **⚠️ `oauth_signin_*` でログインの成否を判定しないこと。** Android の
> `WebBrowser.openAuthSessionAsync` は「AppState が active に戻ったこと」と「deep link の url イベント」を
> race させるため、**deep link でログインに成功した場合でも `dismiss` を返す**。実測でも、成功と同一試行で
> `oauth_signin_browser_dismissed` が記録され、その 1 秒後に `oauth_callback_success` と
> `userChanged`（`previous_user_id != new_user_id`）が出ている。したがって Android では
> `oauth_signin_success` はほぼ発火せず、`oauth_signin_browser_dismissed` は「キャンセル」を意味しない。
> これらはブラウザセッションの結末の記録であって、認証の成否ではない。

> **⚠️ #1135 認証初期化の「巻き戻し防止」イベント（`*Superseded` / `anonymousSignInDiscarded`）の解釈**
>
> 認証初期化（`AuthProvider.runAuthAttempt`）は、その最中に別経路（Web の OAuth code 交換など）が
> 新しいセッションを載せた場合、自分が読んだ古い結果を書き戻さずにスキップする。
> スキップしたことを記録するのが次の 3 イベントで、いずれも `error_level: "log"`（異常終了ではない）。
>
> | イベント | 発火位置 | 意味 |
> |---|---|---|
> | `sessionRestoreSuperseded` | `getSession()` がセッションを返した後 | 復元結果の書き戻しをスキップした |
> | `anonymousSignInSuperseded` | `getSession()` が「セッション無し」を返した後 | 匿名サインインの**呼び出し自体**をスキップした |
> | `anonymousSignInDiscarded` | 匿名サインイン**成功後**の書き戻し直前 | 匿名セッションを作ったが、その間に別セッションが載ったため書き戻しをスキップした |
>
> **⚠️ `sessionRestoreSuperseded` を「競合の検知シグナル」としてそのまま監視しないこと。**
> コールドスタート時にアクセストークンが失効していると、`getSession()` がロック内でリフレッシュを行い
> `TOKEN_REFRESHED` で世代が進むため、**正常起動でもこの分岐に入る**（アクセストークン寿命を超えて
> 久しぶりに起動したセッションは全てこれになる。E2E のセッション注入経路も同様）。
> 異常系（別ユーザーのセッションに追い越された）だけを見たい場合は
> **`payload.stale_user_id` と `payload.current_user_id` の一致で区別する**こと。
>
> - `stale_user_id == current_user_id` … 正常。同一ユーザーのトークン更新に追い越されただけ（state は `TOKEN_REFRESHED` ハンドラが正しく設定済み）
> - `stale_user_id != current_user_id` … 本来見たい競合。別経路が別ユーザーのセッションを確立した
>
> この性質上、`sessionRestored` の件数はこの修正以降減る（減った分が `sessionRestoreSuperseded` に移る）ため、
> 過去分と件数を比較する際は両者の合計で見ること。
> `anonymousSignInSuperseded` / `anonymousSignInDiscarded` は正常起動では発火しないので、そのまま競合の
> 検知に使える（`anonymousSignInDiscarded` は「匿名サインインの枠を 1 消費したが使わなかった」を意味する。
> Supabase の匿名サインインは 30 回/時/IP 制限があるため、多発する場合は経路を疑うこと）。

- `sessionRestored`
- `sessionRestoreSuperseded`
- `anonymousSignInSuperseded`
- `anonymousSignInDiscarded`
- `signInAnonymously`
- `authInitError`
- `userChanged`
- `oauth_callback_success`
- `oauth_callback_no_result`
- `oauth_link_conflict`
- `oauth_callback_error`
- `oauth_conflict_switch_existing`
- `oauth_conflict_switch_error`
- `oauth_conflict_cancel`
- `otp_sent`
- `otp_send_error`
- `otp_resent`
- `otp_resend_error`
- `otp_verify_error`
- `authentication_success`
- `oauth_signin_success`
- `oauth_signin_browser_dismissed`
- `oauth_signin_error`
- `profile_shared`
- `profile_edit_started`
- `profile_edit_screen_back_pressed`
- `profile_edit_load_retry_pressed`
- `profile_edit_saved`
- `profile_update_failed`
- `profile_avatar_upload_failed`
- `profile_tab_changed`
- `profile_liked_pressed`
- `profile_saved_topics_pressed`
- `profile_liked_screen_back_pressed`
- `profile_saved_topics_screen_back_pressed`
- `user_profile_created`
- `user_profile_creation_error`
- `load_own_profile_error`
- `login_screen_opened`
- `login_screen_back_pressed`
- `settings_screen_opened`
- `settings_blocked_topics_pressed`
- `settings_leave_review_pressed`
- `settings_leave_review_confirmed`
- `settings_leave_review_open_store_success`
- `settings_leave_review_open_store_failed`
- `settings_leave_review_open_store_skipped`
- `settings_leave_review_open_store_error`
- `settings_legal_document_pressed`
- `settings_logout_pressed`
- `logout_success`
- `logout_error`
- `settings_send_feedback_pressed`
- `feedback_submitted_success`
- `feedback_submitted_error`
- `fetch_blocked_categories_failed`
- `unblock_category_failed`
- `deposit_item_selected`
- `earning_item_selected`
- `likes_empty_search_navigation`
- `avatar_image_selection_failed`

### Dish Category Group Vote

- `dish_category_group_vote_create_started`
- `dish_category_group_vote_create_succeeded`
- `dish_category_group_vote_create_failed`
- `dish_category_group_vote_create_reused`
- `dish_category_group_vote_choice_selected`
- `dish_category_group_vote_submit_started`
- `dish_category_group_vote_submit_succeeded`
- `dish_category_group_vote_submit_failed`
- `dish_category_group_vote_submit_api_succeeded`
- `dish_category_group_vote_share_link_copied`
- `dish_category_group_vote_candidate_delete_requested`
- `dish_category_group_vote_candidate_deleted`
- `dish_category_group_vote_vote_opened`
- `dish_category_group_vote_store_opened`
- `dish_category_group_vote_candidate_dish_media_cached`
- `dish_category_group_vote_candidate_dish_media_open_requested`
- `dish_category_group_vote_candidate_dish_media_open_cached`
- `dish_category_group_vote_candidate_dish_media_open_empty`
- `dish_category_group_vote_candidate_dish_media_open_missing_search_context`
- `dish_category_group_vote_candidate_dish_media_search_failed`

### Contribution Tasks And Tools

- `dish_manual_image_supply_tutorial_shown`
- `dish_manual_image_supply_help_opened`
- `dish_manual_image_supply_item_opened`
- `dish_manual_image_supply_upload_started`
- `dish_manual_image_supply_upload_succeeded`
- `dish_manual_image_supply_upload_failed`
- `dish_manual_image_supply_submit_started`
- `dish_manual_image_supply_submit_result`
- `dish_manual_image_supply_thanks_continue_clicked`
- `dish_manual_image_supply_prompt_copied`
- `dish_manual_text_supply_data_loaded`
- `dish_manual_text_supply_data_load_error`
- `dish_manual_text_supply_tutorial_shown`
- `dish_manual_text_supply_screen_displayed`
- `dish_manual_text_supply_help_opened`
- `dish_manual_text_supply_ok_confirmed`
- `dish_manual_text_supply_skipped`
- `dish_manual_text_supply_edit_opened`
- `dish_manual_text_supply_edit_submit_started`
- `dish_manual_text_supply_edit_submit_success`
- `dish_manual_text_supply_edit_submit_error`
- `dish_manual_text_supply_edit_closed`
- `dish_manual_text_supply_image_load_error`
- `dish_ranking_summary_loaded`
- `dish_ranking_summary_load_error`
- `dish_ranking_summary_condition_changed`
- `dish_ranking_summary_comment_modal_opened`
- `dish_ranking_summary_help_opened`
- `dish_ranking_summary_submitted`
- `dish_ranking_summary_submit_error`
- `dish_copy_survey_data_loaded`
- `dish_copy_survey_data_load_error`
- `dish_copy_survey_submitted`
- `dish_copy_survey_submit_error`
- `tools_dish_category_image_review_submitted`
- `tools_categories_loaded`
- `tools_categories_error`
- `tools_images_updated`
- `tools_images_update_error`

### Platform, Location, Upload, And Performance

- `push_registration_skipped_not_physical_device`
- `push_permission_denied`
- `push_token_already_registered`
- `push_token_registration_error`
- `locale_initialized`
- `locale_validation_failed`
- `health_check_error`
- `audio_mode_error`
- `api_call_started`
- `api_call_success`
- `api_call_error`
- `location_search_failed`
- `location_details_success`
- `location_details_failed`
- `current_location_cache_hit`
- `current_location_deduplication`
- `current_location_permission_denied`
- `current_location_backend_failed_fallback`
- `current_location_expo_fallback_failed`
- `current_location_fetch_failed`
- `dish_category_search_success`
- `dish_category_search_failed`
- `dish_category_variant_create_start`
- `dish_category_variant_create_success`
- `dish_category_variant_create_failed`
- `file_upload_started`
- `file_upload_success`
- `file_upload_failed`
- `file_upload_progress`
- `performance_timer_start`
- `performance_timer_end`
- `performance_measure`
- `performance_measure_async`

## Source-Confirmed External API Logs

Source checked in `api/src/core/external-api/external-api.service.ts`.

| function_name | api_name | method | endpoint shape |
|---|---|---:|---|
| `callClaudeAPI` | `Claude API` | POST | `https://api.anthropic.com/v1/messages` |
| `searchWikidata` | `Wikidata API` | GET | `https://www.wikidata.org/w/api.php?...` |
| `getCorrectedSpelling` | `Google Custom Search API` | GET | `https://www.googleapis.com/customsearch/v1?...` |
| `callPlaceSearchText` | `Google Places Text Search API` | POST | `https://places.googleapis.com/v1/places:searchText` |
| `getPhotoMedia` | `Google Places Photos API` | GET | `https://places.googleapis.com/v1/{photoName}?...` |
| `callPlacesAutocomplete` | `Google Places Autocomplete API` | POST | skipped by default via `skipLogging: true` |
| `callPlaceDetails` | `Google Places Details API` | GET | `https://places.googleapis.com/v1/places/{placeId}` |
| `callReverseGeocoding` | `Google Geocoding API` | GET | `https://maps.googleapis.com/maps/api/geocode/json` |

## Source-Confirmed Backend Log Shape

Backend logs are emitted through `api/src/core/logger/logger.service.ts`.

- `log_type`: `backend_event_logs`
- `event_name`: passed by caller
- `function_name`: passed by caller
- `user_id`: from CLS
- `request_id`: from CLS
- `created_commit_id`: `env.API_COMMIT_ID`
- `payload`: converted for BigQuery JSON compatibility

Use production discovery queries to learn the actual backend `event_name` and
`function_name` combinations before assuming which service emitted a row.
