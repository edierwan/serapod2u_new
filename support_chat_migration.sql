-- Migration script for Support Chat System
-- Includes: support_threads, support_messages, support_thread_reads tables, RLS policies, and helper functions.

-- 1. Create Tables

-- Create support_threads table if not exists
CREATE TABLE IF NOT EXISTS public.support_threads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    created_by_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    assigned_admin_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    subject TEXT,
    status TEXT DEFAULT 'open' CHECK (status IN ('open', 'pending', 'resolved', 'closed')),
    priority TEXT DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high', 'urgent')),
    last_message_at TIMESTAMPTZ DEFAULT NOW(),
    last_message_preview TEXT,
    user_deleted_at TIMESTAMPTZ
);

-- Create support_messages table if not exists
CREATE TABLE IF NOT EXISTS public.support_messages (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    thread_id UUID REFERENCES public.support_threads(id) ON DELETE CASCADE,
    sender_type TEXT CHECK (sender_type IN ('user', 'admin', 'system')),
    sender_user_id UUID REFERENCES auth.users(id) ON DELETE SET NULL,
    body TEXT,
    attachments JSONB DEFAULT '[]'::JSONB,
    is_internal BOOLEAN DEFAULT FALSE
);

-- Create support_thread_reads table if not exists
CREATE TABLE IF NOT EXISTS public.support_thread_reads (
    id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
    thread_id UUID REFERENCES public.support_threads(id) ON DELETE CASCADE,
    user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    last_read_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE(thread_id, user_id)
);

-- 2. Helper Functions

-- Function to check if user is admin
CREATE OR REPLACE FUNCTION public.is_admin()
RETURNS BOOLEAN AS $$
BEGIN
  -- Check if user has admin role in public.users table
  -- Adjust this query based on your actual users table structure
  RETURN EXISTS (
    SELECT 1 FROM public.users
    WHERE id = auth.uid()
    AND role_code IN ('admin', 'super_admin', 'hq_admin')
  );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to send announcement blast
CREATE OR REPLACE FUNCTION public.send_announcement_blast(
    announcement_subject TEXT,
    announcement_message TEXT,
    announcement_attachments JSONB DEFAULT '[]'::JSONB
)
RETURNS VOID AS $$
DECLARE
    target_user RECORD;
    new_thread_id UUID;
BEGIN
    -- Check if caller is admin
    IF NOT public.is_admin() THEN
        RAISE EXCEPTION 'Access denied';
    END IF;

    -- Loop through all active users
    -- Adjust the WHERE clause to target specific users if needed
    FOR target_user IN 
        SELECT id FROM public.users 
        WHERE role_code = 'user' -- Assuming 'user' role exists for normal users
        -- AND status = 'active' -- Uncomment if status column exists
    LOOP
        -- Create thread
        INSERT INTO public.support_threads (
            created_by_user_id,
            subject,
            status,
            last_message_preview,
            last_message_at
        ) VALUES (
            target_user.id,
            announcement_subject,
            'open',
            substring(announcement_message from 1 for 50),
            NOW()
        ) RETURNING id INTO new_thread_id;

        -- Create message
        INSERT INTO public.support_messages (
            thread_id,
            sender_type,
            sender_user_id,
            body,
            attachments
        ) VALUES (
            new_thread_id,
            'admin',
            auth.uid(),
            announcement_message,
            announcement_attachments
        );
    END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. RLS Policies

-- Enable RLS
ALTER TABLE public.support_threads ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.support_thread_reads ENABLE ROW LEVEL SECURITY;

-- Policies for support_threads

DROP POLICY IF EXISTS "Users can view own threads" ON public.support_threads;
CREATE POLICY "Users can view own threads" ON public.support_threads
    FOR SELECT USING (auth.uid() = created_by_user_id);

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
    FOR ALL USING (public.is_admin()); -- Or just user_id = auth.uid() covers admins too if they are users

