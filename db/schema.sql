CREATE DATABASE IF NOT EXISTS db_activity2
  CHARACTER SET utf8mb4
  COLLATE utf8mb4_unicode_ci;

USE db_activity2;

CREATE TABLE IF NOT EXISTS tbl_users (
  fld_recno INT AUTO_INCREMENT PRIMARY KEY,
  fld_fname VARCHAR(100) NOT NULL,
  fld_lname VARCHAR(100) NOT NULL,
  fld_userid VARCHAR(100) NOT NULL UNIQUE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tbl_messages (
  fld_recno INT AUTO_INCREMENT PRIMARY KEY,
  fld_userid VARCHAR(100) NOT NULL,
  fld_message TEXT NOT NULL,
  fld_timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT fk_messages_user
    FOREIGN KEY (fld_userid) REFERENCES tbl_users (fld_userid)
    ON UPDATE CASCADE
    ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT IGNORE INTO tbl_users (fld_fname, fld_lname, fld_userid) VALUES
  ('Art London', 'Balangue', 'poty'),
  ('Juan', 'Dela Cruz', 'juan01'),
  ('Maria', 'Reyes', 'maria02');
