# Event Catalog

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

- `sessionRestored`
- `signInAnonymously`
- `authInitError`
- `userChanged`
- `oauth_callback_success`
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
- `oauth_signin_error`
- `profile_shared`
- `profile_edit_started`
- `profile_edit_saved`
- `profile_update_failed`
- `profile_avatar_upload_failed`
- `profile_tab_changed`
- `user_profile_created`
- `user_profile_creation_error`
- `load_own_profile_error`
- `login_modal_opened`
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
