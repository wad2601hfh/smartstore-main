-- =====================================================================
-- SmartStore Migration Script v5
-- Run in phpMyAdmin > SQL tab if your database already exists
-- =====================================================================

-- [v3] Add user profile columns (safe to re-run)
ALTER TABLE `users`
  ADD COLUMN IF NOT EXISTS `display_name` varchar(100) DEFAULT NULL AFTER `username`,
  ADD COLUMN IF NOT EXISTS `phone` varchar(30) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `bank_info` varchar(255) DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS `balance` int(11) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `earnings` int(11) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS `updated_at` timestamp NOT NULL DEFAULT current_timestamp() ON UPDATE current_timestamp();

-- Copy username into display_name where empty (before we drop username)
UPDATE `users` SET `display_name` = `username` WHERE `display_name` IS NULL OR `display_name` = '';

-- [v4] Add payment_method to orders
ALTER TABLE `orders`
  ADD COLUMN IF NOT EXISTS `payment_method` varchar(20) DEFAULT 'cash' AFTER `status`;

-- [v4] Drop columns no longer used
ALTER TABLE `orders`
  DROP COLUMN IF EXISTS `receipt_path`,
  DROP COLUMN IF EXISTS `location`;

ALTER TABLE `offers`
  DROP COLUMN IF EXISTS `contact`,
  DROP COLUMN IF EXISTS `is_auto`;

-- [v5] Make display_name the unique identity key, drop username column
-- Step 1: Make display_name NOT NULL and UNIQUE
ALTER TABLE `users`
  MODIFY COLUMN `display_name` varchar(100) NOT NULL;

-- Step 2: Add unique constraint (ignore if already exists)
ALTER IGNORE TABLE `users`
  ADD UNIQUE KEY `uniq_display_name` (`display_name`);

-- Step 3: Drop the username column
ALTER TABLE `users`
  DROP COLUMN IF EXISTS `username`;

-- [v4-v5] Add indexes for query performance
ALTER TABLE `orders`
  ADD INDEX IF NOT EXISTS `idx_buyer` (`buyer_name`),
  ADD INDEX IF NOT EXISTS `idx_seller` (`seller_name`);

SELECT 'Migration v5 complete! display_name is now the unique identity key.' AS result;
