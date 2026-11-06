# EventZone

EventZone is a full-stack event planning and booking web application. Guests can browse event packages and request a booking, staff can manage bookings from an admin dashboard, and invited guests can RSVP and check in at the venue using a QR code.

## Features

- **Role gate**: choose Guest or Staff/Admin on entry
- **Event booking**: request weddings, galas, soirees, birthdays, corporate events, baby showers, art exhibitions and charity events, with a live price estimate
- **Availability calendar**: dates that are already booked are blocked (declined bookings free the date)
- **Admin dashboard**: approve or decline bookings, filter by status, view analytics and an audit log
- **Secure admin login**: PBKDF2-hashed passwords, session tokens that expire after 12 hours
- **Guest RSVP**: per-event page with venue details, meal choice, dietary needs and table number
- **QR check-in**: each RSVP gets a unique QR code; staff scan it to check the guest in

## Tech stack

| Layer    | Technology                                   |
|----------|----------------------------------------------|
| Frontend | HTML, CSS, vanilla JavaScript                |
| Backend  | Node.js, Express                             |
| Database | SQLite via `sql.js`, saved to `eventzone.sqlite` |
| Extras   | `qrcode` (QR generation), `html5-qrcode` (scanning), `cors` |

## Getting started

**Prerequisites:** [Node.js](https://nodejs.org/) 18 or newer.

```bash
git clone https://github.com/Gomolemo23/EventZone.git
cd EventZone
npm install
npm start
```

Open <http://localhost:3000> in your browser. To use another port: `PORT=4000 npm start`.

On first run the server creates `eventzone.sqlite` automatically with the tables and some sample bookings, so no database setup is needed.

### Demo admin login

| Username | Password |
|----------|----------|
| `admin`  | `admin`  |

This default account is for demonstration only. Change it before any real deployment.

## Project structure

```
EventZone/
├── index.html      Main app: role gate, booking, admin dashboard
├── event.html      Guest event page and RSVP form
├── checkin.html    Staff QR check-in page
├── script.js       Main frontend logic
├── guest.js        RSVP page logic
├── checkin.js      Check-in page logic
├── style.css       Styling
├── server.js       Express server, REST API and database setup
├── package.json
└── docs/
    └── API.md      API reference
```

## API overview

See [docs/API.md](docs/API.md) for the full list. Admin-only routes require an `Authorization: Bearer <token>` header from `POST /api/auth/login`.

## Database

Tables: `bookings`, `admin_users`, `audit_log`, `event_details`, `guest_rsvps`. The `.sqlite` file is git-ignored; delete it to reset to the sample data.

## Known limitations

- Admin sessions are held in memory and are lost when the server restarts.
- Default admin credentials are for demo use only.
- Intended as a coursework project, not hardened for production.

## Author

Gomolemo23, submitted as coursework.

## License

[MIT](LICENSE)
