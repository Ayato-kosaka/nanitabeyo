# BigQuery Query Patterns

> **Before running any of these queries:** the `*_event_logs` views cannot prune partitions,
> so a time-ranged query against them costs 18.4 GB/day instead of ~77 MB.
> Rewrite time-ranged queries onto `run_googleapis_com_stdout` filtered on `timestamp`.
> See [safety-policy.md](./safety-policy.md).

Before running these against production, read:

- `.codex/bigquery/access.md`
- `.codex/bigquery/safety-policy.md`
- `.codex/bigquery/schemas.md`

Run `--dry_run` first for broad catalog queries. Ask the user before executing
if the estimate is 1 GB or more.

## Event Discovery

Frontend event names:

```sql
select
  event_name,
  count(1) as count
from `food-scroll.nanitabeyo_logs_prod.frontend_event_logs`
group by event_name
order by count desc;
```

Frontend event names by path:

```sql
select
  path_name,
  event_name,
  count(1) as count
from `food-scroll.nanitabeyo_logs_prod.frontend_event_logs`
group by path_name, event_name
order by count desc;
```

Backend function and event names:

```sql
select
  function_name,
  event_name,
  count(1) as count
from `food-scroll.nanitabeyo_logs_prod.backend_event_logs`
group by function_name, event_name
order by count desc;
```

External API names:

```sql
select
  api_name,
  endpoint,
  method,
  count(1) as count
from `food-scroll.nanitabeyo_logs_prod.external_api_logs`
group by api_name, endpoint, method
order by count desc;
```

Log coverage:

```sql
select
  'frontend_event_logs' as table_name,
  count(1) as row_count,
  min(created_at) as min_created_at,
  max(created_at) as max_created_at
from `food-scroll.nanitabeyo_logs_prod.frontend_event_logs`
union all
select
  'backend_event_logs',
  count(1),
  min(created_at),
  max(created_at)
from `food-scroll.nanitabeyo_logs_prod.backend_event_logs`
union all
select
  'external_api_logs',
  count(1),
  min(created_at),
  max(created_at)
from `food-scroll.nanitabeyo_logs_prod.external_api_logs`;
```

## Feedback Request Identification

Use issue number, title, and issue creation timestamp.

```sql
select
  created_at,
  request_id,
  user_id,
  function_name,
  event_name,
  json_value(payload, '$.issueNumber') as issue_number,
  json_value(payload, '$.feedbackType') as feedback_type,
  json_value(payload, '$.title') as title
from `food-scroll.nanitabeyo_logs_prod.backend_event_logs`
where created_at between timestamp_sub(timestamp('{ISSUE_CREATED_AT}'), interval 10 minute)
                     and timestamp_add(timestamp('{ISSUE_CREATED_AT}'), interval 10 minute)
  and function_name = 'createIssue'
order by created_at;
```

If key names are unknown, add `payload` only after the focused query above does
not answer the question.

## User Timeline

Frontend timeline:

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
  and created_at between timestamp_sub(timestamp('{TARGET_AT}'), interval 60 minute)
                     and timestamp_add(timestamp('{TARGET_AT}'), interval 10 minute)
order by created_at;
```

Backend timeline:

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
  and created_at between timestamp_sub(timestamp('{TARGET_AT}'), interval 60 minute)
                     and timestamp_add(timestamp('{TARGET_AT}'), interval 10 minute)
order by created_at;
```

Relevant backend API subset:

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
  and created_at between timestamp_sub(timestamp('{TARGET_AT}'), interval 60 minute)
                     and timestamp_add(timestamp('{TARGET_AT}'), interval 10 minute)
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

## External API Trace

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

## Language-Related Feedback

Language distribution:

```sql
select
  original_language_code,
  count(1) as count
from `food-scroll.nanitabeyo_logs_prod.dish_reviews`
group by original_language_code
order by count desc;
```

Backend payloads containing English review language:

```sql
select
  created_at,
  request_id,
  function_name,
  event_name
from `food-scroll.nanitabeyo_logs_prod.backend_event_logs`
where user_id = '{USER_ID}'
  and created_at between timestamp_sub(timestamp('{TARGET_AT}'), interval 60 minute)
                     and timestamp_add(timestamp('{TARGET_AT}'), interval 10 minute)
  and regexp_contains(to_json_string(payload), r'"original_language_code"\s*:\s*"en"')
order by created_at;
```
