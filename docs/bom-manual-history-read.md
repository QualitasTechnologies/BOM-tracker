# Manual transcript and activity read parity (source stage)

Status: source and focused tests only. New history operations are not deployed or activated. A read-only real-data preflight has run; no business data was changed.

## What exists

Global `transcripts` (full `rawText`, no project field) and `transcriptActivities`
(`projectId`, optional `transcriptId`) are the manual history behind the original
Daily Updates / Activity Timeline. The original screen listed activities but never
displayed the stored full text. This stage adds a read-only way to open it.

## Server (`nativeProjectReads`, existing read-only callable)

Two new operations, both behind the existing `BOM_SCOPED_READS_ENABLED` gate,
current-actor verification and project membership (`authorize`). Existing
operations and request shapes are unchanged.

| Operation | Request keys | Result |
| --- | --- | --- |
| `activities` | `project_id`, optional `limit` (1-100), `cursor` | `project_id`, `actor_uid`, `project_version`, `activities[]`, `next_cursor` |
| `transcript` | `project_id`, `transcript_id` | `project_id`, `actor_uid`, `project_version`, `transcript`, `linked_project_count`, `transcript_version` |

- Capability: admin or `@qualitastech.com` (same rule as the Communications and
  Milestones tabs) **and** current membership (`memberIds` contains the UID, explicit
  `null` allowed, admin exempt). Others get `manual_history_forbidden` (403) before
  any manual-history read. No new admin-only rule: the global Firestore rules are unchanged.
- Activities: `where projectId == id`, ordered by `__name__` (no new index), cursor
  encrypted and bound to actor, operation and project. DTO is a whitelist:
  `id, projectId, projectName, type, summary, rawExcerpt, speaker, meetingDate,
  timestamp, source, transcriptId, createdAt, createdBy, createdByName`.
- Transcript: served only when a stored activity has both this `projectId` and this
  `transcriptId`. Unlinked, other-project, orphan and dangling transcripts all return the
  same `manual_transcript_unavailable` (404). No link is inferred from names or dates.
- `rawText` is copied verbatim (no stripping, trimming or truncation). More than
  1 MiB is `manual_transcript_too_large`; non-string text, bad enum values, wrong
  field types or a bad `transcriptId` are `invalid_manual_history_state` (409).
- Cross-project transcripts return `linked_project_count` only, never other project
  ids or names (`projectName` is the requested project's own activity field).
- The transaction is read-only. Activities are not emitted as email/meeting rows and
  the `projectReview` communications contract is untouched.

## Client

- `src/utils/nativeProjectReads.ts`: `activities()` and `transcript()` with strict
  envelope/DTO parsing, identity and context guards, and explicit error mapping.
- `src/utils/transcriptFirestore.ts`: `readScopedProjectActivities` (all pages, no SDK)
  and `getProjectSourceTranscript`. With scoped reads on it uses the server only and
  never falls back to the SDK after a denial. With scoped reads off it reuses the
  original SDK read but still requires a stored activity link for the project.
- `ProjectActivityTimeline`: unchanged layout. Activities carrying a `transcriptId` get a
  "View source transcript" button that opens the read-only `TranscriptSourceDialog`
  (fresh read per open/retry, text rendered as inert text, explicit error + Retry,
  multi-project warning by count). With scoped reads on the list itself is loaded through
  the server and reloaded after an edit/delete; flag-off keeps the live listener.
- Activity edit/delete and the paste dialog still use their existing SDK writes. No new
  write protocol; the separate writer fence is still required.

## Deployment note

`functions/manualHistoryRead.cjs` is required by `nativeProjectReads.cjs`; both ship in
the functions directory. `index.js` is unchanged. Deploying this source to the
read-only callable is a separate, explicit step.

## Not verified

A read-only real-data preflight verified all 18 activities across 3 projects and both stored transcripts (70,975 characters), including exact text and five stored project/transcript links. This is server-helper/data evidence, not signed-in browser acceptance of the new endpoint. Still open: production indexes
for the equality-only queries, the deployed callable, real users and roles, browser
behavior, and the later Firestore rules tightening and writer fence.

Scoped activity lists currently refresh after this screen edits or deletes an item. Content-free change notices for other users' activity and transcript changes remain required before full scoped-read parity can be claimed.
