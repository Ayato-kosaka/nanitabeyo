# BigQuery Safety Policy

## Cost Rule That Overrides Everything Else

**Do not put a time range on the `*_event_logs` views.** In those views `created_at` is a computed
column (it includes `TO_JSON_STRING(jsonPayload)`), so BigQuery cannot prune partitions and a single
day costs **18.4 GB**. Query the raw table `run_googleapis_com_stdout` and filter on `timestamp`
instead — the same day across all three log types costs about **77 MB**.

| Approach                                             | Per day     |
| ---------------------------------------------------- | ----------- |
| `frontend_event_logs` view, filtered on `created_at` | **18.4 GB** |
| `run_googleapis_com_stdout`, filtered on `timestamp` | **~77 MB**  |

```sql
FROM `food-scroll.nanitabeyo_logs_prod.run_googleapis_com_stdout`
WHERE timestamp >= TIMESTAMP '...' AND timestamp < TIMESTAMP '...'
  AND jsonPayload.log_type IN ('frontend_event_logs', 'backend_event_logs', 'external_api_logs')
```

`scripts/error-triage/sql/error-triage.sql` is the worked example. The views remain usable only for
small bounded lookups (a known `request_id` / `user_id`, or a `limit`ed peek) where no time range is
involved. Every time-ranged query in `query-patterns.md` and `event-catalog.md` must be rewritten
onto the raw table before it is run — going through the view breaks the 1 GB rule below on day one.

## Core Rules

- BigQuery is billable. Estimate query size with `--dry_run` before broad scans.
- Ask the user before running a query that dry-runs at 1 GB or more.
- Production logs are read-only for investigations.
- Do not run `insert`, `update`, `delete`, `merge`, `truncate`, DDL, exports, or
  any other mutating operation unless the user explicitly asks for it and the
  task is not a forensic log investigation.
- Avoid `select *`.
- Select only the columns needed for the question.
- Prefer narrow time windows and increase the window only when the evidence
  requires it.
- Avoid dumping raw `payload`, `request_payload`, or `response_payload` unless
  the investigation requires the full object.

## Queries That Need User Confirmation

Ask the user before executing:

- A dry run estimated at 1 GB or more.
- A query without a `created_at` or equivalent time bound on a large log view.
- Any `select *` against production log views.
- Any query returning large JSON payload fields for many rows.
- Any broad `regexp_contains(to_json_string(...))` scan.
- Any query over more than 7 days of production logs.
- Any query joining multiple production log views without a narrow key such as
  `request_id` or `user_id`.

## Preferred Pattern

Start with cheap shape-discovery queries:

- `count(1)`
- `group by event_name`
- `group by function_name, event_name`
- `group by api_name, endpoint, method`
- `min(created_at), max(created_at)`
- narrow `created_at between ... and ...`

Then fetch focused rows with:

- explicit columns
- a known `user_id`, `request_id`, issue number, or timestamp window
- `limit` while exploring

## Payload Handling

Prefer extracting specific keys:

```sql
json_value(payload, '$.issueNumber') as issue_number
```

Use raw JSON columns only when the key names are unknown or the full object is
necessary to explain the incident. Summarize sensitive or noisy fields instead
of pasting large payloads into the final answer.
