# Bio-Solar Swarm Studio — Phase 0 Security Specification

## 1. Data Invariants
1. **Zero Unauthenticated Access**: No collection permits unauthenticated reads or writes. All writes require `request.auth != null && request.auth.token.email_verified == true`.
2. **PII Isolation**: User email addresses are stored exclusively in `/users/{userId}/private/security`, readable and writable only by the owning user (`request.auth.uid == userId`) or verified admin.
3. **No Self-Assigned Privileges**: Users registering in `/users/{userId}` can only create with `role == 'operator'` or `role == 'viewer'`. Setting `role == 'admin'` is rejected unless `isAdmin()` is already satisfied. `/admins/{userId}` denies all client writes.
4. **Immutable Audit Trail**: `/audit_logs/{logId}` is append-only (`update` and `delete` are strictly `false` for all clients). `actorUid` must match `request.auth.uid`, and `createdAt` must equal `request.time`.
5. **Individual Pod Power Control Integrity**: `/pods/{podId}` writes verify `isValidPodControlState()`, enforce `lastOperatorUid == request.auth.uid`, validate `updatedAt == request.time`, and reject unknown fields via `.keys().hasOnly(...)` and `affectedKeys().hasOnly(...)`.
6. **Owner-Scoped List Queries**: `/sessions/{sessionId}` `allow list` strictly evaluates `resource.data.ownerUid == request.auth.uid || isAdmin()`. `/audit_logs/{logId}` `allow list` evaluates `resource.data.actorUid == request.auth.uid || isAdmin()`.

## 2. The "Dirty Dozen" Attack Payloads (All Must Yield `PERMISSION_DENIED`)
1. **Unauthenticated Pod Read**: `GET /pods/BSS-POD-01` with `auth == null` -> DENIED.
2. **Unverified Email Admin Spoof**: `CREATE /pods/BSS-POD-01` with `email == 'champofroman@gmail.com'` and `email_verified == false` -> DENIED.
3. **Self-Assigned Admin Escalation**: `CREATE /users/u1` with `{ uid: 'u1', displayName: 'Attacker', role: 'admin', createdAt: now, updatedAt: now }` -> DENIED.
4. **Ghost Field Shadow Write**: `CREATE /users/u1` with `{ ..., isVerified: true }` -> DENIED by `hasOnly`.
5. **Cross-Owner PII Read**: `GET /users/victim/private/security` signed in as `attacker` -> DENIED.
6. **Audit Log Tampering (Update)**: `UPDATE /audit_logs/log1` trying to alter `status` or `entryHash` -> DENIED (`allow update: if false`).
7. **Audit Log Deletion**: `DELETE /audit_logs/log1` even by actor or admin -> DENIED (`allow delete: if false`).
8. **Forged Audit Actor UID**: `CREATE /audit_logs/log2` with `actorUid: 'victim_uid'` while signed in as `attacker` -> DENIED.
9. **ID Poisoning (>128 chars or special chars)**: `CREATE /sessions/bad..id..with..150chars...` -> DENIED by `isValidId()`.
10. **Client Timestamp Forgery**: `CREATE /sessions/s1` with backdated `createdAt` instead of `request.time` -> DENIED.
11. **Value Poisoning on Pod Update**: `UPDATE /pods/BSS-POD-01` setting `enabled: "yes"` (string instead of bool) or 500-char `lastReason` -> DENIED by `isValidPodControlState()`.
12. **Blanket Collection Scraping**: `LIST /sessions` without `where('ownerUid', '==', uid)` by non-admin -> DENIED by `resource.data.ownerUid == request.auth.uid`.
