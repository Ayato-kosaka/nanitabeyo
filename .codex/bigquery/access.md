# BigQuery Access

## Environment

```bash
export PATH=/home/ubuntu/.local/google-cloud-sdk/bin:$PATH
export GOOGLE_APPLICATION_CREDENTIALS=~/.config/service-account-key/food-scroll-2bc35f43cfea.json
export BQ_DATASET=food-scroll.nanitabeyo_logs_prod
```

Dataset:

- `food-scroll.nanitabeyo_logs_prod`

Primary command shape:

```bash
bq query --use_legacy_sql=false --format=prettyjson 'select 1'
```

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
