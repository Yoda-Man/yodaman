## MODIFIED Requirements

### Requirement: GET /api/audit and DELETE /api/audit
`GET /api/audit` SHALL return a JSON array of audit entries, newest first, at most `limit` (default 100). `DELETE /api/audit` SHALL remove every audit entry and answer `{ message: "Audit logs cleared" }`. `DELETE /api/audit` MUST be refused to a request that is not from this computer, like `DELETE /api/logs`.

#### Scenario: Read
- **WHEN** `GET /api/audit?limit=20` is called
- **THEN** the newest 20 entries are returned as an array, not wrapped in an object

#### Scenario: Clear refused to a paired device
- **WHEN** `DELETE /api/audit` comes from an address other than loopback
- **THEN** the answer is 403 `{ error: "The audit log can only be cleared from this computer", code: "audit_local_only" }` and nothing is deleted

#### Scenario: Clear
- **WHEN** `DELETE /api/audit` is called from this computer
- **THEN** with SQLite every row of `audit_logs` is deleted; without it `audit-log.jsonl` is emptied and `audit-log.json` rewritten as `[]`
