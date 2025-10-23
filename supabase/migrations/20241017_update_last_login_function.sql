-- Function to update last login timestamp (bypasses RLS)
CREATE OR REPLACE FUNCTION update_last_login(user_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE users
  SET last_login_at = NOW(),
      last_login_ip = NULL
  WHERE id = user_id;
END;
$$;

-- Grant execute permission to authenticated users
GRANT EXECUTE ON FUNCTION update_last_login(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION update_last_login(uuid) TO anon;
