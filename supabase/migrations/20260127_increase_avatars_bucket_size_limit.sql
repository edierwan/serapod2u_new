-- Increase avatars bucket file size limit to 50MB (52428800 bytes)
-- This allows larger video animations to be uploaded
update storage.buckets
set file_size_limit = 52428800
where id = 'avatars';
