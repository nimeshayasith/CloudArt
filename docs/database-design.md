# CloudArt — Database Design (PostgreSQL · Prisma)

Source of truth: [`backend/prisma/schema.prisma`](../backend/prisma/schema.prisma).
Database: `cloudart_db`. Migrations live in `backend/prisma/migrations/`.

## Modules and tables

| Module | Tables |
| --- | --- |
| Identity | `organizations`, `users` |
| Learning | `course_categories`, `courses`, `course_modules`, `lessons`, `lesson_resources` |
| Progress | `enrollments`, `lesson_progress` |
| Assessments | `exam_policies`, `quizzes`, `questions`, `question_options`, `quiz_attempts`, `attempt_questions`, `attempt_answers` |
| Labs | `labs`, `lab_steps`, `lab_resources`, `lab_enrollments`, `lab_step_progress` |
| Services | `service_categories`, `service_requests`, `service_request_attachments`, `service_proposals`, `service_projects`, `project_milestones` |

## Changes from the original design draft

- **Enums instead of free-text VARCHAR** for roles, statuses, difficulty, quiz/question types.
- **`lesson_resources.content`** holds admin-written notes (Udemy-style); PDFs use an S3 key; links use `external_url`.
- **`exam_policies`** (one per course): watch threshold %, require all lessons, require module quizzes — the admin-configurable exam lock.
- **`attempt_questions`** snapshots the questions of each attempt (e.g. 65 drawn from the bank) so bank edits never alter a past/in-flight exam.
- **`quizzes.total_questions`** = questions drawn per attempt; the bank may be larger. `quizzes.shuffle_questions`, `quiz_attempts.expires_at` support timed exams.
- **`lesson_progress.max_position_seconds`** (furthest point reached) is used with the policy threshold to decide completion server-side; `last_position_seconds` powers "resume where you left off".
- **Lab resources** use `resource_type` `THEORY_VIDEO` / `HANDS_ON_VIDEO` to model "hands-on video + theory videos" for each lab.

## Integrity rules

- UUID primary keys (`gen_random_uuid()`).
- Unique: `users.cognito_sub/email/username`, `courses.slug`, `labs.slug`, `(user, course)` enrollment, `(user, lab)`, `(enrollment, lesson)`, `(lab_enrollment, step)`, `(quiz, enrollment, attempt_number)`, `(attempt, question)`.
- Emails and usernames are **lower-cased by the API** before write, giving case-insensitive uniqueness without extensions.
- History is protected: enrollments, attempts, service data use `ON DELETE RESTRICT`; content children (modules, lessons, options…) use `CASCADE`. Prefer `status = ARCHIVED` over deleting anything that has learners.
- Exam submission and enrollment creation run in a transaction.
- `question_options.is_correct` must never be returned to students before submission.

## Local database

```bash
docker compose up -d                 # PostgreSQL 16 on localhost:5433
cd backend && cp .env.example .env
npx prisma migrate dev               # apply migrations
npm run db:seed                      # categories (+ admin if ADMIN_EMAIL is set)
npm test
```

Port **5433** is used because 5432 is commonly taken by a native PostgreSQL install.
