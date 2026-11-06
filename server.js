const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const initSqlJs = require('sql.js');
const QRCode = require('qrcode');

const app = express();
const port = process.env.PORT || 3000;
const dbFilePath = path.join(__dirname, 'eventzone.sqlite');

let SQL;
let db;
const adminSessions = new Map();

app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

const validStatusValues = ['Pending', 'Confirmed', 'Declined'];
const validEventTypes = ['Wedding', 'Gala', 'Soiree', 'Birthday', 'Corporate', 'BabyShower', 'ArtExhibition', 'Charity Event'];

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  if (!storedHash || typeof storedHash !== 'string') return false;
  const separatorIndex = storedHash.indexOf(':');
  if (separatorIndex === -1) return false;
  const salt = storedHash.slice(0, separatorIndex);
  const hash = storedHash.slice(separatorIndex + 1);
  const derived = crypto.pbkdf2Sync(password, salt, 100000, 64, 'sha256').toString('hex');
  try {
    return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(derived, 'hex'));
  } catch (error) {
    return false;
  }
}

function sanitizeText(value, maxLength = 200) {
  return String(value ?? '').trim().slice(0, maxLength);
}

function isDateBooked(dateValue) {
  const normalizedDate = String(dateValue ?? '').split('T')[0];
  if (!normalizedDate) return false;

  const stmt = db.prepare('SELECT id FROM bookings WHERE date = ? AND status != ? LIMIT 1');
  stmt.bind([normalizedDate, 'Declined']);
  const exists = stmt.step();
  stmt.reset();
  return exists;
}

function isValidEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(String(value ?? '').trim());
}

function requireAdmin(req, res, next) {
  const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
  const session = adminSessions.get(token);
  if (!session || session.expiresAt <= Date.now() || session.role !== 'admin') {
    if (token) adminSessions.delete(token);
    return res.status(401).json({ error: 'Admin sign-in is required.' });
  }
  req.adminUser = session.username;
  next();
}

function logAudit(actor, action, details = '') {
  try {
    db.run(
      'INSERT INTO audit_log (actor, action, details) VALUES (?, ?, ?)',
      [sanitizeText(actor, 80) || 'system', sanitizeText(action, 120), sanitizeText(details, 500)]
    );
    persistDatabase();
  } catch (error) {
    console.warn('Unable to write audit log:', error.message);
  }
}

function getRevenueForType(type) {
  return {
    Wedding: 12500,
    Gala: 18000,
    Soiree: 6200,
    Birthday: 4300,
    Corporate: 9800,
    BabyShower: 3600,
    ArtExhibition: 7600,
    'Charity Event': 5200
  }[type] || 4200;
}

function persistDatabase() {
  const data = db.export();
  const buffer = Buffer.from(data);
  fs.writeFileSync(dbFilePath, buffer);
}

function rowsFromQuery(sql) {
  const result = db.exec(sql);
  if (!result[0]) return [];

  const columns = result[0].columns;
  const values = result[0].values;

  return values.map((row) => {
    return columns.reduce((acc, col, index) => {
      acc[col] = row[index];
      return acc;
    }, {});
  });
}

async function initializeDatabase() {
  SQL = await initSqlJs({
    locateFile: (file) => path.join(__dirname, 'node_modules', 'sql.js', 'dist', file)
  });

  if (fs.existsSync(dbFilePath)) {
    const fileBuffer = fs.readFileSync(dbFilePath);
    db = new SQL.Database(new Uint8Array(fileBuffer));
  } else {
    db = new SQL.Database();
  }

  db.run(`
    CREATE TABLE IF NOT EXISTS bookings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      email TEXT NOT NULL,
      type TEXT NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      status TEXT NOT NULL
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS admin_users (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      username TEXT NOT NULL UNIQUE,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'admin'
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actor TEXT NOT NULL,
      action TEXT NOT NULL,
      details TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS event_details (
      booking_id INTEGER PRIMARY KEY,
      venue_name TEXT NOT NULL DEFAULT 'Venue to be announced',
      venue_address TEXT NOT NULL DEFAULT '',
      start_time TEXT NOT NULL DEFAULT '17:00',
      directions TEXT NOT NULL DEFAULT ''
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS guest_rsvps (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      booking_id INTEGER NOT NULL,
      guest_name TEXT NOT NULL,
      email TEXT NOT NULL,
      phone TEXT NOT NULL,
      meal_choice TEXT NOT NULL,
      dietary_needs TEXT NOT NULL DEFAULT '',
      table_number INTEGER NOT NULL,
      checkin_token TEXT NOT NULL UNIQUE,
      checked_in_at TEXT,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      UNIQUE (booking_id, email)
    )
  `);

  const adminUserCount = rowsFromQuery("SELECT COUNT(*) AS count FROM admin_users WHERE username = 'admin'");
  if (!adminUserCount.length || adminUserCount[0].count === 0) {
    db.run('INSERT INTO admin_users (username, password_hash, role) VALUES (?, ?, ?)', ['admin', hashPassword('admin'), 'admin']);
  }

  const existingRows = rowsFromQuery('SELECT COUNT(*) AS count FROM bookings');
  if (existingRows.length === 0 || existingRows[0].count === 0) {
    const seedRows = [
      {
        name: 'Alexandra Vance',
        email: 'alexandra@vance.design',
        type: 'Wedding',
        date: '2026-09-18',
        notes: 'Requires custom ceiling flower cloud mechanics and high modern architectural styling.',
        status: 'Confirmed'
      },
      {
        name: 'Marcus Thorne',
        email: 'm.thorne@vanguard.co',
        type: 'Gala',
        date: '2026-11-05',
        notes: 'Corporate alignment keynote tracking layout for 400 executive attendants.',
        status: 'Pending'
      }
    ];

    seedRows.forEach((row) => {
      db.run(
        'INSERT INTO bookings (name, email, type, date, notes, status) VALUES (?, ?, ?, ?, ?, ?)',
        [row.name, row.email, row.type, row.date, row.notes, row.status]
      );
    });
  }

  rowsFromQuery('SELECT id FROM bookings').forEach(({ id }) => {
    db.run('INSERT OR IGNORE INTO event_details (booking_id) VALUES (?)', [id]);
  });
  persistDatabase();
}

initializeDatabase()
  .then(() => {
    app.get('/api/health', (_req, res) => {
      res.json({ status: 'ok' });
    });

    app.post('/api/auth/login', (req, res) => {
      const username = sanitizeText(req.body?.username || '', 40);
      const password = String(req.body?.password || '');

      if (!username || password.length < 3) {
        logAudit('unknown', 'LOGIN_FAILED', 'Missing or invalid credentials');
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      const stmt = db.prepare('SELECT * FROM admin_users WHERE username = ?');
      stmt.bind([username]);

      if (!stmt.step()) {
        logAudit(username, 'LOGIN_FAILED', 'No matching account');
        stmt.reset();
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      const user = stmt.getAsObject();
      stmt.reset();

      if (!verifyPassword(password, user.password_hash)) {
        logAudit(username, 'LOGIN_FAILED', 'Incorrect password');
        return res.status(401).json({ error: 'Invalid username or password.' });
      }

      logAudit(username, 'LOGIN_SUCCESS', `Role: ${user.role}`);
      const sessionToken = crypto.randomBytes(32).toString('hex');
      adminSessions.set(sessionToken, {
        username: user.username,
        role: user.role || 'admin',
        expiresAt: Date.now() + 12 * 60 * 60 * 1000
      });
      res.json({
        success: true,
        token: sessionToken,
        user: {
          username: user.username,
          role: user.role || 'admin'
        }
      });
    });

    app.post('/api/auth/logout', (req, res) => {
      const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
      if (token) adminSessions.delete(token);
      res.json({ success: true });
    });

    app.get('/api/bookings/availability', (req, res) => {
      const date = sanitizeText(req.query.date || '', 20);
      if (!date) {
        return res.status(400).json({ available: false, message: 'A date is required.' });
      }

      const available = !isDateBooked(date);
      res.json({
        available,
        message: available ? 'Date available.' : 'That date is already booked. Please choose another one.'
      });
    });

    app.get('/api/analytics', (_req, res) => {
      try {
        const rows = rowsFromQuery('SELECT * FROM bookings ORDER BY id DESC');
        const statusBreakdown = { Pending: 0, Confirmed: 0, Declined: 0 };
        const typeBreakdown = {};
        const monthlySeries = Array.from({ length: 6 }, (_, index) => {
          const date = new Date();
          date.setMonth(date.getMonth() - (5 - index));
          return { label: date.toLocaleString('en-US', { month: 'short' }), value: 0 };
        });

        let totalRevenue = 0;
        let revenueThisMonth = 0;
        let pendingCount = 0;
        let confirmedCount = 0;

        const now = new Date();
        const currentMonth = now.getMonth();
        const currentYear = now.getFullYear();

        rows.forEach((row) => {
          const type = row.type || 'Wedding';
          const typeValue = getRevenueForType(type);
          totalRevenue += typeValue;
          typeBreakdown[type] = (typeBreakdown[type] || 0) + 1;

          if (row.status === 'Pending') {
            pendingCount += 1;
            statusBreakdown.Pending += 1;
          } else if (row.status === 'Confirmed') {
            confirmedCount += 1;
            statusBreakdown.Confirmed += 1;
          } else if (row.status === 'Declined') {
            statusBreakdown.Declined += 1;
          }

          const bookingDate = new Date(row.date);
          if (!Number.isNaN(bookingDate.getTime())) {
            const bookingMonth = bookingDate.getMonth();
            const bookingYear = bookingDate.getFullYear();
            if (bookingYear === currentYear && bookingMonth === currentMonth) {
              revenueThisMonth += typeValue;
            }

            const monthIndex = monthlySeries.findIndex((entry) => {
              const entryDate = new Date();
              entryDate.setMonth(entryDate.getMonth() - (5 - monthlySeries.indexOf(entry)));
              return entryDate.getMonth() === bookingMonth && entryDate.getFullYear() === bookingYear;
            });

            if (monthIndex >= 0) {
              monthlySeries[monthIndex].value += typeValue;
            }
          }
        });

        let previousMonthRevenue = 0;
        const prevMonth = new Date();
        prevMonth.setMonth(prevMonth.getMonth() - 1);
        rows.forEach((row) => {
          const bookingDate = new Date(row.date);
          if (!Number.isNaN(bookingDate.getTime())) {
            if (bookingDate.getMonth() === prevMonth.getMonth() && bookingDate.getFullYear() === prevMonth.getFullYear()) {
              previousMonthRevenue += getRevenueForType(row.type || 'Wedding');
            }
          }
        });

        const revenueTrend = previousMonthRevenue === 0 ? 0 : Number((((revenueThisMonth - previousMonthRevenue) / previousMonthRevenue) * 100).toFixed(1));

        res.json({
          totalRevenue,
          revenueThisMonth,
          pendingCount,
          confirmedCount,
          revenueTrend,
          statusBreakdown,
          typeBreakdown,
          monthlySeries,
          totalBookings: rows.length,
          conversionRate: rows.length ? Number(((confirmedCount / rows.length) * 100).toFixed(1)) : 0
        });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/audit', (_req, res) => {
      try {
        const rows = rowsFromQuery('SELECT * FROM audit_log ORDER BY id DESC LIMIT 25');
        res.json(rows);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/bookings', (req, res) => {
      try {
        const statusFilter = req.query.status;
        const rows = rowsFromQuery('SELECT * FROM bookings ORDER BY id DESC');
        const filteredRows = statusFilter && statusFilter !== 'all'
          ? rows.filter((row) => row.status === statusFilter)
          : rows;
        res.json(filteredRows);
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.patch('/api/bookings/:id/status', (req, res) => {
      const bookingId = Number(req.params.id);
      const { status } = req.body;

      if (!Number.isInteger(bookingId) || !status || !validStatusValues.includes(status)) {
        return res.status(400).json({ error: 'A valid booking id and status are required.' });
      }

      try {
        db.run('UPDATE bookings SET status = ? WHERE id = ?', [status, bookingId]);
        logAudit('admin', 'BOOKING_STATUS_UPDATED', `Booking #${bookingId} -> ${status}`);
        persistDatabase();
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.post('/api/bookings', (req, res) => {
      const name = sanitizeText(req.body?.name, 80);
      const email = sanitizeText(req.body?.email, 120);
      const type = sanitizeText(req.body?.type, 80);
      const date = sanitizeText(req.body?.date, 20);
      const notes = sanitizeText(req.body?.notes, 500);

      if (!name || !email || !date || !isValidEmail(email)) {
        return res.status(400).json({ error: 'Name, valid email and date are required.' });
      }

      if (isDateBooked(date)) {
        return res.status(409).json({ error: 'That date is already booked. Please choose another one.' });
      }

      const safeType = validEventTypes.includes(type) ? type : 'Wedding';

      try {
        db.run(
          'INSERT INTO bookings (name, email, type, date, notes, status) VALUES (?, ?, ?, ?, ?, ?)',
          [name, email, safeType, date, notes || '', 'Pending']
        );
        logAudit('customer', 'BOOKING_CREATED', `${name} submitted ${safeType} on ${date}`);
        persistDatabase();
        res.json({ success: true });
      } catch (error) {
        res.status(500).json({ error: error.message });
      }
    });

    app.get('/api/events/:id', (req, res) => {
      const eventId = Number(req.params.id);
      if (!Number.isInteger(eventId)) return res.status(400).json({ error: 'Invalid event.' });

      const rows = rowsFromQuery(`
        SELECT b.id, b.name, b.type, b.date, d.venue_name, d.venue_address, d.start_time, d.directions
        FROM bookings b
        LEFT JOIN event_details d ON d.booking_id = b.id
        WHERE b.id = ${eventId} AND b.status = 'Confirmed'
      `);
      if (!rows.length) return res.status(404).json({ error: 'This event invitation is not available.' });
      res.json(rows[0]);
    });

    app.get('/api/admin/guest-events', requireAdmin, async (req, res) => {
      try {
        const events = rowsFromQuery(`
          SELECT b.id, b.name, b.type, b.date, d.venue_name, d.venue_address, d.start_time, d.directions
          FROM bookings b
          LEFT JOIN event_details d ON d.booking_id = b.id
          WHERE b.status = 'Confirmed'
          ORDER BY b.date ASC
        `);
        const guests = rowsFromQuery('SELECT * FROM guest_rsvps ORDER BY booking_id, guest_name');
        const origin = `${req.protocol}://${req.get('host')}`;

        const guestPasses = await Promise.all(guests.map(async (guest) => {
          const checkinUrl = `${origin}/checkin.html?token=${encodeURIComponent(guest.checkin_token)}`;
          return {
            ...guest,
            checkinUrl,
            qrDataUrl: await QRCode.toDataURL(checkinUrl, { width: 240, margin: 2, errorCorrectionLevel: 'M' })
          };
        }));

        res.json(events.map((event) => {
          const eventGuests = guestPasses.filter((guest) => guest.booking_id === event.id);
          const mealCounts = eventGuests.reduce((counts, guest) => {
            counts[guest.meal_choice] = (counts[guest.meal_choice] || 0) + 1;
            return counts;
          }, {});

          return {
            ...event,
            inviteUrl: `${origin}/event.html?id=${event.id}`,
            rsvpCount: eventGuests.length,
            checkedInCount: eventGuests.filter((guest) => guest.checked_in_at).length,
            mealCounts,
            guests: eventGuests
          };
        }));
      } catch (error) {
        console.error('Unable to load guest events:', error);
        res.status(500).json({ error: 'Unable to load guest events.' });
      }
    });

    app.patch('/api/admin/events/:id/details', requireAdmin, (req, res) => {
      const eventId = Number(req.params.id);
      if (!Number.isInteger(eventId)) return res.status(400).json({ error: 'Invalid event.' });

      const event = rowsFromQuery(`SELECT id FROM bookings WHERE id = ${eventId} AND status = 'Confirmed'`);
      if (!event.length) return res.status(404).json({ error: 'Confirmed event not found.' });

      const venueName = sanitizeText(req.body?.venue_name, 120) || 'Venue to be announced';
      const venueAddress = sanitizeText(req.body?.venue_address, 240);
      const startTime = sanitizeText(req.body?.start_time, 20) || '17:00';
      const directions = sanitizeText(req.body?.directions, 500);

      try {
        db.run(`
          INSERT INTO event_details (booking_id, venue_name, venue_address, start_time, directions)
          VALUES (?, ?, ?, ?, ?)
          ON CONFLICT(booking_id) DO UPDATE SET
            venue_name = excluded.venue_name,
            venue_address = excluded.venue_address,
            start_time = excluded.start_time,
            directions = excluded.directions
        `, [eventId, venueName, venueAddress, startTime, directions]);
        persistDatabase();
        logAudit(req.adminUser, 'EVENT_DETAILS_UPDATED', `Event #${eventId} guest page updated`);
        res.json({ success: true });
      } catch (error) {
        console.error('Unable to update event details:', error);
        res.status(500).json({ error: 'Unable to save event details.' });
      }
    });

    app.post('/api/events/:id/rsvp', async (req, res) => {
      const eventId = Number(req.params.id);
      const guestName = sanitizeText(req.body?.name, 100);
      const email = sanitizeText(req.body?.email, 120).toLowerCase();
      const phone = sanitizeText(req.body?.phone, 32);
      const mealChoice = sanitizeText(req.body?.meal_choice, 80);
      const dietaryNeeds = sanitizeText(req.body?.dietary_needs, 400);
      const mealOptions = [
        'Herb-roasted chicken',
        'Seared salmon',
        'Wild mushroom risotto',
        'Braised beef short rib',
        'Roasted vegetable lasagna',
        'Butternut squash gnocchi',
        'Moroccan chickpea tagine (Vegan)',
        'Grilled halloumi with couscous',
        'Garden vegetable quinoa bowl (Vegan, Gluten-free)',
        'Lemon-herb tofu with rice (Vegan, Gluten-free)'
      ];

      if (!Number.isInteger(eventId) || !guestName || !isValidEmail(email) || !phone || !mealOptions.includes(mealChoice)) {
        return res.status(400).json({ error: 'Please provide your name, a valid email, phone number, and meal choice.' });
      }

      const eventRows = rowsFromQuery(`
        SELECT b.id, b.name, b.type, b.date, d.venue_name, d.venue_address, d.start_time
        FROM bookings b LEFT JOIN event_details d ON d.booking_id = b.id
        WHERE b.id = ${eventId} AND b.status = 'Confirmed'
      `);
      if (!eventRows.length) return res.status(404).json({ error: 'This event invitation is not available.' });

      const duplicate = db.prepare('SELECT id FROM guest_rsvps WHERE booking_id = ? AND email = ? LIMIT 1');
      duplicate.bind([eventId, email]);
      const hasRsvped = duplicate.step();
      duplicate.reset();
      if (hasRsvped) return res.status(409).json({ error: 'An RSVP has already been submitted with this email.' });

      try {
        const countRows = rowsFromQuery(`SELECT COUNT(*) AS count FROM guest_rsvps WHERE booking_id = ${eventId}`);
        const tableNumber = Math.floor((countRows[0]?.count || 0) / 8) + 1;
        const checkinToken = crypto.randomBytes(24).toString('hex');
        const origin = `${req.protocol}://${req.get('host')}`;
        const checkinUrl = `${origin}/checkin.html?token=${encodeURIComponent(checkinToken)}`;
        const qrDataUrl = await QRCode.toDataURL(checkinUrl, { width: 360, margin: 3, errorCorrectionLevel: 'M' });

        db.run(`
          INSERT INTO guest_rsvps (booking_id, guest_name, email, phone, meal_choice, dietary_needs, table_number, checkin_token)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `, [eventId, guestName, email, phone, mealChoice, dietaryNeeds, tableNumber, checkinToken]);
        persistDatabase();
        logAudit('guest', 'EVENT_RSVP_SUBMITTED', `${guestName} RSVP'd to event #${eventId}`);

        res.status(201).json({
          success: true,
          guest: { name: guestName, meal_choice: mealChoice, dietary_needs: dietaryNeeds, table_number: tableNumber },
          qrDataUrl,
          checkinUrl
        });
      } catch (error) {
        console.error('Unable to save guest RSVP:', error);
        res.status(500).json({ error: 'Unable to save your RSVP right now.' });
      }
    });

    app.post('/api/check-ins/:token', (req, res) => {
      const token = sanitizeText(req.params.token, 100);
      const stmt = db.prepare(`
        SELECT g.id, g.guest_name, g.meal_choice, g.dietary_needs, g.table_number, g.checked_in_at,
          b.name AS host_name, b.type, b.date
        FROM guest_rsvps g JOIN bookings b ON b.id = g.booking_id
        WHERE g.checkin_token = ? AND b.status = 'Confirmed'
        LIMIT 1
      `);
      stmt.bind([token]);
      if (!stmt.step()) {
        stmt.reset();
        return res.status(404).json({ error: 'This guest pass is invalid or the event is unavailable.' });
      }

      const guest = stmt.getAsObject();
      stmt.reset();
      if (!guest.checked_in_at) {
        db.run("UPDATE guest_rsvps SET checked_in_at = datetime('now') WHERE id = ? AND checked_in_at IS NULL", [guest.id]);
        persistDatabase();
        logAudit('check-in', 'GUEST_ARRIVED', `${guest.guest_name} checked in to ${guest.type} on ${guest.date}`);
      }

      const updated = db.prepare('SELECT checked_in_at FROM guest_rsvps WHERE id = ?');
      updated.bind([guest.id]);
      updated.step();
      guest.checked_in_at = updated.getAsObject().checked_in_at;
      updated.reset();
      res.json(guest);
    });

    app.get('*', (_req, res) => {
      res.sendFile(path.join(__dirname, 'index.html'));
    });

    app.listen(port, () => {
      console.log(`Server running at http://localhost:${port}`);
    });
  })
  .catch((error) => {
    console.error('Failed to initialize database:', error);
    process.exit(1);
  });
