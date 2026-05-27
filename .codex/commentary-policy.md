# Commentary Policy

Use comments to preserve intent, not to narrate code. The goal is to make future maintenance safer when a line or block would otherwise be hard to justify from its shape alone.

## When to comment

- The code crosses a responsibility boundary that is easy to miss.
- A selector, cache key, or dependency list is intentionally narrower than the surrounding data model.
- A state transition or fallback behavior is chosen for correctness rather than convenience.
- Multiple pieces of code are coordinated by one design decision and the coupling is not obvious.
- The implementation follows an existing pattern but the reason for that pattern is not self-evident.

## What a good comment does

- States the reason behind the code.
- Names the contract or invariant being preserved.
- Explains why a less obvious alternative was not used.
- Helps a future reader understand what must stay true if the code changes.

## What to avoid

- Comments that restate the code in prose.
- Comments that explain obvious syntax or control flow.
- Comments that fossilize temporary implementation details.
- Comments that only describe history or process without explaining the current rule.
- Long paragraphs that duplicate the surrounding code structure.

## Style

- Keep comments short and concrete.
- Prefer one sentence over a block when possible.
- Match the surrounding annotation style when the file already has one.
- Use the same wording for the same design decision across files.
- Write comments at the level of the abstraction being protected, not at the level of every line.

## Placement

- Put the comment immediately before the code it explains.
- If several lines implement one rule, comment the block once rather than repeating each line.
- If a helper exists to encode the rule, document the helper instead of every call site.
- If a pattern is repeated in multiple files, document the shared rule in the shared helper or common module.

## Review standard

- A comment should still make sense if the reader has not seen the diff that introduced it.
- A comment should remain true after a local refactor that preserves the same behavior.
- If a comment becomes false or too specific, update or remove it.
