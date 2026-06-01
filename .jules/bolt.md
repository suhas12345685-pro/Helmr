## 2025-05-25 - Missing index on jobs table for priority ordering
**Learning:** The jobs table in SQLite misses an index for `ORDER BY priority DESC, created_at ASC`, which is frequently used in `listJobs` and `claimNextJob`. While SQLite can use temporary B-trees, adding `idx_jobs_priority_created` directly avoids this sorting step, reducing CPU and improving claim/list latency.
**Action:** Add an index on `jobs(priority DESC, created_at ASC)` to SQLite memory store schema.
