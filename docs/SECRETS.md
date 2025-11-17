Secrets management
==================

This document outlines how to manage secrets for the Ozols Club Achievements project across local development and production.

Environment variables
---------------------

The application reads configuration from environment variables. At minimum:

- MONGO_URI: MongoDB connection string.
- RATE_LIMIT_PER_MIN: Requests per minute per IP for the API (default 60).
- SLOW_QUERY_MS: Threshold in milliseconds to log an operation as slow (default 300ms).

Local development
-----------------

Create a file named .env.local in the project root. This file is not committed to git.

Example .env.local:

  MONGO_URI="mongodb://localhost:27017/ozolsclub"
  RATE_LIMIT_PER_MIN=120
  SLOW_QUERY_MS=250

Production secrets
------------------

- Store secrets in your platform’s secret manager or environment configuration (e.g., Vercel/Netlify project env vars, Docker/Kubernetes secrets, or cloud secret managers like AWS Secrets Manager, GCP Secret Manager, Azure Key Vault).
- Never commit secrets to the repository.
- Rotate credentials regularly and on suspected compromise.
- Use separate MongoDB users and databases per environment (dev/staging/prod) with least‑privilege access.

Rotation playbook
-----------------

1. Provision a new credential (e.g., new MongoDB user/password) and update the secret in your secret manager.
2. Redeploy the application with the updated environment variable.
3. Validate application connectivity and functionality.
4. Revoke the old credential.

Operational tips
----------------

- Prefer short‑lived credentials or access tokens where possible.
- Scope credentials to IP ranges or VPCs when supported.
- Monitor for connection/authentication failures; structured logs include request IDs for easier tracing.
