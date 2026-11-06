# EventZone API

Base URL: `http://localhost:3000`. All bodies are JSON.

| Method | Route | Auth | Purpose |
|--------|-------|------|---------|
| GET    | `/api/health` | none | Server health check |
| POST   | `/api/auth/login` | none | Admin login, returns a session token |
| POST   | `/api/auth/logout` | token | End the admin session |
| GET    | `/api/bookings/availability` | none | Dates already booked |
| GET    | `/api/analytics` | none | Booking and revenue statistics |
| GET    | `/api/audit` | none | Audit log entries |
| GET    | `/api/bookings` | none | List bookings |
| POST   | `/api/bookings` | none | Create a booking request |
| PATCH  | `/api/bookings/:id/status` | none | Set status: Pending, Confirmed or Declined |
| GET    | `/api/events/:id` | none | Public event details for a booking |
| GET    | `/api/admin/guest-events` | admin | Events with guest lists and QR info |
| PATCH  | `/api/admin/events/:id/details` | admin | Update venue, start time, directions |
| POST   | `/api/events/:id/rsvp` | none | Guest RSVP, returns a QR check-in token |
| POST   | `/api/check-ins/:token` | none | Check a guest in by QR token |

Valid event types: Wedding, Gala, Soiree, Birthday, Corporate, BabyShower, ArtExhibition, Charity Event.
