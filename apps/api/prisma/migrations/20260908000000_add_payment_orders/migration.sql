ALTER TYPE "LedgerType" ADD VALUE 'payment';
CREATE TABLE "payment_orders" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "user_id" TEXT,
  "request_key" TEXT NOT NULL,
  "offer_id" TEXT NOT NULL,
  "method_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "amount_minor" INTEGER NOT NULL CHECK ("amount_minor" > 0),
  "currency" TEXT NOT NULL,
  "app_token_amount" INTEGER NOT NULL CHECK ("app_token_amount" > 0),
  "status" TEXT NOT NULL DEFAULT 'creating',
  "remote_payment_id" TEXT,
  "approval_url" TEXT,
  "credited_at" TIMESTAMP(3),
  "last_checked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "payment_orders_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "payment_orders_user_id_request_key_key" ON "payment_orders"("user_id", "request_key");
CREATE UNIQUE INDEX "payment_orders_remote_payment_id_key" ON "payment_orders"("remote_payment_id");
CREATE INDEX "payment_orders_user_id_created_at_idx" ON "payment_orders"("user_id", "created_at");
CREATE INDEX "payment_orders_status_last_checked_at_idx" ON "payment_orders"("status", "last_checked_at");
