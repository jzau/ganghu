-- CreateTable
CREATE TABLE "conversation_shares" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "conversation_shares_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "conversation_shares_conversation_id_key" ON "conversation_shares"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_shares_token_key" ON "conversation_shares"("token");

-- AddForeignKey
ALTER TABLE "conversation_shares" ADD CONSTRAINT "conversation_shares_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
