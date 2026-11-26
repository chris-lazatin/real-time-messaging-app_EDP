const express = require('express');
const { pool } = require('../db/connection');

const DEFAULT_MESSAGE_LIMIT = 50;
const MAX_MESSAGE_LIMIT = 200;
const MAX_MESSAGE_LENGTH = 5000;

function formatUser(row) {
  const firstName = row.fld_fname ? String(row.fld_fname).trim() : '';
  const lastName = row.fld_lname ? String(row.fld_lname).trim() : '';
  return {
    fld_recno: row.fld_recno,
    fld_fname: firstName,
    fld_lname: lastName,
    fld_userid: row.fld_userid,
    full_name: `${firstName} ${lastName}`.trim() || row.fld_userid,
  };
}

function formatMessage(row) {
  const firstName = row.fld_fname ? String(row.fld_fname).trim() : '';
  const lastName = row.fld_lname ? String(row.fld_lname).trim() : '';
  return {
    fld_recno: row.fld_recno,
    fld_userid: row.fld_userid,
    fld_fname: firstName,
    fld_lname: lastName,
    sender_name: `${firstName} ${lastName}`.trim() || row.fld_userid,
    fld_message: row.fld_message,
    fld_timestamp: row.fld_timestamp,
  };
}

async function findUserById(userId) {
  const [rows] = await pool.query(
    'SELECT fld_recno, fld_fname, fld_lname, fld_userid FROM tbl_users WHERE fld_userid = ? LIMIT 1',
    [userId]
  );
  return rows.length > 0 ? formatUser(rows[0]) : null;
}

function parseLimit(rawLimit) {
  const parsed = Number.parseInt(String(rawLimit ?? ''), 10);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return DEFAULT_MESSAGE_LIMIT;
  }
  return Math.min(parsed, MAX_MESSAGE_LIMIT);
}

function createMessagesRouter(io) {
  const router = express.Router();

  router.get('/health', async (_req, res) => {
    try {
      await pool.query('SELECT 1');
      return res.json({
        ok: true,
        database: process.env.DB_NAME || 'db_activity2',
      });
    } catch (err) {
      console.error('[API] Health check failed:', err);
      return res.status(500).json({ ok: false, error: 'Database unavailable.' });
    }
  });

  router.get('/users', async (_req, res) => {
    try {
      const [rows] = await pool.query(
        'SELECT fld_recno, fld_fname, fld_lname, fld_userid FROM tbl_users ORDER BY fld_recno ASC'
      );
      return res.json({ users: rows.map(formatUser) });
    } catch (err) {
      console.error('[API] GET /api/users error:', err);
      return res.status(500).json({ error: 'Failed to load users.' });
    }
  });

  router.post('/login', async (req, res) => {
    try {
      const rawUserId =
        req.body && typeof req.body.fld_userid === 'string'
          ? req.body.fld_userid.trim()
          : '';

      if (!rawUserId) {
        return res.status(400).json({ error: 'Please select or enter a user ID.' });
      }

      const user = await findUserById(rawUserId);
      if (!user) {
        return res.status(404).json({
          error: `User ID "${rawUserId}" was not found. Pick a user from the list or enter an existing user ID.`,
        });
      }

      return res.json({ user });
    } catch (err) {
      console.error('[API] POST /api/login error:', err);
      return res.status(500).json({ error: 'Failed to validate user ID.' });
    }
  });

  router.get('/messages', async (req, res) => {
    try {
      const limit = parseLimit(req.query.limit);
      const [rows] = await pool.query(
        `SELECT recent.fld_recno, recent.fld_userid, recent.fld_message, recent.fld_timestamp,
                recent.fld_fname, recent.fld_lname
         FROM (
           SELECT m.fld_recno, m.fld_userid, m.fld_message, m.fld_timestamp,
                  u.fld_fname, u.fld_lname
           FROM tbl_messages m
           INNER JOIN tbl_users u ON m.fld_userid = u.fld_userid
           ORDER BY m.fld_recno DESC
           LIMIT ?
         ) AS recent
         ORDER BY recent.fld_recno ASC`,
        [limit]
      );

      return res.json({ messages: rows.map(formatMessage) });
    } catch (err) {
      console.error('[API] GET /api/messages error:', err);
      return res.status(500).json({ error: 'Failed to fetch messages.' });
    }
  });

  router.post('/messages', async (req, res) => {
    try {
      const rawUserId =
        req.body && typeof req.body.fld_userid === 'string'
          ? req.body.fld_userid.trim()
          : '';
      const rawMessage =
        req.body && typeof req.body.fld_message === 'string'
          ? req.body.fld_message.trim()
          : '';

      if (!rawUserId) {
        return res.status(400).json({ error: 'fld_userid is required.' });
      }
      if (!rawMessage) {
        return res.status(400).json({ error: 'Message cannot be empty.' });
      }
      if (rawMessage.length > MAX_MESSAGE_LENGTH) {
        return res.status(400).json({
          error: `Message cannot exceed ${MAX_MESSAGE_LENGTH} characters.`,
        });
      }

      const user = await findUserById(rawUserId);
      if (!user) {
        return res.status(404).json({
          error: `User ID "${rawUserId}" does not exist in tbl_users.`,
        });
      }

      const [insertResult] = await pool.query(
        'INSERT INTO tbl_messages (fld_userid, fld_message) VALUES (?, ?)',
        [user.fld_userid, rawMessage]
      );

      const [savedRows] = await pool.query(
        `SELECT m.fld_recno, m.fld_userid, m.fld_message, m.fld_timestamp,
                u.fld_fname, u.fld_lname
         FROM tbl_messages m
         INNER JOIN tbl_users u ON m.fld_userid = u.fld_userid
         WHERE m.fld_recno = ?
         LIMIT 1`,
        [insertResult.insertId]
      );

      if (savedRows.length === 0) {
        return res.status(500).json({ error: 'Message saved, but could not be reloaded.' });
      }

      const savedMessage = formatMessage(savedRows[0]);

      if (io) {
        io.emit('new_message', savedMessage);
      }

      return res.status(201).json({ message: savedMessage });
    } catch (err) {
      console.error('[API] POST /api/messages error:', err);
      return res.status(500).json({ error: 'Failed to save message.' });
    }
  });

  return router;
}

module.exports = {
  createMessagesRouter,
  findUserById,
  formatUser,
};
