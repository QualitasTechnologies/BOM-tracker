# Service & Support Module

## Purpose

The Service & Support module extends BOM Tracker beyond commissioning. It becomes the operating record for every post-commissioning issue on a supplied machine-vision system: what failed, contractual coverage, commercial approval, diagnostic work, documents used, root cause, solution, and customer closure.

The module is deliberately a light SOP. It imposes a small number of gates that prevent avoidable commercial or documentation errors without turning support into a heavy service-management process.

## Scope of the first release

- Internal support workspace for projects in `Ongoing` or `Completed` status.
- Manual ticket intake from email, phone, WhatsApp, site observations, or internal reports.
- Installed-machine profile with commissioning, warranty, AMC, location, serial number, and customer contact.
- Project support document pack: manuals, drawings, software/configuration backups, acceptance documents, AMC contracts, and photos.
- Ticket evidence: diagnostic logs, photos, quotation, acceptance/PO, RCA report, and solution report.
- Priority-based first-response and resolution targets.
- Assignment to a project member and a complete activity history.
- Warranty/AMC/chargeable/goodwill assessment.
- Quotation preparation, sending, acceptance/rejection, and invoice status.
- RCA, corrective action, preventive action, solution summary, and customer confirmation.
- Customer email for acknowledgement, quotation, and resolution.

Customer login, email-to-ticket automation, a public support form, inventory/spares consumption, field-service expense billing, and generated quotation PDFs are intentionally left for later phases.

## Ticket lifecycle

1. **Open** — issue recorded with customer, symptom, impact, priority, project, and source channel. Nobody has started working it yet.
2. **Waiting** — blocked on someone outside the support team: the customer needs to provide logs, images, remote access, a trial, or other input; or a quotation has been sent and acceptance/PO is pending.
3. **In progress** — active work: diagnosis, a scheduled remote session or site visit, the corrective fix being applied, or post-fix monitoring to confirm it holds.
4. **Resolved** — RCA, corrective action, and solution summary are complete, but customer confirmation is still pending.
5. **Closed** — customer confirmation is recorded (or explicitly marked not required).

`Cancelled` is available for duplicates, invalid requests, or work that will not proceed.

## Priority and initial targets

| Priority | Operational meaning | First response | Resolution target |
| --- | --- | ---: | ---: |
| P1 Critical | Machine/line stopped or severe safety/quality exposure | 2 hours | 8 hours |
| P2 High | Major degradation with material production impact | 4 hours | 24 hours |
| P3 Normal | Stable production with a support issue or workaround | 8 hours | 72 hours |
| P4 Low | Minor issue, question, training, or planned work | 24 hours | 120 hours |

These are internal targets, not contractual promises. A future settings screen can make them configurable by AMC/SLA.

## Commercial gate

Coverage is automatically suggested from the installed-machine warranty and AMC dates, then confirmed by the support owner.

- Warranty, AMC, and approved goodwill default to `Not required`.
- Out-of-coverage work defaults to `Quotation required`.
- Unknown coverage defaults to `Assessment required`.
- A chargeable ticket cannot move to `In progress` until quotation acceptance is recorded.
- Acceptance should reference a customer PO, approval email, or uploaded acceptance document.

## Closure gate

A ticket cannot be resolved until these fields are complete:

- Root cause
- Corrective action
- Customer-facing solution summary

A resolved ticket cannot be closed until customer confirmation is recorded (or explicitly marked not required). Preventive action is recommended but optional.

## Document responsibilities

The project document pack is reusable across tickets. Ticket evidence remains linked to the incident that produced it.

Before a commissioned project is considered support-ready, the recommended minimum pack is:

- Operating/maintenance manual
- Electrical and mechanical drawings
- Vision application and device configuration backup
- Commissioning/acceptance document
- Machine and installed-site identifiers
- Warranty or AMC dates
- Primary customer support contact

## Data placement

- Canonical customer contacts: `clients/{clientId}.contacts[]`
- Project support profile: `projects/{projectId}.supportProfile`
- Tickets: `projects/{projectId}/supportTickets/{ticketId}`
- Ticket activity: `projects/{projectId}/supportTickets/{ticketId}/activities/{activityId}`
- Project/ticket support documents: `projects/{projectId}/supportDocuments/{documentId}`
- Files: `projects/{projectId}/support/{ticket-or-project-scope}/{category}/{fileName}`

Keeping operational records below the project reuses the existing project membership rules.

### CRM contact ownership

The client record is the single source of truth for customer contacts. Admins retain full CRM management in Settings. Approved project members can add a contact from ticket creation, ticket detail, or support readiness; the scoped server action writes that contact to the same client CRM record without granting access to the rest of Settings.

- A project support profile stores `supportContactId`, which points to the preferred contact in the client CRM.
- A ticket stores `reportedByContactId` and `clientId`.
- The ticket also stores reporter name/email/phone as an incident-time snapshot. This is audit history, not a second editable contact database.
- Selecting an existing contact on a ticket immediately updates the ticket association; there is no separate "Save customer contact" action.
- Adding a contact inline creates it centrally and selects it in the current support workflow.
- Customer emails resolve the current address from the client CRM on the server. Legacy tickets without a contact reference fall back to their stored reporter snapshot.
- Existing clients with the legacy `contactPerson`, `email`, and `phone` fields are automatically presented as one primary CRM contact. The next client save writes the contacts array and keeps those legacy fields synchronized for older screens.

## Recommended next phases

1. Inbound support mailbox that creates tickets and threads replies into activity.
2. Customer portal or signed one-time links for ticket creation, evidence upload, quotation acceptance, and closure confirmation.
3. Configurable SLAs by AMC tier, business hours, escalation rules, and reminders.
4. Generated support quotation PDF, service report PDF, and digital acceptance.
5. Spares consumption, engineer time, travel, invoicing, and support profitability.
6. Searchable solution knowledge base built from approved closed-ticket RCAs.
