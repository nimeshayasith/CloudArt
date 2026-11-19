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
| `GET /courses/:slug/enrollment` | signed in | `{ enrolled, status }` for the caller |
| `POST /courses/:slug/enroll` | signed in | Join a `PUBLISHED` course. Idempotent; re-joining after leaving restores the old progress |
| `DELETE /courses/:slug/enroll` | signed in | Leave a course (`DROPPED`); progress is kept |
| `GET /learn/:slug` | enrolled | Course outline for the player: published content, per-lesson progress, overall progress, resume point. **No video ids** |
| `GET /learn/lessons/:lessonId` | enrolled, or any signed-in user for free-preview lessons | One lesson's `youtubeVideoId` and `startSeconds`. Video ids are released one lesson at a time |
| `PUT /learn/lessons/:lessonId/progress` | enrolled | Save `{ positionSeconds, durationSeconds? }`; returns the lesson's state and course progress (60 requests/min per user) |
| `GET /admin/courses/:id/quizzes` | admin | Quizzes of a course with active-question and attempt counts |
| `POST /admin/modules/:id/quiz` | admin | Create the module's quiz (one per module, starts as `DRAFT`) |
| `GET/PATCH/DELETE /admin/quizzes/:id` | admin | Quiz with its questions and **answer key**; settings and status; delete only if never attempted |
| `GET /admin/quizzes/:id/attempts?page=&pageSize=` | admin | Students' attempts with scores (`pageSize` ≤ 50) |
| `POST /admin/quizzes/:id/questions`, `PUT /admin/quizzes/:id/questions/order` | admin | Add a question with its options in one request; reorder |
| `PATCH/DELETE /admin/questions/:id` | admin | Edit (options are replaced as a set), activate/deactivate, delete |
| `GET /learn/quizzes/:quizId` | enrolled | Rules, attempts used/left, best score, history, open attempt |
| `POST /learn/quizzes/:quizId/attempts` | enrolled | Start an attempt (201) or resume the open one (200) |
| `GET /learn/attempts/:attemptId` | owner | The attempt: questions without the key while open; with key and explanations once finished |
| `PUT /learn/attempts/:attemptId/answers` | owner | Autosave answers (120 requests/min per user) |
| `POST /learn/attempts/:attemptId/submit` | owner | Submit (optionally with the final answers); idempotent |
| `POST /admin/courses/:id/final-exam` | admin | Create the course's final exam (one per course; defaults 65 questions, 90 min, 3 attempts, 70 %) |
| `GET /admin/exports/users.xlsx` | admin | Excel: every user (no Cognito ids), role, status, courses enrolled |
| `GET /admin/exports/courses/:id/progress.xlsx` | admin | Excel: every enrollee with lessons done, progress %, last activity and best quiz/exam scores |
| `GET /admin/exports/quizzes/:id/results.xlsx` | admin | Excel: every attempt with score, percentage and result |
| `GET /admin/quizzes/:id/questions/export.xlsx` | admin | Excel: the question bank in the importable layout (includes the answer key) |
| `GET /admin/question-template.xlsx` | admin | Excel: blank template with three worked examples and instructions |
| `POST /admin/quizzes/:id/questions/import` | admin | Add questions from an uploaded `.xlsx` (raw request body, max 2 MB / 500 rows). All or nothing |
| `GET/POST /admin/labs`, `GET/PATCH/DELETE /admin/labs/:id` | admin | Lab CRUD (list filters `q`, `status`); new labs start as `DRAFT`; delete only if nobody joined |
| `POST /admin/labs/:id/steps`, `PUT /admin/labs/:id/steps/order` | admin | Add a step (title, instructions, required/optional); reorder |
| `PATCH/DELETE /admin/lab-steps/:id` | admin | Edit or delete a step (delete refused once a student ticked it) |
| `POST /admin/labs/:id/resources`, `PATCH/DELETE /admin/lab-resources/:id` | admin | Videos (YouTube) and links for the whole lab or one step |
| `GET /admin/exports/labs/:id/progress.xlsx` | admin | Excel: every student's steps, status and completion date |
| `GET /labs`, `GET /labs/:slug` | public | Catalog (`PUBLISHED` only) and overview: step titles and counts, never instructions, videos or links |
| `GET /labs/:slug/enrollment`, `POST/DELETE /labs/:slug/enroll` | signed in | Join (idempotent) and leave a lab; ticked steps are kept |
| `GET /labs/:slug/work` | joined | The workspace: instructions, videos, links and the student's ticks |
| `PUT /labs/steps/:stepId/progress` | joined | Tick or untick a step (`{ completed }`); returns progress and the lab's status |
| `GET /plans` | public | Active subscription plans (name, price, currency, length) |
| `GET /payment-info` | signed in | The bank details students pay into (admin-editable) |
| `POST /subscriptions/quote` | signed in | Price for a plan with an optional voucher; creates nothing (30 tries / 10 min per user) |
| `POST /subscriptions` | signed in | Subscribe. A free price activates at once; otherwise it is `PENDING` until a screenshot is approved. One unpaid request at a time |
| `GET /subscriptions/me` | signed in | Current access, the pending request with its screenshots, queued plans and history |
| `POST /subscriptions/:id/cancel` | owner | Cancel a request that is waiting for payment (gives a voucher use back) |
| `POST /subscriptions/:id/payment-proof?reference=` | owner | Upload a JPEG/PNG/WebP screenshot as the raw body (max 5 MB) |
| `GET/POST/PATCH/DELETE /admin/plans` | admin | Manage plans; plans students bought are deactivated, not deleted |
| `GET/POST/PATCH/DELETE /admin/vouchers` | admin | Manage percentage vouchers (see rules below) |
| `GET/PUT /admin/settings/payment` | admin | Bank name, account holder, number, branch and instructions |
| `GET /admin/subscriptions?status=&q=` | admin | Payment queue: `PENDING`, `ACTIVE`, `UPCOMING`, `EXPIRED`, `CANCELLED` |
| `POST /admin/subscriptions/:id/approve`, `/reject`, `/revoke` | admin | Approve a screenshot (starts the plan), reject with a reason, or end an active plan |
| `GET /admin/payment-proofs/:id/file` | admin | The screenshot image (never public, never cached) |
| `GET /admin/exports/subscriptions.xlsx` | admin | Excel: every subscription with price, discount, voucher and dates |
| `GET/PUT /admin/courses/:id/exam-policy` | admin | Unlock rules: `requireAllLessons`, `requireModuleQuizzes`, `lessonWatchThresholdPct` (defaults apply when no row exists) |

A disabled user is locked out immediately: the next API call returns `403 ACCOUNT_DISABLED`,
and the login screen shows the message without keeping a session.

**Content rules (Phase 4)**

- A course can be `PUBLISHED` only while it has at least one published module containing a published lesson;
  a published course cannot lose its last one (`409 COURSE_NOT_READY`, change is rolled back).
- Courses with enrollments cannot be deleted (`409 COURSE_HAS_ENROLLMENTS`): archive them. Lessons and modules that
  students have watched cannot be deleted (`409 HAS_STUDENT_PROGRESS`): unpublish them.
- Bodies are strict: unknown or privileged fields (`status` on create, `createdById`, `slug`, …) are rejected with `400`.

**Learning rules (Phase 5)**

- Learning needs an `ACTIVE`/`COMPLETED` enrollment. Courses an admin has archived stay open to students who were already
  enrolled; draft (unpublished) courses are closed. New enrollments need a `PUBLISHED` course.
- `lastPositionSeconds` is the resume point and can move backwards. `maxPositionSeconds` is the furthest point reached and
  can advance only as fast as real time allows (2x speed plus 30 s slack since the previous save), so a forged request
  cannot complete a lesson. This records progress; it does not claim to prove the video was watched.
- A lesson completes when its furthest point reaches the course's watch threshold (`exam_policies.lesson_watch_threshold_pct`,
  default 90 %). The lesson length is the admin's value, or the player-reported one when the admin left it at 0. A completed
  lesson never un-completes, and re-opens from the start.
- "Continue learning" opens the lesson watched last at its saved position, or the next unfinished lesson if that one is complete.
- Percentages count only lessons that are still published, so unpublishing never pushes progress past 100 %.
- The player uses YouTube's IFrame API through `youtube-nocookie.com`. Browser tests substitute a fake of that API;
  the real one was checked separately (ready, start position, duration, play/pause, destroy).
- Free-preview lessons can be opened by any signed-in user through the API, but there is no UI for it yet.
- Enrollment status stays `ACTIVE`: `COMPLETED` is reserved for passing the final exam (Phase 7).

**Quiz rules (Phase 6)**

- One quiz per module. A quiz can be `PUBLISHED` only with at least one active question and no more questions per attempt
  than active questions (`409 QUIZ_NOT_READY`); a live quiz cannot be edited into an invalid state or lose its last active question.
- Question types: `SINGLE_CHOICE` (exactly one correct), `TRUE_FALSE` (two options, one correct), `MULTIPLE_SELECT`
  (at least one correct). Multi-select is **all-or-nothing**: the selection must equal the correct set exactly.
- An attempt **snapshots** its questions (`attempt_questions`) when it starts. Questions students have already received
  cannot be reworded, re-optioned, re-marked or deleted (`409 QUESTION_IN_USE`); only the explanation and the active flag
  can change. Deactivate and add a corrected question instead.
- The answer key (`isCorrect`) and explanations are never sent while an attempt is open; they come back with the review.
- Marks are weighed per question; `percentage >= pass mark` passes (inclusive). Unanswered questions score 0.
- Time limit: the server stamps `expires_at`. Saves or a submit arriving up to 5 s late are honoured; after that the
  attempt is graded as it stands (`EXPIRED`), and further saves return `409 ATTEMPT_EXPIRED`. An expired attempt counts as used.
- Only one attempt is open at a time (starting again resumes it). `max_attempts` counts finished attempts.
- Submitting twice returns the same result and never regrades. Concurrent starts and submits are race-safe.
- Quizzes (and modules) with attempts are never deleted: archive or unpublish them.

**Final exam rules (Phase 7)**

- The final exam is a `FINAL_EXAM` quiz with no module, one per course, managed with the same question API as module
  quizzes. The question bank may be larger than one attempt (e.g. 70 questions, 65 drawn at random per attempt). New exam
  questions default to multiple select in the admin UI; every question type is still allowed.
- **Locked until the unlock rules are met.** `exam_policies` per course: every published lesson complete (using the
  course's watch threshold) and every published module quiz passed. Unmet rules come back as a checklist
  (`403 EXAM_LOCKED` with `details.requirements`; the outline carries the same list). Only currently published content is
  counted, so unpublishing something never locks a student out. An attempt already in progress can always be resumed.
- **The answer key is never shown for the exam**, not even after submitting: the review has the student's selections and
  per-question correct/incorrect only (no options marked correct, no explanations). This protects the question bank.
- **Passing the exam completes the course**: the enrollment moves from `ACTIVE` to `COMPLETED` in the same step that
  grades the attempt. Completed students keep access to the course and may use any remaining attempts.
- Time limit, attempt limit, expiry, snapshotting and locking of used questions work exactly as for module quizzes.
- There is no certificate yet.

**Lab rules (Phase 9)**

- A lab has ordered steps (instructions as plain text; a fenced block between `` ``` `` lines is shown as a code block with a
  copy button, and everything is rendered as text, never as HTML) and resources attached to the lab or to one step.
- **Resources:** `THEORY_VIDEO` / `HANDS_ON_VIDEO` hold a YouTube video id (links in any common form are accepted);
  `DIAGRAM`, `PDF`, `LINK`, `OTHER` hold an external URL. Only `http(s)` URLs without credentials are accepted
  (`javascript:`, `data:`, `file:` and the like are refused), and links open in a new tab with `noopener`. `DIAGRAM` and
  `PDF` are links until S3 uploads exist; `NOTE` is not offered because instructions live on steps.
- **Publish rule:** a lab can be `PUBLISHED` only with at least one step, and a published lab cannot lose its last step.
  Labs students joined are archived, never deleted; steps students ticked cannot be deleted (edit them or make them optional).
- **Privacy:** the public overview lists step titles and counts only. Instructions, video ids and links are returned only
  to students who joined (`403 NOT_ENROLLED` otherwise). Archived labs stay open to students who already joined; drafts are closed.
- **Completion:** a lab is `COMPLETED` when every *required* step is ticked (or every step, if none is required). The status
  follows the ticks both ways: unticking a required step reopens it, and the first completion date is kept while it stays complete.
  Progress counts only steps that currently exist, so adding or removing steps never pushes it past 100 %.
- Labs have no quizzes or exams. Dashboard and exports reuse the same progress numbers.

**Subscriptions, vouchers and payments (Phase 10)**

- **What is Premium:** an admin marks courses (`is_free = false`), lessons, quizzes, the final exam and labs as Premium; anything
  not marked stays free. A non-free course makes all its lessons, quizzes and exam Premium, except lessons flagged *free preview*.
  Any **active subscription unlocks all Premium content**. Administrators are never locked out.
- **Enforcement is on the server**, in one place (`subscriptions/access.service.js`): a locked lesson answers
  `403 PREMIUM_REQUIRED` and **never includes its video id**; progress cannot be saved on it; a locked quiz or exam cannot be
  started or resumed; a premium lab cannot be joined, opened or ticked. Public syllabus and catalog pages only show lock flags.
  Access is by date: a subscription counts while `starts_at <= now < ends_at` and its status is `ACTIVE`, so expiry needs no cron job
  and content re-locks the moment a plan ends. Work already done (progress, ticked steps, quiz results) is kept.
- **Payment flow (no payment gateway):** the student picks a plan and may apply a voucher, then sees the bank details and pays by
  transfer, and uploads a screenshot. An admin looks at it and **approves** (the plan starts, or queues behind the current one so paid
  days are never wasted) or **rejects with a reason** the student can read; a rejected request stays open for a new screenshot.
  Approving needs a screenshot to approve, which is the audit trail (`reviewed_by`, `reviewed_at`). Two admins approving at the same
  moment activate it once.
- **Prices are snapshotted** on the subscription (plan name, length, currency, original and final amount, discount), so later plan
  or voucher edits never change what a student owes. Money is calculated in integer cents and rounded half up to the cent. The
  currency is a per-plan code chosen by the admin.
- **Vouchers** are percentage-only (1 to 100; **100 % is a free voucher** that activates the plan at once with no payment). Optional
  start and end (the end is exclusive), a total-use limit, a per-student limit (default 1) and optional restriction to chosen plans
  (none means every plan). A use is counted while its subscription is `PENDING` or `ACTIVE`; cancelling gives it back. The use limit is
  enforced under a row lock (`SELECT ... FOR UPDATE`), so the last use cannot be handed out twice. **Every way a code can fail
  (unknown, switched off, expired, not started, wrong plan, sold out, already used) returns the same message**, and quotes and purchases
  are rate-limited per user, so codes cannot be probed. Once a voucher is used its discount cannot change, and it cannot be deleted
  (deactivate it).
- **Screenshots:** only JPEG, PNG and WebP, decided from the file's **bytes** (HTML, SVG, PDF or a mismatching header are refused),
  at most 5 MB, at most 5 per request, and a new one is refused while one is waiting for review. Files are stored under server-generated
  keys (`payments/<uuid>.<ext>`) behind `shared/storage.js`, in the private `UPLOAD_DIR` (git-ignored, never served as static files).
  Admins view them through an authenticated endpoint with `Cache-Control: private, no-store` and `X-Content-Type-Options: nosniff`.
  **At deployment** replace `shared/storage.js` with an S3-backed version (a private, tagged bucket; confirm with the owner first).
- Not built: automatic renewals, refunds beyond "revoke", emails to students (approval and rejection are shown in the app), and
  per-plan content bundles (any plan unlocks all Premium content).

**Excel import and export (Phase 8)**

- Exports are generated on demand with `exceljs`, sent as `attachment` with `Cache-Control: no-store` (they contain personal
  data) and are admin-only. The browser downloads them with the sign-in token and saves the blob, so no unauthenticated
  download links exist.
- **Formula injection:** text that comes from users (names, organizations, question wording) is written with a leading
  apostrophe when it starts with `=`, `+`, `-`, `@`, tab or carriage return, so Excel never evaluates it. The importer
  removes exactly that apostrophe again, so an export can be edited and re-imported without changing the data.
- **Question import layout:** columns `Question`, `Type`, `Marks`, `Correct options`, `Explanation`, `Option 1`..`Option 8`.
  Columns are found by header name (order is free). `Type` accepts `Single choice`, `Multiple select`, `True/False` (and
  the enum names). `Correct options` lists option *numbers*, e.g. `2` or `1,3`.
- **All or nothing:** every row is validated with the same rules as the admin form. If any row is wrong nothing is
  imported and the response lists up to 50 problem rows (`400 IMPORT_INVALID`, `details.rows`). Import appends to the
  quiz's existing questions. Limits: 500 rows and 2 MB per file; unreadable files get `400 INVALID_FILE`.
- The upload is the raw request body (no multipart parser). Only admins can upload, so zip-bomb style files are not
  considered a threat model here, but the size cap still applies.
- `backend/package.json` pins `uuid` to `^11.1.1` through `overrides`, because `exceljs` 4.4 depends on an old `uuid`
  with an advisory. `npm audit` reports 0 vulnerabilities; the round trip is covered by tests.

## Environments

- Local: Docker Compose PostgreSQL (`docker-compose.yml`), `backend/.env`.
- Production: AWS (RDS PostgreSQL, Cognito, S3) — see `deployment.md` (later phase).

## Roadmap

1. Repo, React, Express, PostgreSQL, Prisma — done
2. Cognito: register, verify email, login, profiles — done
3. Student/admin dashboards — done
4. Categories, courses, modules, lessons — done
5. Enrollment, YouTube player, resume-where-you-left-off — done
6. Module quizzes + question management — done (Excel import/export is Phase 8)
7. Final exam + locking — done
8. Reports, Excel exports and question import — done
9. CloudArt Labs — done
10. Subscriptions, vouchers and bank-transfer payments (premium content)  ← **this phase**
11. Client service requests
12. AWS production deployment
