# Automatic embedding acceptance

This candidate is verified with `scripts/verify.sh`, which is also run by CI and the release workflow. QMD is pinned to 2.5.3. Scheduling remains opt-in.

The behavioral fixtures execute the maintained scheduler/lifecycle and actual patched upstream functions with fake clocks, native contexts and database adapters. Policy completeness tests use real in-memory SQLite. Container smokes exercise the HTTP/MCP adapter without downloading models. These checks do not establish real model latency, memory sizing or production readiness.

| Case | Repository evidence |
|---|---|
| T01 | Disabled-path scheduler test and refresh image smoke |
| T02 | Interval and initial-delay bounds tests |
| T03 | Policy defaults, search-default independence and sequential selection |
| T04 | Zero-pending unit test and all-disabled enabled-scheduler image smoke |
| T05 | Queued/running update, embed and refresh claim tests |
| T06 | Same-turn shared maintenance admission tests |
| T07 | Query deferral and actual HTTP counter success/failure/overlap fixtures |
| T08 | Deferred first collection, one job/claim and sequential second collection |
| T09 | Shared-hash recheck and SQLite model/fingerprint/completeness/inactive-policy tests |
| T10 | Changed/removed/invalid policy and configuration-error tests |
| T11 | Mixed failures preserve results and permit a third collection |
| T12 | All-thrown and returned-chunk-error failures; claim reacquisition |
| T13 | Zero-error incomplete deadline, preserved debt and later successful tick |
| T14 | Same signal and original timer across two collections |
| T15 | Sequential/parallel in-flight native calls, aligned results and held claim |
| T16 | Model/context/tokenization/preparation abort; manual/default incomplete vectors removed, complete hashes retained |
| T17 | Execution/classifier/progress errors release the claim |
| T18 | Query arrival between collections leaves recoverable debt |
| T19 | Queued/running stop, timers cleared and real completion before close |
| T20 | Scheduler health transitions/cadence and HTTP/MCP disabled/enabled smoke |
| T21 | Quiet success/no-op/busy checks and sanitized failure summaries |
| T22 | Neutral docs/notes/history examples and fixtures; no deployment policy in scheduler |
| T23 | Existing update-only refresh/lexical-only search container smoke |
| T24 | Fail-closed upstream anchors, patched target syntax, executable SDK/session signal/default fixtures and canonical verifier |
| AE-25 | Consecutive short scheduled runs rotate the first eligible collection |
| AE-26 | Scheduled cooperative interruption retains completed chunk checkpoints |
| AE-27 | Scheduler explicitly enables resumable incomplete-document handling |
| AE-28 | A later resumable run skips already persisted chunk sequences |
| AE-29 | Cooperative deadline cancellation is not classified as a model failure |
| AE-30 | Vector search excludes incomplete checkpoint groups without reducing complete candidate capacity |
| AE-31 | Two separate short runs make cumulative progress and complete one document |
| AE-32 | Patched `store.embed` forwards both `signal` and `resumeIncomplete` to `generateEmbeddings` |

The tests live in `embedding-scheduler.test.mjs`, `maintenance-jobs.test.mjs`, `native-embedding-deadline.test.mjs`, `vector-search-completeness.test.mjs`, `query-tracking.test.mjs` and `embedding-policy.test.mjs` under `tests/`. Image smokes live under `scripts/`.

Release publication separately verifies amd64/arm64 packaging, provenance/SBOM and immutable release identity. Production activation must establish external resource limits, one index writer, representative backlog recovery and query responsiveness. Already-started native evaluations may exceed the cooperative deadline; batch bytes are not a RAM ceiling.
