# MCP material-write authorization

`bom_add_item` requires a Firebase user resolved from the MCP SDK's authenticated request context (`extra.authInfo.extra.firebaseUid`). Tool arguments are never an identity source. The resolver verifies that the referenced Firebase Auth user still exists, is enabled, and has `customClaims.status === "approved"` for each call.

The writer checks current project membership and the caller's category scope in the same Firestore transaction as the BOM revision check, mutation, audit record, and idempotency receipt. Approved admins retain BOM's existing project-wide access. Other users must appear in `project.memberIds`; internal Qualitas users retain the existing all-category rule, while other users are restricted to their `project.members[].categoryScope`. Replayed receipts are also checked against current membership and category scope.

The shipped MCP executable currently uses `StdioServerTransport`, which does not provide an authenticated MCP `authInfo` principal. As a result, material writes fail closed in the current stdio mode; this change does not map the server's shared Google/Firebase credential to a human. Reads continue to work. Enabling writes requires a separately reviewed authenticated MCP transport/authenticator that verifies a per-user session and attaches the Firebase UID to the SDK-authenticated context. That mapping must come from trusted authentication configuration or verified claims, never a tool argument. Do not enable writes until that transport is in place and tested.

This writer guard applies only to the MCP `bom_add_item` operation. It does not fence the BOM browser UI or any other legacy writer.
