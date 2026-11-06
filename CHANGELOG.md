# Buraq Holidays 1.1.0 — Implementation Record

## Approved scope implemented

### Pilgrim Management
- Replaced the main pilgrim Email Address field with Visa Number.
- Added Visa Category, Confirmed ticket status, PNR Reference, outbound and return route fields, flight dates/times, hotel check-in/check-out times, transport arrangements and a day-wise Ziyarah schedule.
- Updated the A4 travel voucher printout to include both travel legs, visa/ticket/PNR information, hotel timings, transport and Ziyarah details.
- Removed the Cost & Payment Management step from the active workflow and removed package-cost/payment data from new pilgrim drafts and voucher printouts.
- Historical cost properties in previously saved records are not bulk-deleted.

### Package Generator
- Added a main-menu module to create, edit, save, reopen and print complete package itineraries.
- Captures client name and CNIC plus visa, travel, hotel, transport and Ziyarah details.
- Does not collect package costs or payments.
- Stored in the new `buraq_commercial_data` encrypted application-data key.

### Ticket Booking
- Added Single Route and Double Route workflows.
- Captures passenger name, CNIC, passport/contact, ticket category, airline, country/city/airport, flight and travel times, PNR, ticket status and package maker.
- Country, city, airport and airline fields are free-text for international coverage.
- No payment fields are included.
- Saved ticket records share `buraq_commercial_data`.

### Finance & Accounts
- Added CNIC to client records and client search.
- Added Package Generator import in Client Accounts. Imported package clients start with an agreed amount of zero so Finance Admin must enter the agreed amount before receivables can be calculated.
- Added letterhead print actions to client, income and expense forms and client records.
- Saving an income receipt opens the browser print dialog. Receipts include the current payment, cumulative received amount, agreed package amount and outstanding balance when linked to a client.
- Existing financial calculations and payment rules were not rewritten.

## Change traceability

| File | Change |
|---|---|
| `public/index.html` | Embedded Pilgrim Management updates; new Package Generator and Ticket Booking modules; main-menu navigation; new commercial-store hydration/sync hooks; finance letterhead printing and package import. |
| `server/index.js` | Added `buraq_commercial_data` to encrypted app-data initialization and role access; added shape validation for package/ticket arrays; retained compatibility with older four-key backups. |
| `README.md` | Updated architecture, roles, modules, storage, printing, Railway/Neon and Namecheap cPanel instructions. |
| `.env.example` | Added optional `PGSSLMODE=require` guidance for external PostgreSQL/Neon. |
| `package.json` | Version updated to 1.1.0. |
| `PROJECT_VERSION.txt` | Version updated to 1.1.0. |
| `render.yaml` | Removed legacy Render deployment manifest; supported target is GitHub + Railway/Neon or Namecheap cPanel + Neon. |

## Database and API impact
- No table or column was renamed or removed.
- No destructive SQL migration is required. On startup, `initDb()` creates the new `app_data` row for `buraq_commercial_data` if it does not exist.
- `/api/data` now returns the commercial store to Super Admin, Pilgrim & Card Admin, and read-only Finance Admin. Writes are allowed for Super Admin and Pilgrim & Card Admin.
- `/api/data/:key` validates that the new commercial value contains bounded `packages` and `tickets` arrays with string IDs.
- Existing finance, pilgrim and user data was not accessed or modified during this code-only change.

## QA performed
- `npm run check` — passed (`node --check server/index.js`).
- Node syntax checks — passed for both outer application scripts and embedded Finance, Pilgrim, ID Card, Package Generator and Ticket Booking scripts.
- Embedded `SOURCES` object evaluation — passed; all five modules were present.
- Static feature assertions — passed for Visa Number, Visa Category, return routes, Confirmed ticket status, PNR Reference, hotel times, transport, Ziyarah, removal of the costs tab/print section, package generator, ticket booking and finance receipt printing.
- ZIP extraction integrity — verified at delivery.

## Tests not executed / limitations
- Dependency installation timed out in the isolated build environment; no `node_modules` or lockfile was added.
- Browser interaction testing could not be completed because the local Chromium runtime rejected local HTTP navigation with `ERR_BLOCKED_BY_ADMINISTRATOR`.
- A live Express startup, PostgreSQL connection, authentication/session test, role enforcement against a real database, Railway deployment and Namecheap deployment were not executed because no runtime database credentials or hosting account were supplied.
- Print workflows use the browser print dialog; choose **Save as PDF** to create the PDF.
- Finance Admin must explicitly click **Import Package Generator** to import package clients. Finance Admin then enters the agreed amount; package generation does not set or collect financial amounts.
