# Scoped history live refresh

Scoped project activity history and open source transcripts now use the existing
`projectReadSubscriptions` lifecycle. Activity writes invalidate projects named
by the before/after activity rows. Transcript writes page through all linked
activities and invalidate each actual linked project. Notices remain the
existing content-free `{ version, nonce }` records under the existing server
read gate. The legacy activity SDK listener remains limited to the flag-off
path.

The implementation is staged and default-off. Runtime trigger deployment and
Firestore Rules verification are still required before activation.

## Implementation notes

- `subscribeProjectRead` hands readers an `assertContext` that throws when stale;
  manual-history reads take a boolean `isCurrent`. `asIsCurrent` in
  `transcriptFirestore.ts` adapts one to the other (throw propagates, else `true`).
- The transcript trigger pages linked activities by `__name__` and fails closed
  (`signal_link_pagination_stalled`, no notices written) when a page's last
  document id equals the cursor's id; snapshot object identity is not used.
