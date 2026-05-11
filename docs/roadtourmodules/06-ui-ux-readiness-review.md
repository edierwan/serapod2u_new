# 06. UI/UX Readiness Review

This review focuses on the current RoadTour screens and adjacent navigation surfaces already present in the app.

Scope reviewed:
- Customer & Growth landing and Marketing navigation entry
- RoadTour landing page and internal top nav
- Campaigns
- QR Management
- Visits
- Surveys
- Analytics
- WhatsApp Monitoring
- RoadTour Settings
- Point Catalog > RoadTour Reward Settings
- Public RoadTour claim journey where relevant

## Overall UI verdict

The RoadTour UI is developed enough to look real to business users. That is both a strength and a risk.

Why it is a strength:
- the module has clear landing cards,
- multiple detailed admin views exist,
- state badges and dialogs are present,
- public scan flow is branded and integrated.

Why it is a risk:
- several screens imply end-to-end operational readiness that the backend and schema do not fully support yet,
- two separate settings surfaces suggest more control than the live campaign flow actually uses,
- analytics visuals are polished enough that users may trust numbers that are not yet reliable.

## 1. Customer & Growth landing page

Files:
- `app/src/modules/customer-growth/customerGrowthNav.ts`
- `app/src/app/customer-growth/page.tsx`
- `app/src/components/dashboard/DashboardContent.tsx`

What works well:
- RoadTour is clearly surfaced under Marketing.
- Module naming is understandable to internal operators.
- Navigation is consistent with the rest of Customer & Growth.

What is confusing:
- The menu placement suggests RoadTour is just another marketing feature, while the actual module behaves more like a hybrid of campaign ops, field ops, and public reward collection.
- The shell does not communicate that some RoadTour screens rely on stricter DB policy behavior than the route shell itself does.

Empty/loading/error states:
- Customer & Growth landing itself is a simple shell and does not expose RoadTour-specific data-state issues.

Mobile responsiveness:
- Good enough at the shell level because it is card-driven.

Backend connection quality:
- Navigation is real and wired.
- Authorization semantics are not communicated clearly at this layer.

## 2. RoadTour landing page

Files:
- `app/src/modules/roadtour/components/RoadtourLandingView.tsx`
- `app/src/modules/roadtour/components/RoadtourTopNav.tsx`
- `app/src/modules/roadtour/roadtourNav.ts`

What works well:
- Hero section quickly explains intended module purpose.
- Internal group cards mirror the top nav cleanly.
- Cards are actionable and not placeholder stubs.

What is confusing:
- The landing page message promises full field-operations capability including campaign planning, QR generation, visits, surveys, and monitoring, but some of these features are only partial or not yet production-safe.
- It does not distinguish between what is already reliable and what still needs testing.

Empty/loading/error states:
- Not applicable beyond the overall module shell.

Mobile responsiveness:
- Good. Card grid collapses naturally.

Backend connection quality:
- Navigation buttons are connected.
- This screen is a routing surface, not a data-driven operational surface.

## 3. Campaigns screen

Files:
- `app/src/modules/roadtour/components/RoadtourCampaignsView.tsx`

What works well:
- Strong table structure for an MVP: name, status, period, days, references, actions.
- Search and status filtering are present.
- Dialog flow for create/edit is already substantial.
- Region badges and reference-management dialogs help operators inspect campaign composition.

What is confusing:
- The screen allows choosing reward mode and QR mode, but not survey template, even though survey mode implies template-backed behavior.
- The screen uses the business term “references” where the landing copy says “account managers”, which may or may not be the same role operationally.
- There is no visible notion of target shop list, coverage target, campaign owner, approval state, or campaign template.

Empty/loading/error states:
- Loading spinner exists.
- Empty state for no campaigns exists.
- Error handling is toast-based only; there is no persistent inline recovery path.

Mobile responsiveness:
- Reasonable. Some columns are hidden at smaller breakpoints.
- Still table-heavy, which means campaign action density may feel compressed on mobile.

Table usability:
- Search and status filters are useful.
- No sort controls were observed.
- No export action found.
- No bulk action found.

Confirmation modals and destructive actions:
- Pause/archive/activate actions are icon-first and immediate.
- No explicit confirmation modal was observed for status changes or assignment removal side effects.

Status badges:
- Good visual status treatment for draft, active, paused, completed, archived.

Backend connection quality:
- Buttons are connected to real Supabase writes.
- Core weakness: the screen still does not configure a full campaign object suitable for first production use.

## 4. QR Management screen

Files:
- `app/src/modules/roadtour/components/RoadtourQrManagementView.tsx`

What works well:
- Practical operator actions exist: preview, copy link, download QR, send WhatsApp, revoke.
- Friendly URL support is surfaced indirectly through preview/link behavior.
- Grouping by campaign and status keeps the table readable at small dataset sizes.

What is confusing:
- Grouping can hide per-reference detail until preview opens.
- “Scans” are represented through `usage_count`, but that metric is inflated by validation calls and page loads.
- The screen suggests stronger delivery governance than actually exists because QR send logs are inserted client-side after the route returns.

Empty/loading/error states:
- Loading spinner exists.
- Empty state for no QR records exists.
- Error handling is toast-based only.

Mobile responsiveness:
- Fair. The table remains usable, but grouped rows and action icons will still be dense on mobile.

Table usability:
- Search and filters exist.
- No resend queue, batch actions, or export.
- No print pack or PDF export found.

Confirmation modals:
- No explicit revoke confirmation was observed.

Backend connection quality:
- Preview and QR image generation are real.
- WhatsApp send is real.
- Audit quality is weaker than the UI implies.

## 5. Visits screen

Files:
- `app/src/modules/roadtour/components/RoadtourVisitsView.tsx`

What works well:
- The screen is pointed at real official-visit records rather than mock placeholders.
- Detail drill-down into same-day scan events is a useful operator affordance.
- Campaign and date filter support appears present in the query layer.

What is confusing:
- The name “Visits” suggests a true field-ops check-in/check-out workflow, but the schema currently models a visit mainly as a reward-linked official visit fact.
- Operators may assume manual visit capture or route completion support that is not actually present.

Empty/loading/error states:
- Loading spinner exists.
- Errors are toast-based.
- Full empty-state review needs live testing.

Mobile responsiveness:
- Likely acceptable for summary view, but the detail workflow should be tested explicitly on mobile because this is field-ops-oriented.

Table usability:
- Campaign/date filtering exists.
- Export and bulk actions were not found.
- Search behavior needs live confirmation if business expects it heavily.

Backend connection quality:
- Real read path.
- Conceptual mismatch between “visit management” UI expectations and actual stored visit lifecycle remains a readiness concern.

## 6. Surveys screen

Files:
- `app/src/modules/roadtour/components/RoadtourSurveyBuilderView.tsx`

What works well:
- This is one of the stronger admin UIs in the module.
- Template list, field editor, reorder controls, and phone preview are thoughtful.
- Linked shop-field insertion is especially useful for reducing repetitive survey setup.

What is confusing:
- The UI displays template versioning expectations, but production schema does not include a `version` column on `roadtour_survey_templates`.
- There is no explicit publish or freeze concept, even though surveys are operationally sensitive.
- There is no campaign-assignment step from within the survey builder itself.

Empty/loading/error states:
- Loading and empty states exist.
- Error handling is toast-based.

Mobile responsiveness:
- Editor-plus-preview layout is desktop-friendly.
- Needs real mobile testing because field management will be cramped on small screens.

Table usability:
- More card/editor oriented than table oriented.
- No import/export found.

Backend connection quality:
- Builder is connected to live tables.
- End-to-end survey claim flow is still suspect because the live claim API payload does not match the production survey-response schema.

## 7. Analytics screen

Files:
- `app/src/modules/roadtour/components/RoadtourAnalyticsView.tsx`

What works well:
- KPI cards and ranking sections are visually credible.
- Operators can quickly understand the intended metrics: campaigns, managers, QR codes, visits, points, scans, surveys, top managers, top campaigns, recent scans.

What is confusing:
- The presentation looks trustworthy, but the underlying calculations are not yet trustworthy enough.
- `totalScans` uses the size of a limited 100-row dataset, not an exact count.
- `topCampaigns.scan_count` is derived from visits rather than real scan totals.
- Date filter state exists in the component but is not applied to the analytics query logic.

Empty/loading/error states:
- Loading spinner exists.
- No export-ready empty/report state was found.

Mobile responsiveness:
- KPI cards should degrade reasonably.
- Deeper ranked lists and recent-scan tables need testing on smaller screens.

Reporting and export readiness:
- No CSV/PDF export found.
- No print/export workflow found.

Backend connection quality:
- Real data is queried.
- The numbers are not yet reliable enough for real campaign decision-making.

## 8. WhatsApp Monitoring screen

Files:
- `app/src/modules/roadtour/components/RoadtourWhatsAppMonitoringView.tsx`

What works well:
- Good simple monitoring frame for QR delivery logs.
- KPI cards for sent, delivered, failed, pending are easy to read.
- Campaign filter is useful.

What is confusing:
- The screen title suggests RoadTour-wide WhatsApp monitoring, but it only covers `roadtour_qr_delivery_logs`.
- Claim-alert logs in `roadtour_claim_notification_logs` are not shown here.
- Operators may assume all RoadTour WhatsApp sends are covered when they are not.

Empty/loading/error states:
- Loading spinner exists.
- Empty state exists.
- Error handling is toast-based.

Mobile responsiveness:
- KPI cards are fine.
- The delivery activity table needs explicit mobile testing.

Export/reporting readiness:
- No export, resend, reconcile, or provider-debug view found.

Backend connection quality:
- Real data path exists.
- Monitoring scope is narrower than the label implies.

## 9. RoadTour Settings screen

Files:
- `app/src/modules/roadtour/components/RoadtourSettingsView.tsx`

What works well:
- The settings UI is organized and reads like a real ops console.
- QR mode, duplicate rule, login/shop/geolocation requirements, WhatsApp enablement, claim-alert template editing, and test send are all exposed.
- Inline summaries help operators understand consequences.

What is confusing:
- The screen manages reward defaults and survey defaults in `roadtour_settings`, but live claim behavior reads reward mode and survey template from the campaign row, not from `roadtour_settings`.
- This makes the UI more authoritative-looking than the actual backend behavior.

Empty/loading/error states:
- Loading spinner exists.
- Errors are toast-based.

Mobile responsiveness:
- Card layout is usable, but longer template textareas need mobile validation.

Confirmation and safety:
- No review/diff step before save.
- Test-send controls are useful, but no environment banner or audit explanation was observed.

Backend connection quality:
- Screen is connected to live settings rows.
- Main issue is not broken save; it is configuration semantics that do not fully drive the live flow.

## 10. Point Catalog > RoadTour Reward Settings

Files:
- `app/src/components/engagement/catalog/PointsConfigurationSettings.tsx`
- `app/src/components/engagement/catalog/RoadtourRewardSettings.tsx`

What works well:
- Clean small settings surface for reward defaults.
- Good summary messaging around cost and reward mode.

What is confusing:
- This is a second settings surface for the same `roadtour_settings` row.
- It overlaps with `RoadtourSettingsView` but presents itself as an equally valid control plane.
- Neither surface currently guarantees that campaign rows inherit the configured values.

Backend connection quality:
- Real write path.
- High UX risk because operators can update a setting here and reasonably expect live RoadTour claims to follow it immediately, which is not how the current campaign flow is wired.

## 11. Public RoadTour claim journey

Files:
- `app/src/app/scan/page.tsx`
- `app/src/app/roadtour/[year]/[campaignSlug]/[referenceSlug]/page.tsx`
- `app/src/modules/roadtour/components/RoadtourJourneyWrapper.tsx`
- `app/src/components/journey/templates/PremiumLoyaltyTemplate.tsx`

What works well:
- Reuse of the proven product-journey surface is a sensible design decision.
- Branding and reward framing are clear.
- Friendly URLs improve field usability.

What is confusing:
- Operators may assume “survey submit” campaigns are working because the UI path exists, but the backend persistence path is not aligned with the production schema.
- Profile/shop gating is strong, but that strength is not obvious from the campaign-admin side.

Mobile responsiveness:
- This area is likely better than the admin screens because it reuses a mobile-oriented journey template.

Backend connection quality:
- Real and live.
- Still not safe enough for wide rollout because the survey branch and public hardening need more work.

## Cross-screen mismatch review

## Customer & Growth landing vs RoadTour module messaging

Mismatch:
- Customer & Growth surfaces RoadTour as one child inside Marketing.
- RoadTour landing page presents it as a deeper field-operations module.

Recommendation:
- keep the current placement if RoadTour will stay under Marketing,
- but clarify in copy that it is a field activation and campaign-ops module, not just a marketing card.

## Marketing submenu vs internal RoadTour tabs

What is consistent:
- `Road Tour` entry is wired correctly into the RoadTour shell.
- Internal groups broadly match the landing cards.

What is inconsistent:
- Settings authority is split between RoadTour and Point Catalog.
- Surveys feel like a template builder product, but campaign setup does not consume that configuration properly.

## RoadTour internal cards vs real backend maturity

Mismatch examples:
- Analytics card implies reporting maturity that the current calculations do not support.
- WhatsApp Monitoring card implies full WhatsApp observability, but claim alerts are not included.
- Field Operations label implies explicit visit workflow that is not fully modeled yet.

## UI/UX conclusion

The RoadTour UI is close to being persuasive enough for production rollout.

That is exactly why the remaining gaps matter.

Without backend and schema alignment, users will interpret the current screens as production-ready because:
- the navigation is complete,
- the screens are polished,
- and many actions are connected.

Before first real use, the biggest UI/UX priorities should be:
1. remove or reconcile duplicate settings surfaces,
2. make analytics truthfully reflect what is actually measured,
3. make survey-submit campaigns either work end-to-end or be blocked from configuration,
4. add clearer operator cues for what is live versus not fully operational yet.