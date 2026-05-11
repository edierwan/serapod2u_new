# 12. Final Assessment Summary

## Final judgment

Overall maturity score: 4/10

Safe-to-use judgment:
- Safe for internal assessment and controlled UAT: yes
- Safe for first real RoadTour campaign with production operators and real reporting expectations: no

Reason for the score:
- the module is real and has meaningful breadth,
- but the blockers are in the wrong places: security boundaries, survey persistence, settings truth, analytics accuracy, and production DB alignment.

## What is already good

The current RoadTour implementation already has real value in these areas:
- RoadTour has a substantial production schema, not a stub.
- Admin navigation, campaigns, QR management, surveys, visits, analytics, monitoring, and settings screens all exist and are wired.
- Public RoadTour routes, friendly URLs, QR image generation, reward claim handling, and claim-alert notifications all exist.

This is why the module feels close.
It is not missing the idea of RoadTour.
It is missing the production rigor that makes RoadTour safe to trust.

## Top 10 blockers

| Rank | Blocker | Why it blocks launch |
| --- | --- | --- |
| 1 | RoadTour admin RLS is not org-scoped | Tenant isolation is not enforced where most admin writes actually happen |
| 2 | `claim-reward` survey response insert does not match production schema | Survey-submit campaigns are not reliable |
| 3 | `claim-reward` survey response item insert uses non-existent production column mapping | Survey answers may fail to persist correctly |
| 4 | Two settings surfaces write `roadtour_settings`, but live claims depend on campaign row fields | Operators cannot trust what “saving settings” actually means |
| 5 | Analytics calculations are not trustworthy | Management will read numbers that look polished but are not accurate |
| 6 | Production `record_roadtour_reward` lags intended repo behavior | Reward and balance behavior may differ from what engineers think is deployed |
| 7 | No explicit campaign target model exists | Coverage and field execution cannot be measured properly |
| 8 | Official visit model is too thin for real field-ops reporting | Visit success, duration, and outcomes are not captured properly |
| 9 | Public claim and QR-image endpoints are not visibly rate-limited | Abuse and analytics inflation remain open concerns |
| 10 | QR delivery logging is client-side after send-route success | Operational audit quality is weaker than the UI suggests |

## Top 10 improvements

| Rank | Improvement | Why it matters most |
| --- | --- | --- |
| 1 | Rewrite RoadTour admin RLS to be org-scoped | Fixes the most serious production security defect |
| 2 | Repair survey-submit persistence end-to-end | Unlocks one of the core advertised RoadTour modes |
| 3 | Make campaign configuration self-sufficient at activation time | Prevents settings ambiguity and invalid active campaigns |
| 4 | Add explicit campaign target model | Enables coverage, planning, and denominator-based reporting |
| 5 | Add QR batch and lifecycle audit fields | Makes QR issuance governable and supportable |
| 6 | Move critical admin writes and logging server-side | Reduces overreliance on browser-side mutation patterns |
| 7 | Fix analytics queries and define exact KPI formulas | Restores trust in the reporting UI |
| 8 | Expand official visit lifecycle model | Makes RoadTour genuinely useful for field-ops measurement |
| 9 | Unify RoadTour settings into one authoritative control surface | Reduces operator confusion and misconfiguration |
| 10 | Add deployment-time schema drift verification | Prevents future mismatch between repo assumptions and live production DB |

## Suggested implementation order

Recommended order:
1. org-scoped RLS and public-route hardening
2. survey-submit flow repair and campaign validation
3. settings-source-of-truth cleanup
4. campaign target model and assignment integrity
5. QR audit and delivery-log hardening
6. analytics correctness and export baseline
7. visit lifecycle expansion
8. unified WhatsApp monitoring
9. survey versioning and governance
10. automated integration/security tests

## Questions for the product owner

These questions should be answered before implementation begins:

1. Is RoadTour supposed to target explicit shops, explicit consumers, broad regions, or some combination of all three?
2. Are “reference”, “account manager”, and “field staff” the same business role, or should the system model them separately?
3. For `survey_submit` campaigns, should survey template selection be mandatory per campaign, or should a RoadTour org default be inherited automatically at activation time?
4. Which screen should be the true settings authority: the RoadTour Settings page, the Point Catalog RoadTour settings panel, or a redesigned single page?
5. Do HQ admins need cross-org visibility intentionally, or should all RoadTour admin access be tenant-isolated by default?
6. What is the exact business definition of a successful RoadTour visit: QR opened, reward credited, survey submitted, check-in completed, or something else?
7. Which KPIs does the business actually care about for launch day: visits, unique scans, rewards, target coverage, delivery success, survey completion, or all of them?
8. Is WhatsApp distribution limited to sending QR codes to assigned account managers, or should there be bulk campaign broadcast capability later?

## Overall conclusion

RoadTour is not far from usable, but it is not yet safe to rely on.

The module already has:
- real schema depth,
- real screens,
- real QR routing,
- real reward behavior.

What it does not yet have is the production alignment required for a first serious campaign:
- secure tenant isolation,
- trustworthy survey persistence,
- trustworthy settings behavior,
- trustworthy analytics,
- and verified production DB parity.

If those launch blockers are fixed first, the rest of RoadTour can evolve from a much stronger base.
If they are not fixed first, operators are likely to trust the UI more than the underlying system currently deserves.