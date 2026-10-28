# Material cutover and uncertain-write recovery

This stage pairs the existing material handler with recoverable original-screen
actions. It does not enable material writes or retire standalone BOM.

## Server contract

- Every new patch, fulfillment, bounded command and project creation reads
  `pulseRuntimeControl/cutover` in its write transaction. Legacy HTTP permits
  `coexist`; the native callable permits `coexist` and `pulse_only`. Unknown modes
  and `read_only` reject new writes. Missing mode retains coexistence.
- Native `resolve_only: true` settles the original actor/email/payload/nonce-bound
  receipt even when ordinary writes are paused. A missing receipt becomes a
  cancellation receipt and audit entry, without a business-data change. The late
  original request can never commit with that cancelled nonce.
- Current project/category authority and fresh actor checks still apply.
  Cancelling project creation into an existing project requires current access.
  A scoped actor cannot recover an old receipt that lacks category proof.
- A cancelled patch/fulfillment response contains `item_id` but no `item`.
  Committed responses carry the stored result; a fresh read supplies current state.

## Browser contract and homes

- Both typed and direct command clients persist the exact request before sending.
  Uncertain requests retain their actor, nonce, version and payload. New work
  cannot silently replace them. Known pre-commit refusals release only a first
  attempt; unknown/internal failures remain recoverable.
- Random journal tokens prevent late ordinary responses, resolutions and
  acknowledgements from clearing or replacing a newer pending request.
- Explicit resolution works with edit flags and permissions closed. Resolved
  requests remain until a fresh authoritative read succeeds. A cancelled project
  creation can be acknowledged by a definitive `project_not_found` result.
- BOM shows a recovery banner; Projects shows saved project creations. Both offer
  a Check status action even when editing is disabled, and retain the outcome.
- The journal uses session storage. Closing that tab loses the local request;
  this is not a device/session migration facility. Server receipts remain intact.

## Verification and release

Root verification passed 138 focused backend tests, 72 client contract/race tests
and 22 UI tests. Six contract cases connect the real callable factory directly to
the real typed/direct clients, rather than using hand-authored response fixtures.
Page tests exercise the BOM and Projects recovery controls with editing off.
Independent review findings about creation-cancel authority, refusal handling and
late completions have regression coverage. Exact-head hosted checks and the
production build are still release prerequisites.

The scoped project/document reader and remaining legacy/direct writer fences,
role/user acceptance, real authorized edits, full history/files and measured
coexistence/read-only/shutdown remain separate retirement gates. Do not activate
native writes merely because this source stage passes.
