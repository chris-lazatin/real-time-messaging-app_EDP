# Real-Time Messenger Chat

A real-time messaging web application built with **Node.js**, **Express**, **Socket.IO**, and **MySQL** (`mysql2/promise`), featuring a clean Facebook Messenger-inspired interface.

## Features

- **Simple User Selection / Login**: Pick one of the seeded users from `tbl_users` or type an existing `fld_userid`.
- **Real-Time Messaging**: Messages are saved via `POST /api/messages` and instantly broadcast to all connected clients via the Socket.IO `new_message` event.
- **Persistent Chat History**: Loads the latest messages on join via `GET /api/messages` (joined with `tbl_users` to display full sender names and timestamps).
- **Live Online Presence**: Tracks active Socket.IO connections and updates online indicators in real time using `user_connected` and `user_disconnected` events.
- **Messenger-Style UI**:
  - Left sidebar with user/conversation rows, initials-based circular avatars, and green online status dots.
  - Right chat thread with grouped message bubbles (`#0084FF` sent on right, `#E4E6EB` received on left), hover/group timestamps, typing indicator, and auto-scroll.
  - Fixed pill-shaped bottom composer with a circular send button that highlights blue when ready to send.

## Project Structure

```text
realtime-messenger/
├── db/
│   ├── connection.js      # mysql2/promise connection pool + connectivity check
│   └── schema.sql         # MySQL schema & sample seed data for db_activity2
├── public/
│   ├── index.html         # Messenger UI markup and user login modal
│   ├── script.js          # REST calls, Socket.IO client, and UI state rendering
│   └── style.css          # Messenger-inspired styling and responsive layout
├── routes/
│   └── messages.js        # Express REST API (/api/users, /api/login, /api/messages)
├── .env                   # Local environment configuration (ignored by git)
├── .env.example           # Sample environment variables template
├── package.json
├── README.md
└── server.js              # Express + Socket.IO server entry point
```

## Prerequisites

- **Node.js** (v18+ recommended) and **npm**
- **MySQL** or **MariaDB** running locally (e.g., via XAMPP, MySQL Community Server, or Docker)

## 1. Set Up the Database

Run the SQL script in [`db/schema.sql`](db/schema.sql) to create the `db_activity2` database (`utf8mb4` / `utf8mb4_unicode_ci`), the `tbl_users` and `tbl_messages` tables, and seed 3 sample users (`poty`, `juan01`, `maria02`):

```bash
mysql -u root -p < db/schema.sql
```

On Windows with XAMPP (default empty `root` password):

```powershell
& "C:\xampp\mysql\bin\mysql.exe" -u root < db/schema.sql
```

You can also paste the contents of `db/schema.sql` directly into phpMyAdmin or MySQL Workbench and execute it.

## 2. Configure Environment Variables

Copy `.env.example` to `.env` (or update the existing `.env` file) with your MySQL credentials:

```env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=
DB_NAME=db_activity2
```

## 3. Install Dependencies

```bash
npm install
```

## 4. Run the Application

```bash
npm start
```

Then open **two or more browser tabs** at:

```text
http://localhost:3000
```

Log in as different users across tabs (for example `poty` in Tab 1 and `juan01` in Tab 2) to see live online dots update and messages broadcast instantly in real time.

## API & Socket.IO Reference

- `GET /api/health` — Checks database connectivity.
- `GET /api/users` — Returns registered users from `tbl_users`.
- `POST /api/login` — Validates an existing `fld_userid`.
- `GET /api/messages?limit=50` — Fetches the last `N` messages joined with `tbl_users`.
- `POST /api/messages` — Saves `{ fld_userid, fld_message }` to `tbl_messages` and broadcasts `new_message` via Socket.IO.
- Socket events: `user_join`, `user_leave`, `user_connected`, `user_disconnected`, `online_users`, `new_message`, `typing`, `user_typing`.
