# Staging Handoff: RoadTour Shop Fallback

Date: 2026-05-23
Branch: integration/local-valid-app-20260523

Scope:
- public Create Account fallback when shop master data has no match
- existing shop selection remains authoritative
- missing shops are prepared, duplicate-checked, and only created after registration WhatsApp OTP verification
- no SQL migration and no schema change

Included changes:
- signup shop validation accepts a verified pending shop draft without allowing typed-only free text
- signup picker now shows a `Create New Shop` CTA on empty results
- create-shop dialog now supports a prepare-only registration mode
- registration OTP request/resend now carries pending shop drafts in verification metadata
- final registration creates the pending shop only after OTP verification, then links it to the new user
- public shop location and prepare-registration routes added for the signup flow
- RoadTour module note updated with the fallback design and constraints

Validation completed:
- editor diagnostics: clean on all touched files in the integration worktree
- focused tests passed in the integration worktree:
  - `src/lib/engagement/registration-link-selection.test.ts`
  - `src/components/ui/shop-picker.test.tsx`
  - result: 13 tests passed
- `npm run build` attempted twice in the integration worktree, including after clearing `.next`

Build result:
- build did not complete
- persistent error: Turbopack asset collision in `[root-of-the-server]__07s6~78._.js`
- this was not accompanied by a direct type or route error in the touched files

Remaining staging risk:
- full production build remains blocked by the Turbopack output-path collision above
- targeted functional smoke test is still recommended on staging for:
  - existing shop signup
  - `Create New Shop` signup path
  - profile-edit `Create Shop` reuse path
