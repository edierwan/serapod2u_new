-- Fix Support Inbox visibility issue where admins cannot see user messages
-- Issue: is_admin() function checks for wrong role_code values

-- Step 1: Update is_admin() function to check for correct role codes
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  -- Check if user has admin role in public.users table
  -- Updated to check actual role codes used in the system
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
    AND role_code IN ('SA', 'HQ', 'POWER_USER', 'HQ_ADMIN', 'admin', 'super_admin', 'hq_admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Step 2: Verify RLS policies are enabled
ALTER TABLE public.support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_thread_reads ENABLE ROW LEVEL SECURITY;

-- Step 3: Recreate policies to ensure they work with updated is_admin() function

-- Policies for support_threads
DROP POLICY IF EXISTS "Users can view own threads" ON public.support_threads;
CREATE POLICY "Users can view own threads" ON public.support_threads
    FOR SELECT USING (
        auth.uid() = created_by_user_id 
        AND user_deleted_at IS NULL
    );

DROP POLICY IF EXISTS "Users can create threads" ON public.support_threads;
CREATE POLICY "Users can create threads" ON public.support_threads
    FOR INSERT WITH CHECK (auth.uid() = created_by_user_id);

DROP POLICY IF EXISTS "Admins can view all threads" ON public.support_threads;
CREATE POLICY "Admins can view all threads" ON public.support_threads
    FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can update threads" ON public.support_threads;
CREATE POLICY "Admins can update threads" ON public.support_threads
    FOR UPDATE USING (public.is_admin());

-- Policies for support_messages
DROP POLICY IF EXISTS "Users can view messages of own threads" ON public.support_messages;
CREATE POLICY "Users can view messages of own threads" ON public.support_messages
    FOR SELECT USING (
        EXISTS (
            SELECT 1 FROM public.support_threads
            WHERE id = public.support_messages.thread_id
            AND created_by_user_id = auth.uid()
            AND user_deleted_at IS NULL
        )
    );

DROP POLICY IF EXISTS "Users can insert messages to own threads" ON public.support_messages;
CREATE POLICY "Users can insert messages to own threads" ON public.support_messages
    FOR INSERT WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.support_threads
            WHERE id = public.support_messages.thread_id
            AND created_by_user_id = auth.uid()
        )
    );

DROP POLICY IF EXISTS "Admins can view all messages" ON public.support_messages;
CREATE POLICY "Admins can view all messages" ON public.support_messages
    FOR SELECT USING (public.is_admin());

DROP POLICY IF EXISTS "Admins can insert messages" ON public.support_messages;
CREATE POLICY "Admins can insert messages" ON public.support_messages
    FOR INSERT WITH CHECK (public.is_admin());

-- Policies for support_thread_reads
DROP POLICY IF EXISTS "Users can manage own read status" ON public.support_thread_reads;
CREATE POLICY "Users can manage own read status" ON public.support_thread_reads
    FOR ALL USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Admins can manage own read status" ON public.support_thread_reads;
CREATE POLICY "Admins can manage own read status" ON public.support_thread_reads
    FOR ALL USING (public.is_admin());

-- Step 4: Verify the fix
-- Run this to test if admins can now see threads
SELECT 
    t.id,
    t.subject,
    t.status,
    t.created_by_user_id,
    u.email,
    u.full_name,
    t.last_message_at
FROM public.support_threads t
LEFT JOIN public.users u ON t.created_by_user_id = u.id
WHERE t.user_deleted_at IS NULL
ORDER BY t.last_message_at DESC
LIMIT 10;

-- Check current user's role and admin status
SELECT 
    id,
    email,
    role_code,
    public.is_admin() as is_admin_user
FROM public.users
WHERE id = auth.uid();
