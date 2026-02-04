# Migration Log

This file tracks all changes made to the production application for safety and rollback purposes.

---

## Template for New Entries

```markdown
### Step X.X — [Short Title]

**Date/Time:** YYYY-MM-DD HH:MM (UTC)

**Goal:** [What this step aims to achieve]

**Risk Level:** [Low / Medium / High]

---

#### Code Changes

| File | Description |
|------|-------------|
| `path/to/file.ts` | Short description of change |

---

#### Supabase SQL Changes

```sql
-- SQL executed (if any)
-- Specify: Test or Live environment
```

**Executed in:** [Test / Live / N/A]

---

#### Rollback Plan

**Lovable Rollback:**
- [ ] Revert file X to previous version
- [ ] Revert file Y to previous version

**Supabase Rollback SQL:**
```sql
-- SQL to undo the changes (if applicable)
```

---

#### Post-Step Verification Checklist

- [ ] Verification item 1
- [ ] Verification item 2
- [ ] Verification item 3

---

#### Result / Notes

[Outcome of this step. Any observations or issues encountered.]

---
```

---

## Change History

---

### Step 0.1 — Create Migration Log

**Date/Time:** 2026-02-04 (UTC)

**Goal:** Create a structured migration log file to track all future changes to production app

**Risk Level:** Low

---

#### Code Changes

| File | Description |
|------|-------------|
| `MIGRATION_LOG.md` | Created new file with template for logging changes |

---

#### Supabase SQL Changes

```sql
-- N/A
```

**Executed in:** N/A

---

#### Rollback Plan

**Lovable Rollback:**
- [ ] Delete `MIGRATION_LOG.md` file

**Supabase Rollback SQL:**
```sql
-- N/A
```

---

#### Post-Step Verification Checklist

- [x] File `MIGRATION_LOG.md` exists at repository root
- [x] Template sections are complete and readable
- [x] No other files were modified

---

#### Result / Notes

Migration log created successfully. Ready to track future changes.

---

### Step 1.1 — Backfill NULL tenant_id in invite_links, system_logs, subscription_tiers

**Date/Time:** 2026-02-04 (UTC)

**Goal:** Backfill NULL tenant_id in invite_links/system_logs/subscription_tiers using canonical tenant_id from admin_settings (safe for production; no changes to payments/admin_settings).

**Risk Level:** Low (data tagging only)

---

#### Code Changes

| File | Description |
|------|-------------|
| N/A | No code changes — SQL only |

---

#### Supabase SQL Changes

**Step 1.1A — READ ONLY (identification + counts):**
```sql
-- Identified canonical tenant_id from admin_settings
SELECT tenant_id FROM admin_settings ORDER BY created_at DESC LIMIT 1;
-- Result: 6749bded-94d6-4793-9f46-09724da30ab6

-- Counted NULL tenant_id rows in each table
SELECT COUNT(*) FROM invite_links WHERE tenant_id IS NULL;
SELECT COUNT(*) FROM system_logs WHERE tenant_id IS NULL;
SELECT COUNT(*) FROM subscription_tiers WHERE tenant_id IS NULL;
```

**Step 1.1B — WRITE (updates only where tenant_id IS NULL):**
```sql
-- Update invite_links where tenant_id is NULL
UPDATE invite_links 
SET tenant_id = '6749bded-94d6-4793-9f46-09724da30ab6' 
WHERE tenant_id IS NULL;

-- Update system_logs where tenant_id is NULL
UPDATE system_logs 
SET tenant_id = '6749bded-94d6-4793-9f46-09724da30ab6' 
WHERE tenant_id IS NULL;

-- Update subscription_tiers where tenant_id is NULL
UPDATE subscription_tiers 
SET tenant_id = '6749bded-94d6-4793-9f46-09724da30ab6' 
WHERE tenant_id IS NULL;
```

**Executed in:** Live

---

#### Rollback Plan

**Lovable Rollback:**
- [ ] N/A — no code changes

**Supabase Rollback SQL:**

⚠️ **WARNING: No safe SQL rollback is available for Step 1.1.**

The original row IDs that had `tenant_id = NULL` were not captured before the update. Running a blanket `UPDATE ... SET tenant_id = NULL WHERE tenant_id = '<canonical_id>'` would incorrectly null out ALL rows (including those that legitimately had the tenant_id set before this migration), which is unsafe.

**If rollback is required:**
- Use Supabase point-in-time recovery (PITR) to restore the database to a snapshot taken before Step 1.1B was executed.
- Alternatively, restore from a manual database backup if one was created prior to this step.
- Contact Supabase support if PITR is not available or if assistance is needed.

---

#### Post-Step Verification Checklist

- [x] Verified canonical tenant_id: `6749bded-94d6-4793-9f46-09724da30ab6`
- [x] Updated invite_links: 8 rows
- [x] Updated system_logs: 10 rows
- [x] Updated subscription_tiers: 1 row
- [x] Post-check NULL counts: invite_links=0, logs=0, tiers=0
- [x] No changes to payments or admin_settings tables

---

#### Result / Notes

Successfully backfilled tenant_id for all rows that had NULL values:
- **tenant_id_used:** `6749bded-94d6-4793-9f46-09724da30ab6`
- **updated_invite_links:** 8
- **updated_system_logs:** 10
- **updated_subscription_tiers:** 1
- **post-check null counts:** invite_links=0, logs=0, tiers=0

All data now properly tagged with tenant_id for RLS policy compliance.

---

### Step 2.1 — Frontend tenant context (useAuth)

**Date/Time:** 2026-02-04 (UTC)

**Goal:** Add tenant context (tenantId, tenantSlug, tenantLoading) to AuthContext so frontend components can access the current admin's tenant information without additional queries.

**Risk Level:** Low (additive change only, no existing logic modified)

---

#### Code Changes

| File | Description |
|------|-------------|
| `src/hooks/useAuth.tsx` | Added tenantId, tenantSlug, tenantLoading to AuthContextType; added loadTenantContext() function; integrated into getSession() and onAuthStateChange flows; reset on logout |

---

#### Supabase SQL Changes

```sql
-- N/A — no database changes
```

**Executed in:** N/A

---

#### Rollback Plan

**Lovable Rollback:**
- [ ] Revert `src/hooks/useAuth.tsx` to previous version (remove tenantId, tenantSlug, tenantLoading state and loadTenantContext function)

**Supabase Rollback SQL:**
```sql
-- N/A — no database changes to rollback
```

---

#### Post-Step Verification Checklist

- [ ] Login as admin A → check browser console for `Tenant context loaded` debug message with tenantSlug
- [ ] Login as admin B → check browser console for `Tenant context loaded` debug message with tenantSlug
- [ ] Existing admin pages (Dashboard, Subscribers, Tiers, Payments, Settings, Logs) still load correctly
- [ ] Logout → tenantId/tenantSlug reset (no errors in console)
- [ ] No changes to subscription/payment/notification functionality

---

#### Result / Notes

[Pending verification]

---

### Step 2.2A — Tenant-aware Admin Settings

**Date/Time:** 2026-02-04 (UTC)

**Goal:** Update AdminSettings.tsx to load/save settings per-tenant using tenantId from useAuth, instead of the global `.limit(1)` pattern.

**Risk Level:** Low/Medium (affects settings queries but maintains same behavior for existing single-tenant usage)

---

#### Code Changes

| File | Description |
|------|-------------|
| `src/pages/admin/AdminSettings.tsx` | Import useAuth; read tenantId/tenantLoading; loadSettings now filters by `.eq('tenant_id', tenantId)` instead of `.order().limit(1)`; handleSave checks for existing settings by tenant_id and includes tenant_id when inserting new row |

---

#### Supabase SQL Changes

```sql
-- N/A — no database changes
```

**Executed in:** N/A

---

#### Rollback Plan

**Lovable Rollback:**
- [ ] Revert `src/pages/admin/AdminSettings.tsx` to previous version (restore `.order('created_at', ...).limit(1)` pattern)

**Supabase Rollback SQL:**
```sql
-- N/A — no database changes to rollback
```

---

#### Post-Step Verification Checklist

- [ ] Login as main admin → Settings page loads correctly with existing values
- [ ] Save settings → success toast, settings persist on page reload
- [ ] Console shows no errors related to tenant_id
- [ ] (Optional) Login as second admin → saving creates a separate settings row for that tenant
- [ ] No changes to subscription/payment/notification functionality

---

#### Result / Notes

[Pending verification]

---

### Step 2.2B — Tenant-aware Tiers (frontend)

**Date/Time:** 2026-02-04 (UTC)

**Goal:** Make Subscription Tiers fully tenant-aware for authenticated admins in the frontend, so a second admin cannot see/edit/delete another admin's tiers.

**Risk Level:** Low/Medium (affects tier queries/mutations but maintains same behavior for mini-app)

---

#### Code Changes

| File | Description |
|------|-------------|
| `src/hooks/useSubscriptionTiers.tsx` | Import useAuth; all queries now filter by `.eq('tenant_id', tenantId)` for authenticated users; query keys include tenantId to prevent cache leakage; mutations include tenant_id on create and filter by tenant_id on update/delete; non-authenticated usage (mini-app) unchanged |
| `src/pages/admin/AdminTiers.tsx` | Import useAuth; show loading UI while tenantLoading is true to prevent brief display of global tiers |

---

#### Supabase SQL Changes

```sql
-- N/A — no database changes
```

**Executed in:** N/A

---

#### Rollback Plan

**Lovable Rollback:**
- [ ] Revert `src/hooks/useSubscriptionTiers.tsx` to previous version (remove tenant filtering and tenantId from query keys)
- [ ] Revert `src/pages/admin/AdminTiers.tsx` to previous version (remove tenantLoading check)

**Supabase Rollback SQL:**
```sql
-- N/A — no database changes to rollback
```

---

#### Post-Step Verification Checklist

- [ ] Login as admin A → sees only A's tiers
- [ ] Login as admin B → sees only B's tiers (likely empty if new tenant)
- [ ] Create a tier as admin B → admin A does not see it (logout/login to verify)
- [ ] Edit tier as admin B → works only for B's tiers
- [ ] Delete tier as admin B → works only for B's tiers
- [ ] Mini-app still loads and shows tiers as before (no changes expected yet)
- [ ] No changes to subscription/payment/notification functionality

---

#### Result / Notes

[Pending verification]

---

### Step 2.2B.2 — Hotfix: lock MiniApp tiers to default tenant

**Date/Time:** 2026-02-04 (UTC)

**Goal:** Prevent MiniApp from showing tiers from other tenants by locking public/unauthenticated tier queries to the default production tenant ID. This is a TEMPORARY measure until Step 4 implements `t=tenant_slug` URL parameter for proper multi-tenant MiniApp support.

**Risk Level:** Low (additive filter only, no breaking changes)

---

#### Code Changes

| File | Description |
|------|-------------|
| `src/hooks/useSubscriptionTiers.tsx` | Added DEFAULT_PUBLIC_TENANT_ID constant; useSubscriptionTiers and useActiveTiers now filter by this tenant ID for public queries; query keys updated to use DEFAULT_PUBLIC_TENANT_ID instead of 'public' string |

---

#### Supabase SQL Changes

```sql
-- N/A — no database changes
```

**Executed in:** N/A

---

#### Rollback Plan

**Lovable Rollback:**
- [ ] Revert `src/hooks/useSubscriptionTiers.tsx` to previous version (remove DEFAULT_PUBLIC_TENANT_ID constant and public tenant filtering)

**Supabase Rollback SQL:**
```sql
-- N/A — no database changes to rollback
```

---

#### Post-Step Verification Checklist

- [ ] MiniApp still shows original tenant tiers (default production tenant)
- [ ] Admin A (default tenant) sees their tiers in admin UI
- [ ] Admin B creates a tier → it does NOT appear in MiniApp
- [ ] Admin B's tier only visible in Admin B's admin UI
- [ ] No console errors in MiniApp or admin UI

---

#### Result / Notes

[Pending verification]

---

### Step 2.2C — Tenant-aware Logs (frontend)

**Date/Time:** 2026-02-04 (UTC)

**Goal:** Make Admin Logs page tenant-aware so that each admin only sees system_logs for their own tenant, preventing cross-tenant log visibility.

**Risk Level:** Low/Medium (additive filter, no breaking changes to existing functionality)

---

#### Code Changes

| File | Description |
|------|-------------|
| `src/hooks/useSystemLogs.tsx` | Import useAuth; add tenant_id filter for authenticated users in useSystemLogs and useLogEventTypes; update query keys to include tenantId for cache isolation; add `enabled` condition to wait for tenant context |
| `src/pages/admin/AdminLogs.tsx` | Import useAuth; read tenantLoading; show loading UI while tenantLoading is true to avoid briefly showing global logs |

---

#### Supabase SQL Changes

```sql
-- N/A — no database changes
```

**Executed in:** N/A

---

#### Rollback Plan

**Lovable Rollback:**
- [ ] Revert `src/hooks/useSystemLogs.tsx` to previous version (remove useAuth import and tenant filtering)
- [ ] Revert `src/pages/admin/AdminLogs.tsx` to previous version (remove tenantLoading check)

**Supabase Rollback SQL:**
```sql
-- N/A — no database changes to rollback
```

---

#### Post-Step Verification Checklist

- [ ] Login as admin A → sees only admin A's logs
- [ ] Login as admin B → sees only admin B's logs (likely empty if new tenant)
- [ ] Log filters (event type, level, source, date range, search) still work correctly
- [ ] Email filter still works correctly
- [ ] Clicking on a log row opens the detail dialog
- [ ] Subscriber link in log detail navigates to correct subscriber
- [ ] No console errors in admin logs page
- [ ] No impact on payments/webhooks/notifications

---

#### Result / Notes

[Pending verification]

---
