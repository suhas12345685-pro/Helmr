## 2026-07-16 - Prevent O(N) full table scans with indexes
**Learning:** In SQLite tables that are heavily queried in `Promise.all` loops, missing `CREATE INDEX` statements for `FOREIGN KEY` columns or commonly queried fields lead to O(N) full table scans.
**Action:** When working on performance, add `CREATE INDEX` statements paired with `FOREIGN KEY` definitions. This is specifically relevant to the `plans`, `results`, and `approvals` tables in `packages/memory/src/sqlite-store.ts`, as they are joined and queried per job ID heavily.
