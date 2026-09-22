# Complimentary Capture Cloud access

Complimentary access is an owner-specific Cloud entitlement. It is not a Polar subscription and must never create or modify Polar customer or subscription records.

## Safety boundary

- Resolve the intended account in the hosted Supabase Auth dashboard and copy its immutable Auth user UUID.
- Do not place the account email in source, SQL, shell history, issue text, screenshots, notes, or operational logs.
- Run grant and revocation operations only in the hosted Supabase SQL editor or another approved service-role/admin session. Browser roles cannot read or write the grant table.
- Use UUIDs only. Verify the UUID against the Auth dashboard immediately before running the operation.

## Grant

Indefinite:

```sql
select public.grant_capture_cloud_complimentary_access(
  p_user_id := '<AUTH_USER_UUID>'::uuid,
  p_expires_at := null
);
```

Time-bounded:

```sql
select public.grant_capture_cloud_complimentary_access(
  p_user_id := '<AUTH_USER_UUID>'::uuid,
  p_expires_at := '<ISO_8601_EXPIRY>'::timestamptz
);
```

A successful call returns `true`. Re-running it for the same UUID replaces the expiry and clears a prior revocation.

## Read back

Use the same admin session and UUID. Do not query by email.

```sql
select public.capture_cloud_access_current('<AUTH_USER_UUID>'::uuid);
```

Expected result after a current grant: `true`. Then sign in as that owner and verify `/api/cloud/subscription` reports `tier: "cloud"`, `accessSource: "complimentary"`, `plan: null`, and no billing-management control unless the owner also has a real Polar subscription.

## Revoke

```sql
select public.revoke_capture_cloud_complimentary_access(
  p_user_id := '<AUTH_USER_UUID>'::uuid,
  p_revoked_at := clock_timestamp()
);
```

Read back the canonical predicate and require `false` unless the UUID independently has a current paid entitlement. Account-erasure confirmation also revokes a current grant atomically, and app-row cleanup deletes it before Auth deletion.
