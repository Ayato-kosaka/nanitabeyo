# BigQuery Access

## How to reach BigQuery

Two routes. **Check for the MCP tools first** — where a session has them, there is nothing to install
and nothing to authenticate:

- `mcp__Google_Cloud_BigQuery__execute_sql_readonly` — read-only queries (use this by default)
- `mcp__Google_Cloud_BigQuery__list_dataset_ids` / `list_table_ids` / `get_table_info` — shape discovery

Fall back to the `bq` CLI only when the MCP tools are absent. The CLI is **not** installed in every
environment, and the paths below are specific to the Codex sandbox — verify them before relying on
them rather than assuming they exist:

```bash
export PATH=/home/ubuntu/.local/google-cloud-sdk/bin:$PATH
export GOOGLE_APPLICATION_CREDENTIALS=~/.config/service-account-key/food-scroll-2bc35f43cfea.json
bq query --use_legacy_sql=false --format=prettyjson 'select 1'
```

## Datasets

- `food-scroll.nanitabeyo_logs_dev` — the default for verifying and reviewing the development API
- `food-scroll.nanitabeyo_logs_prod` — production. Read-only, and only for questions that are
  actually about production

**Which one to use follows the question, not a blanket rule.** Verifying a change you just made to
the development API → `_dev`. Investigating a real user-facing incident or an auto-filed
`error-triage` issue → `_prod`, because the data only exists there. Never switch to `_prod` merely
because a query returned no rows in `_dev`.

The queries in `query-patterns.md` and `event-catalog.md` are written against `_prod` because they
came from incident investigations. Swap the dataset to `_dev` when the question is about the
development API.

## Codex Execution

In the Codex managed sandbox, `bq` and sometimes even simple shell commands may
fail before execution with namespace errors such as:

- `bwrap: No permissions to create a new namespace`
- `bwrap: loopback: Failed RTM_NEWADDR: Operation not permitted`
- `gcloud not found but is required for authentication`

For BigQuery commands in Codex, run the command with escalated permissions from
the first attempt. Do not change the SQL to work around sandbox failures.

Use the same SQL with:

- `sandbox_permissions: "require_escalated"`
- a justification that says the command is read-only BigQuery access
- a reasonably scoped prefix rule such as `["bq", "query"]`

If `gcloud` is not found, ensure this path is exported and retry the same
command:

```bash
export PATH=/home/ubuntu/.local/google-cloud-sdk/bin:$PATH
```

## Query Format

Prefer:

```bash
bq query --use_legacy_sql=false --format=prettyjson '...'
```

Use `--dry_run` before any query that may scan a large amount of data:

```bash
bq query --use_legacy_sql=false --dry_run '...'
```

If dry run reports 1 GB or more processed bytes, ask the user before running the
actual query.
