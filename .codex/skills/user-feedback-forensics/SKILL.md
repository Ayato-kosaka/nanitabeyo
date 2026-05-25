# User Feedback Forensics Skill

## Purpose

GitHub Issueとして投稿されたユーザーフィードバックを起点に、BigQueryログとコードベースを照合し、ユーザーが本当に困っていた事象を特定する。

## Environment

- BigQuery dataset: `food-scroll.nanitabeyo_logs_prod`
- Service account key: `~/.config/service-account-key/food-scroll-2bc35f43cfea.json`
- Log schema reference:
  - `infra/big-query/migration/20251203T0000_backfill_legacy_log_tables_and_views.sql`

Before running BigQuery, set:

```bash
export GOOGLE_APPLICATION_CREDENTIALS=~/.config/service-account-key/food-scroll-2bc35f43cfea.json
export BQ_DATASET=food-scroll.nanitabeyo_logs_prod
````

## Investigation Flow

### 1. Read the GitHub Issue

Given an issue URL or number:

* Read title, body, labels, created_at, updated_at.
* Extract:

  * feedback message
  * submitted timestamp
  * app version / commit id
  * OS / device
  * likely user-facing flow

Do not assume the literal text is the root cause. Infer likely UX context.

### 2. Inspect BigQuery schema

Always inspect:

```bash
sed -n '1,220p' infra/big-query/migration/20251203T0000_backfill_legacy_log_tables_and_views.sql
```

Use these views unless proven otherwise:

* `food-scroll.nanitabeyo_logs_prod.frontend_event_logs`
* `food-scroll.nanitabeyo_logs_prod.backend_event_logs`
* `food-scroll.nanitabeyo_logs_prod.external_api_logs`

### 3. Identify the feedback creation request

Use issue number, title, and created_at window.

```sql
select
  created_at,
  request_id,
  user_id,
  function_name,
  event_name,
  json_value(payload, '$.issueNumber') as issue_number,
  json_value(payload, '$.feedbackType') as feedback_type,
  json_value(payload, '$.title') as title,
  payload
from `food-scroll.nanitabeyo_logs_prod.backend_event_logs`
where created_at between timestamp_sub(timestamp('{ISSUE_CREATED_AT}'), interval 10 minute)
                     and timestamp_add(timestamp('{ISSUE_CREATED_AT}'), interval 10 minute)
  and function_name = 'createIssue'
order by created_at;
```

Goal:

* identify `user_id`
* identify feedback `request_id`
* confirm the GitHub issue number

### 4. Trace user behavior before feedback

```sql
select
  created_at,
  user_id,
  event_name,
  path_name,
  created_app_version,
  created_commit_id,
  payload
from `food-scroll.nanitabeyo_logs_prod.frontend_event_logs`
where user_id = '{USER_ID}'
  and created_at between timestamp_sub(timestamp('{ISSUE_CREATED_AT}'), interval 60 minute)
                     and timestamp('{ISSUE_CREATED_AT}')
order by created_at;
```

Look for the screen flow, for example:

* search
* topic
* result
* dish-media
* restaurant
* feedback

### 5. Trace backend requests in that window

```sql
select
  created_at,
  request_id,
  user_id,
  function_name,
  event_name,
  payload
from `food-scroll.nanitabeyo_logs_prod.backend_event_logs`
where user_id = '{USER_ID}'
  and created_at between timestamp_sub(timestamp('{ISSUE_CREATED_AT}'), interval 60 minute)
                     and timestamp('{ISSUE_CREATED_AT}')
order by created_at;
```

Then narrow to relevant APIs:

```sql
select
  created_at,
  request_id,
  user_id,
  function_name,
  event_name,
  payload
from `food-scroll.nanitabeyo_logs_prod.backend_event_logs`
where user_id = '{USER_ID}'
  and created_at between timestamp_sub(timestamp('{ISSUE_CREATED_AT}'), interval 60 minute)
                     and timestamp('{ISSUE_CREATED_AT}')
  and (
    lower(function_name) like '%dish%'
    or lower(function_name) like '%media%'
    or lower(function_name) like '%bulk%'
    or lower(event_name) like '%dish%'
    or lower(event_name) like '%media%'
    or lower(event_name) like '%bulk%'
  )
order by created_at;
```

### 6. Inspect external API calls by request_id

```sql
select
  created_at,
  request_id,
  function_name,
  api_name,
  endpoint,
  method,
  status_code,
  response_time_ms,
  request_payload,
  response_payload,
  error_message
from `food-scroll.nanitabeyo_logs_prod.external_api_logs`
where request_id = '{REQUEST_ID}'
order by created_at;
```

Check:

* Google Places request languageCode
* response language fields
* imported review language
* fallback behavior

### 7. For language-related feedback

Check language distribution:

```sql
select original_language_code, count(1)
from `food-scroll.nanitabeyo_logs_prod.dish_reviews`
group by original_language_code
order by count(1) desc;
```

Check whether the user saw English review data:

```sql
select
  created_at,
  request_id,
  function_name,
  payload
from `food-scroll.nanitabeyo_logs_prod.backend_event_logs`
where user_id = '{USER_ID}'
  and created_at between timestamp_sub(timestamp('{ISSUE_CREATED_AT}'), interval 60 minute)
                     and timestamp('{ISSUE_CREATED_AT}')
  and regexp_contains(to_json_string(payload), r'"original_language_code"\s*:\s*"en"')
order by created_at;
```

### 8. Code investigation

After identifying the likely API/function_name:

* Search code by function name.
* Search DTO / response type.
* Trace repository → service → assembler/converter.
* Confirm whether returned data can include non-Japanese `dish_reviews`.
* Confirm whether translation/localization fallback exists.
* Do not propose a fix until log evidence and code evidence align.

### 9. Output format

Always report:

1. User feedback summary
2. True suspected user intent
3. Identified user_id / request_id
4. Relevant frontend flow
5. Relevant backend/API calls
6. Evidence from BigQuery
7. Evidence from code
8. Root cause hypothesis
9. Confidence level
10. Suggested next investigation or fix

Never mutate data. Investigation only unless explicitly asked.


### 10. Report writing guidance

When the user asks for a shareable investigation report, write it in Japanese by default unless explicitly requested otherwise.

Do not dump all logs. Summarize only the evidence needed to support the conclusion:

* Start with a short conclusion that states what the user likely experienced and the root cause hypothesis.
* Include identified IDs in compact tables:
  * issue number
  * issue created_at
  * user_id
  * feedback request_id
  * relevant frontend/backend request_id values
  * affected app version / commit_id / path_name
* Describe the user flow as a short chronological narrative, not a raw event dump.
* Include only representative response snippets that prove the observed issue.
  * For language issues, show a few rows like `category`, `topicTitle`, `reason` instead of full payloads.
* Include SQL only when it is important for reproducibility.
  * Keep SQL focused on the exact fact being proven.
  * After each SQL block, summarize the result in bullets instead of pasting full JSON output.
* Separate facts from inference:
  * `BigQuery で確認した事実`
  * `コード上の原因`
  * `根本原因の仮説`
  * `確信度`
* If code was only inspected and not changed, say so explicitly.
* End with a concise fix direction and minimum regression tests.

A good report shape:

1. `結論`
2. `特定したユーザーとリクエスト`
3. `ユーザーが実際に見たと推測される状況`
4. `BigQuery で確認した事実`
5. `コード上の原因`
6. `根本原因の仮説`
7. `確信度`
8. `修正方針案`

Prefer a concise, decision-ready report over an exhaustive forensic transcript.
