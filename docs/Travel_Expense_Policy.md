# Travel & Project Expense Logging — Team Policy

**App:** BOM Tracker → open any project → **Costs** tab → scroll to **Travel & Site Visits**

---

## Who does what

| Role | What they can do |
|---|---|
| **Team member** | Log visits, add expense bills, upload receipts, edit/delete own entries |
| **Admin** | Everything above + Approve or Reject reimbursement claims |

---

## Step 1 — Log a visit (team members)

After you return from a site visit or travel, go to the project in BOM Tracker, open the **Costs** tab, and click **Log Visit**.

Fill in:
- **Start date / End date** — for multi-day visits set both; the dialog shows you how many days
- **Who Went** — select everyone who travelled from the dropdown (project members only)
- **Location / Purpose** — e.g. "Client factory, Pune" / "Installation inspection"

The visit starts with status **Pending** — it needs admin approval before costs are counted as reimbursable.

---

## Step 2 — Add expense bills

Inside the same dialog, add one row per bill/receipt under **Expenses**. Click **+ Add Expense** for each one.

For every bill, select a **category**:

| Category | What to enter | Special fields |
|---|---|---|
| **Transport** | Description (e.g. "Ola cab, airport to factory") + total amount | — |
| **Accommodation** | Rooms × Nights × Rate per room/night — total is auto-calculated | Rooms, nights, people per room, rate |
| **Food & Per Diem** | Meal type (Breakfast/Lunch/Dinner/Snacks) + number of people + amount | Meal type, people count |
| **Client Entertainment** | Description + amount | — |
| **Communication** | Description (e.g. "Airtel roaming pack") + amount | — |
| **Miscellaneous** | Description + amount | — |

You can also tag each bill to a **specific day** within the visit — useful for multi-day trips.

**Upload receipts** — click the paperclip icon on any row to attach the bill photo or PDF. This is stored in Firebase Storage and linked to the expense item. Not mandatory but strongly encouraged for approval.

Click **Save Visit** when all bills are added.

---

## Step 3 — Admin approval

Admins will see the visit in the Travel & Site Visits table with a **Pending** badge and two buttons: **Approve** and **Reject**.

- Click **Approve** → badge turns green (Approved). The cost is included in project overhead totals.
- Click **Reject** → badge turns red (Rejected).

Once approved or rejected the buttons disappear. To change a decision, edit the visit and re-save — or contact the admin who made the call.

---

## Viewing expense breakdown

Click anywhere on a visit row to expand it and see the full bill-by-bill breakdown:

- Category badge, description, date of the bill, and amount for each line
- Accommodation shows the full calculation: `2 rooms × 3 nights × 1 ppl/rm @ ₹3,500 = ₹21,000`
- Paperclip icon on rows with receipts — click to open the uploaded file

---

## Other overhead categories

Use **Add Overhead** (in the "Other Overheads" section below Travel) for project costs that aren't travel:

- Testing & Certification
- Freight & Logistics
- Admin & Documentation
- Training
- Other

These are a single date + amount + description entry, no approval step — just log and save.

---

## How costs roll up to the project budget

The **Costs** tab header shows a budget bar:

```
Project Budget: ₹5,00,000
─────────────────────────────────────
BOM Material & Services │ Overheads │ Total Spent
₹3,42,000               │ ₹28,500   │ ₹3,70,500
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━ 74.1% of budget used
```

- **BOM Material & Services** — sum of all priced BOM items (components + services)
- **Overheads** — sum of all travel visits + other overhead entries (regardless of approval status)
- **Total Spent** — the combined number used against the project budget

> Note: overhead costs are included in totals regardless of reimbursement status. Approval tracks *who gets reimbursed*, not whether the cost happened.

Admins can set or change the project budget by clicking the pencil icon next to the budget figure.

---

## Quick checklist for team members

Before a trip:
- [ ] Confirm you are listed as a project member (Settings → Users or ask an admin)

After a trip:
- [ ] Log the visit on the same day or within 48 hours
- [ ] Add one expense row per bill — don't lump everything into one "Misc" entry
- [ ] Upload receipt photos for accommodation and transport bills
- [ ] Check the visit status — if still Pending after 3 business days, follow up with the admin

---

## FAQs

**Can I edit a visit after saving?** Yes — click the pencil icon on the row. Editing does not reset the approval status.

**Can I add bills after the visit is approved?** Yes — edit the visit, add the new rows, save. The admin will need to re-review if the total changes significantly.

**What if I forgot to select someone in "Who Went"?** Edit the visit and update the attendees — no re-approval needed for attendance changes.

**Who is an admin?** Anyone with Admin role in Settings → Users can approve/reject visits.
