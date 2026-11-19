-- AlterEnum
ALTER TYPE "ProposalStatus" ADD VALUE 'WITHDRAWN';

-- AlterTable
ALTER TABLE "project_milestones" ADD COLUMN     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "sort_order" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "service_projects" ADD COLUMN     "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "service_proposals" ADD COLUMN     "currency" VARCHAR(3),
ADD COLUMN     "responded_at" TIMESTAMPTZ(6),
ADD COLUMN     "response_note" VARCHAR(500),
ADD COLUMN     "sent_at" TIMESTAMPTZ(6),
ADD COLUMN     "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "service_request_attachments" ADD COLUMN     "content_type" VARCHAR(100) NOT NULL DEFAULT 'application/octet-stream',
ADD COLUMN     "size_bytes" INTEGER NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "service_requests" ADD COLUMN     "client_seen_at" TIMESTAMPTZ(6),
ADD COLUMN     "closed_at" TIMESTAMPTZ(6),
ADD COLUMN     "closed_reason" VARCHAR(500),
ADD COLUMN     "last_client_message_at" TIMESTAMPTZ(6),
ADD COLUMN     "last_staff_message_at" TIMESTAMPTZ(6),
ADD COLUMN     "staff_seen_at" TIMESTAMPTZ(6);

-- CreateTable
CREATE TABLE "service_request_messages" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "service_request_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "is_staff" BOOLEAN NOT NULL,
    "body" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "service_request_messages_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "service_request_messages_service_request_id_created_at_idx" ON "service_request_messages"("service_request_id", "created_at");

-- AddForeignKey
ALTER TABLE "service_request_messages" ADD CONSTRAINT "service_request_messages_service_request_id_fkey" FOREIGN KEY ("service_request_id") REFERENCES "service_requests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "service_request_messages" ADD CONSTRAINT "service_request_messages_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
