ALTER TABLE "users"
  ADD COLUMN "toking_credit_account_id" TEXT,
  ADD COLUMN "toking_api_key_encrypted" TEXT,
  ADD COLUMN "toking_api_key_prefix" TEXT,
  ADD COLUMN "toking_base_url" TEXT,
  ADD COLUMN "toking_balance" TEXT;

CREATE UNIQUE INDEX "users_toking_credit_account_id_key"
  ON "users"("toking_credit_account_id");

-- Legacy redeem-code tables are intentionally retained as read-only historical
-- data. Gangram no longer reads from or writes to them.
