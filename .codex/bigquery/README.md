# BigQuery Investigation Notes

This directory contains reusable BigQuery instructions for Codex investigations.

Read these files before querying production logs:

- `access.md`: environment setup and execution method
- `safety-policy.md`: cost, privacy, and mutation rules
- `schemas.md`: canonical tables, views, and schema references
- `query-patterns.md`: approved investigation query patterns
- `event-catalog.md`: known frontend/backend/external events

Skills should keep only task-specific investigation flow and link to these files
instead of duplicating BigQuery setup details.
