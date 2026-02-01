-- Enable Realtime for Support system tables
begin;
  -- Check if table is already in publication to avoid error
  do $$
  begin
    if not exists (
      select 1 from pg_publication_tables 
      where pubname = 'supabase_realtime' 
      and schemaname = 'public' 
      and tablename = 'support_messages'
    ) then
      alter publication supabase_realtime add table support_messages;
    end if;

    if not exists (
      select 1 from pg_publication_tables 
      where pubname = 'supabase_realtime' 
      and schemaname = 'public' 
      and tablename = 'support_conversations'
    ) then
      alter publication supabase_realtime add table support_conversations;
    end if;
  end;
  $$;
commit;
