-- =====================================================================
-- SmartStore Database Schema — InfinityFree Compatible
-- Import this in phpMyAdmin > SQL tab (fresh install)
-- =====================================================================
SET SQL_MODE = "NO_AUTO_VALUE_ON_ZERO";
SET time_zone = "+00:00";

-- 1. Users Table
CREATE TABLE IF NOT EXISTS `users` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `display_name` varchar(100) NOT NULL COMMENT 'Name entered by user — acts as their login key',
  `role` enum('buyer','seller') NOT NULL,
  `phone` varchar(30) DEFAULT NULL COMMENT 'WhatsApp number with country code',
  `bank_info` varchar(255) DEFAULT NULL COMMENT 'Seller bank/e-wallet for withdrawals',
  `balance` int(11) NOT NULL DEFAULT 0 COMMENT 'Buyer wallet balance (Rp)',
  `earnings` int(11) NOT NULL DEFAULT 0 COMMENT 'Seller earnings balance (Rp)',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  `updated_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  UNIQUE KEY `uniq_display_name` (`display_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 2. Requests Table (active buyer requests broadcast to sellers)
CREATE TABLE IF NOT EXISTS `requests` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `buyer_name` varchar(100) NOT NULL COMMENT 'FK to users.display_name',
  `description` text NOT NULL COMMENT 'Raw text from buyer chat input',
  `parsed_items` text DEFAULT NULL COMMENT 'JSON array of {item, qty} parsed by AI',
  `location` varchar(100) DEFAULT NULL COMMENT 'lat,lng from GPS',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 3. Offers Table (seller responses to buyer requests)
CREATE TABLE IF NOT EXISTS `offers` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `request_id` int(11) NOT NULL COMMENT 'FK to requests.id',
  `seller_name` varchar(100) NOT NULL COMMENT 'FK to users.display_name',
  `product_name` varchar(150) NOT NULL,
  `price` int(11) NOT NULL COMMENT 'Total price (unit_price x qty)',
  `image_path` varchar(255) DEFAULT NULL COMMENT 'Food photo uploaded by seller',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_request_id` (`request_id`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- 4. Orders Table (completed/pending transactions after buyer confirms payment)
CREATE TABLE IF NOT EXISTS `orders` (
  `id` int(11) NOT NULL AUTO_INCREMENT,
  `buyer_name` varchar(80) NOT NULL COMMENT 'FK to users.display_name',
  `seller_name` varchar(80) NOT NULL COMMENT 'FK to users.display_name',
  `product_name` varchar(150) NOT NULL,
  `total_price` int(11) NOT NULL,
  `image_path` varchar(255) DEFAULT NULL,
  `payment_method` varchar(20) DEFAULT 'cash' COMMENT 'cash, qris, or balance',
  `status` enum('pending','completed','rejected') NOT NULL DEFAULT 'pending',
  `created_at` timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (`id`),
  KEY `idx_buyer` (`buyer_name`),
  KEY `idx_seller` (`seller_name`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;