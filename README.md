# serapod2u_new
QR Management System

## Branch Flow

This project uses a 3-branch Git flow for streamlined development and deployment:

- **main**: Production branch. Release-only. Deploys to production environment.
- **staging**: Pre-production (UAT) branch. Seeded from main. Deploys to staging environment.
- **develop**: Daily work branch. Feature PRs merge here. Deploys to development environment.

### Workflow

1. **Feature Development**:
   - Create feature branches from `develop`.
   - Develop and test locally.
   - Submit PR to `develop`.

2. **Promote to UAT**:
   - Submit PR from `develop` to `staging` for UAT testing.

3. **Release to Production**:
   - Submit PR from `staging` to `main`.
   - On merge, auto-tag version and deploy to production.

### Branch Protections

- **main**: Requires PR, 1-2 reviews, squash merges, CI green, no direct pushes, up-to-date.
- **staging**: Requires PR, CI green; merges only from `develop`.
- **develop**: Allows PRs from feature branches; CI required.

### Environments

- Development: `.env.development`
- Staging: `.env.staging`
- Production: `.env.production`

Ensure Supabase keys and other secrets are set in GitHub Secrets and mapped per environment. Do not commit secrets.
