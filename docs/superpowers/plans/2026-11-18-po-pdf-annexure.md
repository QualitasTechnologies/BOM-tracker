# Honor the existing PO annexure selection

Goal: render the stored terms annexure when includeAnnexure is exactly true and the stored terms text is nonempty. Existing form/types/authoring already define this contract; no new feature or UI redesign.

Design: after the original signature section, add an independent annexure page with PO identity and the exact stored terms text using existing PDFKit fonts/margins and automatic pagination. Do not infer, rewrite, substitute defaults or change monetary values. False/missing selection or blank text leaves the original document unchanged. Existing immutable artifacts return before rendering. Public previews remain unique create-only objects; no historical objects or records are rewritten.

Alternatives: inline terms before signature risks reflowing the issued layout; a separate attached file would change the existing include-in-PDF contract. Append an annexure using the existing renderer.

- [x] Reproduce omission through the actual authorized callable renderer with parsed PDF content.
- [x] Cover exact true, false/missing/blank terms, long multipage terms, same first-page content, unchanged issued object and cached native artifact.
- [x] Implement the smallest append-only renderer change.
- [x] Inspect rendered synthetic fixtures; run focused/full backend checks and build.
- [ ] Commit/PR; verify exact hosted checks before merging.
- [ ] Deploy only the preview entrypoint with source/config/record preservation evidence; do not activate writes or send to providers. Other sender deployments require their own parity/rollback review.

Historical annexures/provenance remain unresolved pending the owner response; this does not regenerate historical issued PDFs or certify legal terms.
