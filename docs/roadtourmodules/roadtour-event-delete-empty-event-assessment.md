# RoadTour Event Delete Empty Event Assessment

Date: 2026-05-22

## Findings

- `public.roadtour_runs` is the RoadTour Event table. The schema currently exposes `id`, `org_id`, `name`, `description`, `start_date`, `end_date`, `status`, `duplicate_policy`, `created_by`, `updated_by`, `created_at`, and `updated_at`.
- `public.roadtour_runs` does not have a soft-delete column such as `deleted_at`, `is_deleted`, or `is_active`.
- `public.roadtour_campaigns.roadtour_run_id` is the child link to the selected RoadTour Event.
- The current schema defines `roadtour_campaigns_roadtour_run_id_fkey` as `FOREIGN KEY (roadtour_run_id) REFERENCES public.roadtour_runs(id) ON DELETE CASCADE`.
- Because the foreign key cascades, a raw delete on `roadtour_runs` would also delete child campaigns unless the application blocks that path first.

## Decision

- Add a server-only delete route for RoadTour Events at `DELETE /api/roadtour/events/[eventId]`.
- Enforce authenticated admin access in the route.
- Resolve the caller organization and the target event before deleting.
- Count all campaigns where `roadtour_run_id = eventId` without filtering by campaign status.
- Return `409 Cannot delete RoadTour Event with existing campaigns.` when the count is greater than zero.
- Use a hard delete only when the campaign count is zero, because the table has no soft-delete pattern to reuse.

## Notes

- No SQL migration is required for this task.
- The frontend can use the already loaded campaign list for a fast UI guard, but the API must remain the source of truth because the database foreign key is destructive.