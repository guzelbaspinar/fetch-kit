# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- **`buildUrl()` now ignores `baseUrl` for absolute URLs.** Previously, calling `request({ url: 'https://other-service.com/...' })` while `baseUrl` was configured produced an invalid, unusable URL (e.g. `https://api.example.com/https://other-service.com/...`). Absolute `http(s)://` URLs now bypass `baseUrl` entirely, as documented.
- **`Content-Type` header detection is now case-insensitive.** Setting a lowercase `content-type` header (e.g. `{ 'content-type': 'text/plain' }`) no longer causes a second, conflicting `Content-Type: application/json` header to be added.
- **`AbortSignal` now interrupts the retry backoff wait.** Previously, aborting a request only stopped an in-flight `fetch` call; the delay between retry attempts ignored the signal entirely, so cancellation could be delayed by the full backoff/retry duration (potentially tens of seconds). Aborting now interrupts the wait immediately and stops further retries.
- **`isNetworkError()` no longer treats arbitrary/programming errors as retryable network errors.** It now recognizes genuine network failures via `TypeError` (thrown by `fetch`/undici on connection failures) and known Node/undici error codes (`ECONNRESET`, `ECONNREFUSED`, `ETIMEDOUT`, `ENOTFOUND`, `EAI_AGAIN`, etc.). Unrecognized errors are no longer retried by default, preventing programming errors from being silently retried and masked.

### Documentation

- Added a "Module formats (ESM, CJS, TypeScript)" section to the README.
- Clarified `baseUrl` + absolute URL behavior, case-insensitive `Content-Type` handling, and the retry/`AbortSignal` interaction in the README.
