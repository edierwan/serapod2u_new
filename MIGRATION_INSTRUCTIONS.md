# Migration Instructions

## Task 1: ✅ Completed
Customer information (notes with address) has been removed from order cards. The cards now show only:
- Order number, type, and status
- Customer and Seller organization names
- Items, Units, and Amount statistics
- Created date
- Created by (user)
- Approved by (user) - for approved orders only

## Task 2: Database Migration Required

### What was added:
A comprehensive database migration file that includes:
- All 16 Malaysian states (13 states + 3 federal territories)
- 160+ districts properly categorized by state

### States included:
1. Johor
2. Kedah
3. Kelantan
4. Kuala Lumpur (Federal Territory)
5. Labuan (Federal Territory)
6. Melaka
7. Negeri Sembilan
8. Pahang
9. Penang
10. Perak
11. Perlis
12. Putrajaya (Federal Territory)
13. Sabah
14. Selangor
15. Sarawak
16. Terengganu

### How to apply the migration:

**Option 1: Using Supabase CLI (Recommended)**
```bash
cd /Users/macbook/serapod2u_new
supabase db push
```

**Option 2: Using Supabase Dashboard**
1. Go to your Supabase project dashboard
2. Navigate to SQL Editor
3. Open the file: `supabase/migrations/030_add_all_malaysian_states_and_districts.sql`
4. Copy the entire SQL content
5. Paste it into the SQL Editor
6. Click "Run" to execute the migration

**Option 3: Direct SQL execution**
```bash
psql -h your-db-host -U postgres -d your-database -f supabase/migrations/030_add_all_malaysian_states_and_districts.sql
```

### After migration:
The "Add New Organization" form will now show all Malaysian states and their respective districts in the dropdown menus instead of just Johor, Kuala Lumpur, and Selangor.

### Note:
The migration uses `ON CONFLICT DO NOTHING` for districts and `ON CONFLICT DO UPDATE` for states, so it's safe to run multiple times without creating duplicates.
