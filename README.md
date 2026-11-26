# Real-Time Messenger (EDP Final Activity)

Real-time chat app for the Event Driven Programming final activity. Built with Node.js, Express, Socket.IO, and MySQL. UI is styled to look like Facebook Messenger.

## Features

- Pick a user from `tbl_users` to "log in" (no password, just for testing)
- Send messages, they get saved to MySQL and broadcast instantly to everyone connected (Socket.IO)
- Loads previous messages when you open the app
- Shows who's online
- Messenger-style UI (sidebar, chat bubbles, avatars)

## Project Structure

```
realtime-messenger/
├── db/
│   ├── connection.js      # mysql connection pool
│   └── schema.sql         # database + table setup, sample users
├── public/
│   ├── index.html
│   ├── script.js
│   └── style.css
├── routes/
│   └── messages.js        # /api/users, /api/login, /api/messages
├── .env.example
├── package.json
├── README.md
└── server.js              # Express + Socket.IO entry point
```

## How to Run

1. Make sure you have Node.js and MySQL installed.
2. Import the database:
   ```
   mysql -u root -p < db/schema.sql
   ```
   (On XAMPP, default root password is usually blank.)
3. Copy `.env.example` to `.env` and put in your MySQL details:
   ```
   PORT=3000
   DB_HOST=localhost
   DB_PORT=3306
   DB_USER=root
   DB_PASSWORD=
   DB_NAME=db_activity2
   ```
4. Install the dependencies:
   ```
   npm install
   ```
5. Run it:
   ```
   npm start
   ```
6. Open `http://localhost:3000` in two browser tabs and log in as different users (e.g. `poty` and `juan01`) to test the real-time messaging.

## API

- `GET /api/users` - list of users
- `POST /api/login` - check if a user id exists
- `GET /api/messages?limit=50` - get recent messages
- `POST /api/messages` - send a new message (also broadcasts via Socket.IO)

## Socket.IO events

`user_join`, `user_leave`, `user_connected`, `user_disconnected`, `online_users`, `new_message`, `typing`, `user_typing`
