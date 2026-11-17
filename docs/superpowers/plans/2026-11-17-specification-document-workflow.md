# Preserve and open manually linked specification documents

Goal: repair the existing specification workflow without a new UI, capability, endpoint, feature switch or provider request. Preserve manual document intent and the current permission-checked read paths during BOM-to-Pulse migration.

## Confirmed failures and design

The current found-spec button renders for linkedSpecDocumentId but opens only specificationUrl. A manually linked uploaded sheet therefore cannot be opened, and an unrelated provider URL takes priority when both fields exist. Native and legacy search identity also omit linkedSpecDocumentId: the existing sealed synthetic reproductions show a provider response completing instead of conflicting after a manual selection changes.

Opening: keep the same found button. A direct URL without a manual document keeps its existing behavior. A manual document takes priority: on user click, synchronously open an empty tab, remove its opener, then resolve the document through getProjectDocumentsByType(projectId, spec-sheet, isCurrent). Navigate that tab only for one exact document ID/project/type with a usable HTTP(S) URL and the same mounted component, project/item/link and authenticated account. Close an owned pending tab on error, context change or unmount; do not close a successfully opened sheet. Do not fall back to another provider URL on denied/missing/malformed reads. Suppress double-click dispatch. Show the existing error toast on a current failed request. Opening an empty tab during the gesture avoids browser popup blocking after an async read.

The legacy reader currently lets a stored id override the Firestore snapshot id. Add a regression and keep the canonical snapshot id when projecting documents, so the selector cannot be fooled by a different row's stored id.

Search: store a version2 searched snapshot with the explicit linkedSpecDocumentId (including null) before provider dispatch; compare it before every fresh or recovered result write. Track the same field in the legacy searched identity. Preserve latest unrelated metadata, no-result URL semantics, current membership/category/owner/gate checks, terminal receipt replays and two-step canonical operation adoption. Insufficient old version1 provenance remains unresolved with its lock and no redispatch; never infer a missing historical document identity.

## Files and checks

- BOM functions/nativeSpecSearchOperations.cjs and tests; functions/legacySpecSearch.cjs and tests. Mirror the existing legacy factory/test only in Pulse integration/bom-project-review.
- Pulse apps/bom/src/components/BOM/SpecSearchButton.tsx and rendered tests; projectDocumentFirestore.ts and read projection test. Mirror applicable UI/service/tests into canonical BOM src paths after proving their prior contents agree.
- Add failing regressions before implementation: manual link added/replaced/removed during a search and after a paused accepted result; v1 unresolved provenance versus completed replay; exact saved v2 provenance before dispatch. Legacy cannot write a URL after a manual link change.
- Rendered tests cover linked-only opening, manual-over-URL priority, denied/missing/wrong-project/type results with no fallback, stale project/item/link/account/unmount, duplicate clicks and blocked popups. Preserve existing direct URL and search client-selection tests. Verify canonical document identity in the actual reader.
- Run focused tests, real emulator cases for both native fresh/recovered manual-link conflicts, full backend/security/Pulse contracts and affected UI tests/builds. Require exact-head hosted checks and solo source review.

## Release and preservation

Use new specification-document-workflow-20261117 recovery evidence; do not change sealed older stages. Fresh before snapshots must start at86functions, current Rules94/eae, nativeSpec00002-fud, legacy trigger00022-daf, current three repaired controllers00002, Gmail00004-gut/00005-wuv, absent cutover control/material markers and disabled/unset feature prerequisites. Protect current Pulse main/server7a50026 and all34local files/CRM work plus consistent SQLite backup.

After validation, merge pinned sources and deploy only nativeSpecSearchOperation and triggerSpecSearch. No real n8n/provider/send/authenticated production test or feature activation. Verify downloaded source, other84 functions/settings/access/secret references/flags/Rules/protected records and schedules. Merge Pulse and observe its normal deployment, exact code, preserved local files, health/integrity/public flags. Seal checksum evidence and report limits; the broader workflow/user-acceptance/reconciliation/retirement goal remains open.


## Verified implementation notes

Native/legacy backend regressions produced nine expected failures before the identity/provenance fix; all61 focused search cases now pass. Twenty rendered opening cases plus the canonical-ID regression failed before the UI/reader fix. Pulse's affected UI/client/flag/read-path set now passes103cases. A real Chrome fixture confirms that the user-gesture popup opens the selected manual document instead of the provider URL, has no opener, performs one permitted-path read, and stays open after the source component unmounts. All network requests outside loopback and the intercepted synthetic document were blocked; no unexpected requests or browser errors occurred. Two local fixture setup attempts failed before the actual new tests ran or before browser rendering; their logs are retained and not counted as verification.

Canonical and Pulse sources differ intentionally: standalone keeps its existing legacy search client and material-mode imports. Only the opener and canonical-ID projection delta is shared there; Pulse's existing native search client remains unchanged. The Pulse legacy backend mirror was missing the previously deployed unsuccessful-provider guard; its corresponding case plus the three manual-selection cases failed first (4of8), and the guarded factory/test now match canonical source.

Full backend1272pass/1emulator-onlyskip and Pulse779review contracts pass. New real security cases cover fresh dispatch conflict, concurrent saved-result conflict with original audit preservation, and oldv1 unresolved provenance. Five focused rounds passed; the full168security run passes. Exact-head hosted checks, final builds and release verification remain required.
