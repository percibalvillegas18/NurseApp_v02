# Staff positions, assignments, and credential tracking

Nurse Master now records the nine supplied position codes (HN, AHN, CI, SN,
PCT, TEC, CN, HCA, MW). Position is an employment attribute and does not assign
an authorization role. The existing Primary Role field remains separate. V4_10 adds an explicit
employment-position hierarchy to the same catalog: HN is the root, AHN/CI/CN/MW
report to HN, and SN/PCT/TEC/HCA report to CN. This is descriptive employment
metadata only; it does not grant authorization or replace RBAC roles. The
hierarchy is available from `GET /api/v1/contracts/positions/hierarchy`, while
the existing flat positions endpoint remains backward-compatible.

Select a department before selecting its nursing unit. Changing department
clears the previous unit selection. The migration adds the four supplied
departments and 43 units to the existing `CENTRAL_HOSP` organization, preserving
legacy departments, units, assignments, and permission scopes. The same position
codes are also added to the existing contract position reference table.

## Record credentials

Open **Credentials**, select a staff member, and choose **Add Credential**.
The 16 templates are grouped under Identity & Legal, Licensure, Liability &
Clearance, Clinical Competency, and Life Support. Each template displays its
specific tracking fields. Dates are optional; reassessment dates feed the
existing expiry tracking. Iqama Gregorian and Hijri expiry dates are separate
entries, with no automatic calendar conversion.

Save a credential, then choose **View** to review its details or upload a copy.
PDF, JPEG, and PNG copies up to 5 MB are stored in PostgreSQL. Download requests
go through the authenticated credential API; no public file URLs are created.
Uploading another copy replaces the current copy. The upload action requires
CREDENTIALS EDIT, while downloading requires CREDENTIALS VIEW.
Credential reads, edits, verification, alerts, and document access also check
the caller's active Hospital, Department, NursingUnit, All, or own-record
Assigned data scope. Lookup lists and unit assignment validation use the same
scope boundaries. Document downloads use private, no-store response headers.

Nurse lists, nurse details, edits, and deletion use those same scope boundaries.
Roster lists and mutations additionally support Post and Shift scopes. Creating
or moving a roster assignment validates its nurse, active unit, active shift,
optional post, the post-to-unit relationship, and both the existing and target
scope. A nurse detail only includes upcoming assignments visible to the caller.

Creating/editing records requires the existing CREDENTIALS CREATE/EDIT
permissions. Verification remains a separate CREDENTIALS VERIFY action. Editing
details or replacing a document resets verification. The credential's template
cannot be changed after creation. Existing license/certification records remain
viewable and editable. The Employment Contract template tracks credential
evidence; it does not replace the Contract module's approval/renewal workflow.
An expired credential cannot be verified as Valid; its expiry date must first
be corrected or renewed.

The expiry radar retains its existing filter for active staff with Valid or
ExpiringSoon credentials. The new staff table also shows unverified credentials
and credentials without expiry dates. Tracking values are not copied into the
audit log; edits record field names.

## Apply the feature

Back up the database and use the application's normal deployment process:

1. Run `npm run db:migrate:raw` from `backend` with the target `DATABASE_URL`.
   The runner includes `V4_3__staff_credential_tracking.sql` after V4_2. Use the
   raw SQL migration runner, rather than Prisma schema push, to retain the SQL
   enum additions, partial unique index, and document table.
2. Run `npm run prisma:generate`, then build/restart the backend.
3. Build and deploy the frontend with `npm run build`.

The feature requires the database-backed backend. The standalone demo
`mock-server.js` is not a persistent credential store. No running hospital
database or deployment was changed while implementing this feature.

## Validation

The backend unit suite covers template and field validation, date ordering,
position validation, partial updates, verification resets, unit validation,
document signatures/size limits, and parameterized document storage. Existing
nursing tests remain in place. Both applications compile and lint (the
repository still reports lint warnings).

Migration checks were also run against an isolated PostgreSQL engine with
legacy fixtures: transactional application, safe reruns, all 43 supplied units,
preservation of existing assignments, template uniqueness, file size constraints,
and the production upload/download SQL round trip.
