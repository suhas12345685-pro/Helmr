## 2025-05-25 - Missing index on jobs table for priority ordering
**Learning:** The jobs table in SQLite misses an index for `ORDER BY priority DESC, created_at ASC`, which is frequently used in `listJobs` and `claimNextJob`. While SQLite can use temporary B-trees, adding `idx_jobs_priority_created` directly avoids this sorting step, reducing CPU and improving claim/list latency.
**Action:** Add an index on `jobs(priority DESC, created_at ASC)` to SQLite memory store schema.

## 2025-05-27 - Sequential File Reading Bottleneck in SkillRegistry
**Learning:** In `SkillRegistry.list()`, reading skill files from disk one by one using a sequential `for...of` loop can block the event loop and introduce a measurable I/O bottleneck when parsing numerous files.
**Action:** Use `Promise.all` with `Array.map` to parallelize file reading and parsing operations whenever dealing with independent file I/O operations in loops, preserving the output order.
## 2025-06-03 - SkillRegistry `get` bottleneck
**Learning:** `SkillRegistry.get()` was using `list()` which read and parsed the entire skills directory instead of constructing the explicit path using `fileFor(id)` to read just the requested skill. In stateless scenarios checking individual skills often, this produces O(n) file lookups.
**Action:** When working with stateless file-backed persistence abstractions, ensure single-item fetch methods target files explicitly rather than relying on list-and-filter.
## 2026-06-03 - Optimize self-healing probe detect method
**Learning:** Sequential `await` calls on independent async operations (like database queries) create unnecessary latency. In `packages/scheduler/src/self-healing.ts`, the `detect` method was sequentially querying jobs for each `ACTIVE_STATUSES` and then for `failed` jobs.
**Action:** Replace sequential loops of async operations with `Promise.all` to fetch data concurrently when the operations are independent, and use a test bench to quantify the performance gain.
## 2026-08-06 - Parallelize entity lookups in Hatchery API server
**Learning:** In the Hatchery API (`packages/hatchery-api/src/server.ts`), independent parent-child lookups (like `getJob`, `getPlan`, `listReceiptsForJob`) were awaited sequentially inside `map` operations in high-traffic endpoints (e.g., `/api/jobs`, `/api/approvals`). Awaiting a plan lookup, followed by awaiting tool receipts in `toUiJob` creates unnecessary latency for each entity formatted.
**Action:** When mapping or formatting entities, utilize `Promise.all` to fetch dependent records or nested data concurrently (e.g., passing un-awaited promises directly to mapping functions like `toUiJob`). Ensure the initial parent lookup is verified (or handled) first if it determines a 404 response to avoid parallel 500 errors on missing paths.
