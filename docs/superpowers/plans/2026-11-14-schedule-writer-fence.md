# Schedule writer coexistence repair

Goal: prevent original SDK clients from overwriting native schedule state, history or milestone identity during the already approved cutover. No new UI or activation.

Five actual native+SDK loopback reproductions against the published overhead-policy baseline show: completion rollback, project baseline removal, archived milestone recreation, project deadline rollback and delay-history deletion. Production incident is not inferred. Evidence: schedule-coexistence-audit-20261114/findings.json.

Reuse exact-boolean scheduleClientWritesFenced in the private runtime control. Native milestone reads advertise editing only with fence+existing environment/mode; new commands require it transactionally. Receipt replay/resolution/cancellation keep existing access while paused. Project metadata requires the fence only when a deadline actually changes, preserving unrelated metadata and unchanged deadline payloads. Milestone access must match original Rules: explicit null or listed current member, with admin bypass; absent/malformed membership denies in both read modes.

Rules addition: retain reads and original roles. With exact true, block original SDK milestone/delayLogs writes, project schedule-field changes (deadline/originalDeadline/isBaselined/baselinedAt/baselinedBy) and project deletion. Preserve unrelated project updates, subcollections and new-project creation. A stale set on an existing project is an update and must retain schedule fields. Privileged server writers remain separately audited; this does not claim global read-only.

Generate a new staged artifact from exact live firestore.overhead-fence.rules SHA2f4a9b6f0390ef91c9f1e4cf954e7e88c872839b9901c4e922655c096de294d0. Removing the schedule additions must reproduce that baseline byte-for-byte. Preserve earlier staged artifacts; never publish the whole candidate. Alternative global pulse_only would stop unrelated legacy workflows and still requires Rules fencing; a UI-only gate cannot block cached clients.

- [x] Reproduce with real published Rules, actual factories and SDK in loopback.
- [x] Fail new native guard/access/recovery tests before implementation (4 expected failures).
- [x] Add minimal guards, accepted positive fixtures and shared Pulse contract delta; preserve older Pulse serialization reference.
- [x] Add reversible pinned Rules generator/artifact plus actual SDK/native inversions of every reproduced case, role and boundary checks. Staged7, fullsecurity140, Functions1133pass/1emulator-onlyskip and Pulse740contracts pass. Initial local command had a relative Rules override error plus one nonreproduced document-publication concurrency failure; corrected standard-config diagnostic run passed all140, with original failure retained as evidence and no document-code change.
- [ ] Full relevant tests, builds/hosted checks and personal diff review; merge exact tested heads.
- [ ] Protect before runtime/source/data/Rules evidence, selectively update only affected handlers, verify settings/IAM/gates/data and unrelated services.
- [ ] Publish only the tested conditional Rules addition on the live baseline, with fence absent/off and native writes still disabled. Verify source, release, control and protected recovery evidence.
- [ ] Update handoff, retaining individual user acceptance, remaining resource fences, reconciliation, coexistence and whole-system rollback/shutdown gates.
