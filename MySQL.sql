-- For saving logs and audit information
-- DO NOT INCLUDE THIS FILE IN YOUR FOLDER


-- Create the table guild setting SQL
CREATE TABLE IF NOT EXISTS guild_settings (
          guild_id VARCHAR(20) PRIMARY KEY,
          log_channel VARCHAR(20),
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Create the table purhe audit SQL
CREATE TABLE IF NOT EXISTS purge_audit (
          audit_id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
          guild_id VARCHAR(20) NOT NULL,
          executor_id VARCHAR(20) NOT NULL,
          target_id VARCHAR(20) NOT NULL,
          deleted_count INT UNSIGNED NOT NULL,
          channels JSON NOT NULL,
          execution_time FLOAT NOT NULL,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          INDEX idx_guild (guild_id),
          INDEX idx_executor (executor_id),
          INDEX idx_target (target_id)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
      
-- Save log channel setting in the database
INSERT INTO guild_settings (guild_id, log_channel)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE 
          log_channel = VALUES(log_channel),
          updated_at = CURRENT_TIMESTAMP
-- Set log channel
INSERT INTO guild_settings (guild_id, log_channel)
        VALUES (?, ?)
        ON DUPLICATE KEY UPDATE 
          log_channel = VALUES(log_channel),
          updated_at = CURRENT_TIMESTAMP

-- Get log channel from the database
SELECT log_channel FROM guild_settings WHERE guild_id = ?

-- Reset log channel in the database
DELETE FROM guild_settings WHERE guild_id = ?

-- Save purge audit in the database
INSERT INTO purge_audit 
          (guild_id, executor_id, target_id, deleted_count, channels, execution_time)
        VALUES (?, ?, ?, ?, ?, ?)
