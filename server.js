require('dotenv').config();

const http = require('http');
const path = require('path');
const express = require('express');
const { Server } = require('socket.io');
const { pool, testConnection } = require('./db/connection');
const { createMessagesRouter, findUserById } = require('./routes/messages');

const PORT = Number(process.env.PORT) || 3000;

const app = express();
const server = http.createServer(app);
const io = new Server(server);

// Track socket connections -> user and unique online user counts across tabs.
const socketToUser = new Map();
const onlineUserCounts = new Map();

/**
 * Return the deduplicated list of currently connected users.
 * @returns {Array<object>}
 */
function getOnlineUsers() {
  return Array.from(onlineUserCounts.values(), (entry) => entry.user);
}

/**
 * Attach a user to a socket id, tracking multi-tab presence cleanly.
 * @param {string} socketId
 * @param {object} user
 */
function addSocketUser(socketId, user) {
  socketToUser.set(socketId, user);
  const existing = onlineUserCounts.get(user.fld_userid);
  if (existing) {
    existing.count += 1;
    existing.user = user;
  } else {
    onlineUserCounts.set(user.fld_userid, { user, count: 1 });
  }
}

/**
 * Detach a socket id and report if that user has no remaining open connections.
 * @param {string} socketId
 * @returns {{ user: object, becameOffline: boolean } | null}
 */
function removeSocketUser(socketId) {
  const user = socketToUser.get(socketId);
  if (!user) {
    return null;
  }
  socketToUser.delete(socketId);

  const entry = onlineUserCounts.get(user.fld_userid);
  if (!entry) {
    return { user, becameOffline: true };
  }

  entry.count -= 1;
  if (entry.count <= 0) {
    onlineUserCounts.delete(user.fld_userid);
    return { user, becameOffline: true };
  }

  return { user, becameOffline: false };
}

/**
 * Remove a socket's current user (if any) and emit user_disconnected when offline.
 * @param {string} socketId
 */
function leaveCurrentUser(socketId) {
  const removed = removeSocketUser(socketId);
  if (removed && removed.becameOffline) {
    io.emit('user_disconnected', {
      user: removed.user,
      onlineUsers: getOnlineUsers(),
    });
  }
}

app.use(express.json({ limit: '64kb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', createMessagesRouter(io));

// Handle malformed JSON payloads and unhandled route errors gracefully.
app.use((err, _req, res, _next) => {
  if (err && err.type === 'entity.parse.failed') {
    return res.status(400).json({ error: 'Invalid JSON request body.' });
  }
  console.error('[Express] Unhandled error:', err);
  return res.status(500).json({ error: 'Internal server error.' });
});

io.engine.on('connection_error', (err) => {
  console.error('[Socket.IO Engine] Connection error:', err.code, err.message);
});

io.on('connection', (socket) => {
  console.log(`[Socket] Client connected: ${socket.id}`);

  // Send immediate snapshot so newly opened clients know who is already online.
  socket.emit('online_users', { onlineUsers: getOnlineUsers() });

  socket.on('user_join', async (payload, ack) => {
    try {
      const rawUserId =
        payload && typeof payload.fld_userid === 'string'
          ? payload.fld_userid.trim()
          : '';

      if (!rawUserId) {
        const errorMsg = 'fld_userid is required to join.';
        if (typeof ack === 'function') ack({ ok: false, error: errorMsg });
        return;
      }

      const user = await findUserById(rawUserId);
      if (!user) {
        const errorMsg = `User ID "${rawUserId}" was not found.`;
        if (typeof ack === 'function') ack({ ok: false, error: errorMsg });
        return;
      }

      const currentUser = socketToUser.get(socket.id);
      if (currentUser && currentUser.fld_userid !== user.fld_userid) {
        leaveCurrentUser(socket.id);
      }

      if (!currentUser || currentUser.fld_userid !== user.fld_userid) {
        addSocketUser(socket.id, user);
      }

      const onlineUsers = getOnlineUsers();
      io.emit('user_connected', { user, onlineUsers });

      if (typeof ack === 'function') {
        ack({ ok: true, user, onlineUsers });
      }
    } catch (err) {
      console.error(`[Socket] user_join error on ${socket.id}:`, err);
      if (typeof ack === 'function') {
        ack({ ok: false, error: 'Server error while joining chat.' });
      }
    }
  });

  socket.on('user_leave', () => {
    try {
      leaveCurrentUser(socket.id);
    } catch (err) {
      console.error(`[Socket] user_leave error on ${socket.id}:`, err);
    }
  });

  socket.on('typing', (isTyping) => {
    try {
      const user = socketToUser.get(socket.id);
      if (!user) return;
      socket.broadcast.emit('user_typing', {
        fld_userid: user.fld_userid,
        full_name: user.full_name,
        isTyping: Boolean(isTyping),
      });
    } catch (err) {
      console.error(`[Socket] typing event error on ${socket.id}:`, err);
    }
  });

  socket.on('disconnect', (reason) => {
    try {
      console.log(`[Socket] Client disconnected: ${socket.id} (${reason})`);
      leaveCurrentUser(socket.id);
    } catch (err) {
      console.error(`[Socket] disconnect error on ${socket.id}:`, err);
    }
  });

  socket.on('error', (err) => {
    console.error(`[Socket] Socket error on ${socket.id}:`, err);
  });
});

async function startServer() {
  try {
    await testConnection();
    server.listen(PORT, () => {
      console.log(`[Server] Real-time Messenger running at http://localhost:${PORT}`);
    });
  } catch (err) {
    console.error('[Server] Startup aborted because database connection failed:', err.message);
    process.exit(1);
  }
}

function shutdown(signal) {
  console.log(`[Server] Received ${signal}. Shutting down gracefully...`);
  server.close(async () => {
    try {
      await pool.end();
    } catch (err) {
      console.error('[DB] Error closing connection pool:', err.message);
    }
    process.exit(0);
  });
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

startServer();
