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
```sql
-- ONLY use immediately if needed — sets tenant_id back to NULL for affected rows
UPDATE invite_links 
SET tenant_id = NULL 
WHERE tenant_id = '6749bded-94d6-4793-9f46-09724da30ab6';

UPDATE system_logs 
SET tenant_id = NULL 
WHERE tenant_id = '6749bded-94d6-4793-9f46-09724da30ab6';

UPDATE subscription_tiers 
SET tenant_id = NULL 
WHERE tenant_id = '6749bded-94d6-4793-9f46-09724da30ab6';
```

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
