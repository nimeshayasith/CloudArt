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

## API (v1, `/api/v1`)

| Method & path | Access | Purpose |
| --- | --- | --- |
| `POST /auth/register` `/confirm` `/resend-code` `/login` `/refresh` | public (rate-limited) | Cognito sign-up, email verification, tokens |
| `GET /users/me` | signed in | Current profile (role comes from PostgreSQL) |
| `PATCH /users/me` | signed in | Update `fullName`, `organization`, `professionalCategory` only; any other field is rejected (400) |
| `GET /users/me/dashboard` | signed in | Enrollment counts, own enrollments, published courses not yet enrolled |
| `GET /admin/stats` | admin | Real counts: users, new this week, organizations, courses, enrollments, recent sign-ups |
| `GET /admin/users?q=&page=&pageSize=` | admin | Searchable, paginated user list (`pageSize` ≤ 50) |
| `PATCH /admin/users/:id/status` | admin | Enable/disable a student. Admins and yourself cannot be disabled |
| `GET /courses/categories` | public | Categories with their published-course counts |
| `GET /courses?q=&category=&page=&pageSize=` | public | Catalog: `PUBLISHED` courses only (`pageSize` ≤ 50) |
| `GET /courses/:slug` | public | Syllabus: published modules and lessons only. **Video ids are never returned**; playback is served per enrollment (Phase 5) |
| `GET /admin/categories` | admin | Category list for the course form |
| `GET/POST /admin/courses`, `GET/PATCH/DELETE /admin/courses/:id` | admin | Course CRUD; list filters by `q` and `status`; new courses start as `DRAFT`; slug is generated and stays stable |
| `POST /admin/courses/:id/modules`, `PUT /admin/courses/:id/modules/order` | admin | Add a module; reorder (the id list must contain every module exactly once) |
| `PATCH/DELETE /admin/modules/:id` | admin | Edit, publish/unpublish, delete a module |
| `POST /admin/modules/:id/lessons`, `PUT /admin/modules/:id/lessons/order` | admin | Add a lesson (YouTube link or 11-character id); reorder |
| `PATCH/DELETE /admin/lessons/:id` | admin | Edit, publish/unpublish, delete a lesson |

A disabled user is locked out immediately: the next API call returns `403 ACCOUNT_DISABLED`,
and the login screen shows the message without keeping a session.

**Content rules (Phase 4)**

- A course can be `PUBLISHED` only while it has at least one published module containing a published lesson;
  a published course cannot lose its last one (`409 COURSE_NOT_READY`, change is rolled back).
- Courses with enrollments cannot be deleted (`409 COURSE_HAS_ENROLLMENTS`): archive them. Lessons and modules that
  students have watched cannot be deleted (`409 HAS_STUDENT_PROGRESS`): unpublish them.
- Bodies are strict: unknown or privileged fields (`status` on create, `createdById`, `slug`, …) are rejected with `400`.

Course progress percentages and enrollment arrive with the course player (Phase 5); until then the syllabus page says so instead of showing a fake button.

## Environments

- Local: Docker Compose PostgreSQL (`docker-compose.yml`), `backend/.env`.
- Production: AWS (RDS PostgreSQL, Cognito, S3) — see `deployment.md` (later phase).

## Roadmap

1. Repo, React, Express, PostgreSQL, Prisma — done
2. Cognito: register, verify email, login, profiles — done
3. Student/admin dashboards — done
4. Categories, courses, modules, lessons  ← **this phase**
5. Enrollment, YouTube player, resume-where-you-left-off
6. Module quizzes + question management (+ Excel import/export)
7. Final exam + locking
8. Reports and exports
9. CloudArt Labs
10. Client service requests
11. AWS production deployment
