# CloudArt — Architecture v1.0

CloudArt is a free cloud-learning platform (AWS first, then Azure/DevOps) plus a
deployment-services business, delivered as **one web app, one API, one database**.

## Decisions

| Area | Decision |
| --- | --- |
| Frontend | React + Vite (mobile-first, Tailwind) |
| Backend | Node.js + Express, modular monolith |
| Database | PostgreSQL (`cloudart_db`) via Prisma |
| Authentication | Amazon Cognito User Pools (email verification, JWT) |
| Authorization | Backend + PostgreSQL (`users.system_role`), never trusted from the browser |
| Video | YouTube (we store video IDs and progress only) |
| Files | Amazon S3 (notes, attachments, exports) |
| Hosting | AWS (Amplify for the frontend today) |
| Out of scope for v1 | payments, multiple admins/instructors, microservices, auto-provisioning for clients, live video |

## Why PostgreSQL

The data is strongly relational (user → enrollment → course → module → lesson →
progress; quiz → question → option → attempt → answer) and needs unique
constraints (one enrollment per user/course), transactions (exam submission),
JSONB (selected options) and aggregate reporting (admin dashboard, Excel
exports). MongoDB would force us to rebuild these guarantees by hand.

## Backend modules (`backend/src/modules`)

`auth`, `users`, `organizations`, `courses`, `lessons`, `enrollments`,
`progress`, `quizzes`, `examinations`, `labs`, `services`, `reports`.
Each module: `routes → controller → service → repository (+ validation, tests)`.
Modules share the database but not business logic.

## Key rules

1. **Registration is public but never grants ADMIN.** The single admin is
   provisioned by `prisma/seed.js` from `ADMIN_EMAIL` / `ADMIN_COGNITO_SUB`.
2. **Exam locking is server-side.** Eligibility = all mandatory lessons
   complete + required module quizzes passed (per-course `exam_policies`).
3. **Correct answers never leave the server** before submission.
4. **Exam attempts snapshot their questions** (`attempt_questions`) so later
   question-bank edits do not change an in-flight or past attempt.
5. **Video completion** uses a configurable watch threshold, validated by the
   API. We record progress; we do not claim perfect watch verification.
6. **Archive, don't delete** content that has enrollments or history.
7. **Transactions** for exam submission and enrollment creation.

## Environments

- Local: Docker Compose PostgreSQL (`docker-compose.yml`), `backend/.env`.
- Production: AWS (RDS PostgreSQL, Cognito, S3) — see `deployment.md` (later phase).

## Roadmap

1. Repo, React, Express, PostgreSQL, Prisma  ← **this phase**
2. Cognito: register, verify email, login, profiles
3. Student/admin dashboards
4. Categories, courses, modules, lessons
5. Enrollment, YouTube player, resume-where-you-left-off
6. Module quizzes + question management (+ Excel import/export)
7. Final exam + locking
8. Reports and exports
9. CloudArt Labs
10. Client service requests
11. AWS production deployment
