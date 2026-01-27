-- Update avatars bucket to allow video files for product animations
-- Setting allowed_mime_types to null allows all file types
update storage.buckets
set allowed_mime_types = null
where id = 'avatars';
