// 1. Core State Array Storage Engine
let databaseBookings = [];

let currentSelectedRole = null;
let currentStatusFilter = 'all';
let currentCalendarMonth = new Date();
let bookedEventDates = new Set();
let currentGuestEvents = [];
let currentSessionToken = '';
let staffQrScanner = null;
let staffScanInProgress = false;

// Pricing Lookup Matrix (for calculation dynamics)
const pricingMatrix = {
  "Wedding": 12500,
  "Gala": 18000,
  "Soiree": 6200
};

// 2. Role Gate Navigation Functions
function selectRole(role) {
  currentSelectedRole = role;
  document.getElementById('gateGuest').classList.remove('selected');
  document.getElementById('gateAdmin').classList.remove('selected');
  
  if(role === 'guest') document.getElementById('gateGuest').classList.add('selected');
  if(role === 'admin') document.getElementById('gateAdmin').classList.add('selected');
  
  let btn = document.getElementById('gateEnter');
  btn.classList.add('ready');
}

function proceedGate() {
  if(!currentSelectedRole) return;
  document.getElementById('roleGate').style.display = 'none';
  
  if(currentSelectedRole === 'guest') {
    document.getElementById('customerSite').style.display = 'block';
    document.getElementById('adminDashboard').style.display = 'none';
    document.getElementById('adminLogin').style.display = 'none';
  } else {
    document.getElementById('adminLogin').style.display = 'flex';
  }
}

function backGate() {
  document.getElementById('adminLogin').style.display = 'none';
  document.getElementById('roleGate').style.display = 'flex';
}

function logOut() {
  if (currentSessionToken) {
    fetch('/api/auth/logout', {
      method: 'POST',
      headers: { Authorization: `Bearer ${currentSessionToken}` }
    }).catch(() => {});
  }
  document.getElementById('customerSite').style.display = 'none';
  document.getElementById('adminDashboard').style.display = 'none';
  document.getElementById('adminLogin').style.display = 'none';
  document.getElementById('roleGate').style.display = 'flex';
  currentSelectedRole = null;
  currentUser = { username: '', role: 'guest' };
  currentSessionToken = '';
  document.getElementById('gateGuest').classList.remove('selected');
  document.getElementById('gateAdmin').classList.remove('selected');
  document.getElementById('gateEnter').classList.remove('ready');
}

// 3. Admin Authentication Logic
let currentUser = { username: '', role: 'guest' };

async function doLogin() {
  const u = document.getElementById('lUser').value.trim();
  const p = document.getElementById('lPass').value;

  if (!u || !p || p.length < 3) {
    document.getElementById('lErr').style.display = 'block';
    return;
  }

  try {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: u, password: p })
    });

    const result = await response.json();
    if (!response.ok || !result.success) throw new Error(result.error || 'Login failed');

    currentUser = result.user || { username: u, role: 'admin' };
    currentSessionToken = result.token || '';
    document.getElementById('adminLogin').style.display = 'none';
    document.getElementById('adminDashboard').style.display = 'block';
    document.getElementById('lErr').style.display = 'none';
    await refreshAdminViews();
  } catch (error) {
    console.error(error);
    document.getElementById('lErr').style.display = 'block';
  }
}

// 4. Admin Dashboard Controls
function switchPage(pageId) {
  const pages = document.querySelectorAll('.ad-page');
  pages.forEach(p => p.classList.remove('active'));
  
  const navItems = document.querySelectorAll('.ad-nav-item');
  navItems.forEach(n => n.classList.remove('active'));

  const targetPage = document.getElementById('page-' + pageId);
  if (targetPage) targetPage.classList.add('active');
  const targetNav = document.getElementById('nav-' + pageId);
  if(targetNav) targetNav.classList.add('active');

  if(pageId === 'sqlView') {
    loadSqlQuery('schema', document.querySelector('.q-chip'));
  }
  if(pageId === 'guestExperience') loadGuestExperience();
}

function getStatusBadgeClass(status) {
  if (status === 'Confirmed') return 'b-confirmed';
  if (status === 'Declined') return 'b-declined';
  return 'b-pending';
}

function renderBookingsTable() {
  const tbody = document.getElementById('bookingsTableBody');
  if (!tbody) return;
  tbody.innerHTML = '';

  const visibleBookings = currentStatusFilter === 'all'
    ? databaseBookings
    : databaseBookings.filter(item => item.status === currentStatusFilter);

  if (!visibleBookings.length) {
    tbody.innerHTML = `<tr><td colspan="6" style="text-align:center;color:var(--muted);">No ${currentStatusFilter === 'all' ? 'requests' : currentStatusFilter.toLowerCase()} found.</td></tr>`;
    return;
  }

  visibleBookings.forEach(item => {
    const tr = document.createElement('tr');
    const badgeClass = getStatusBadgeClass(item.status);
    const actionsHtml = item.status === 'Pending'
      ? `<button class="ra" onclick="updateBookingStatus(${item.id}, 'Confirmed')">Accept</button> <button class="ra" onclick="updateBookingStatus(${item.id}, 'Declined')">Decline</button>`
      : `<button class="ra" onclick="openDrawer(${item.id})">Inspect</button>`;

    tr.innerHTML = `
      <td><strong>${item.name}</strong></td>
      <td>${item.email}</td>
      <td>${item.type}</td>
      <td>${item.date}</td>
      <td><span class="badge ${badgeClass}">${item.status.toUpperCase()}</span></td>
      <td>${actionsHtml}</td>
    `;
    tbody.appendChild(tr);
  });
}

function formatMoney(value) {
  return `R${Number(value || 0).toLocaleString('en-ZA')}`;
}

function setTrendElement(element, value, suffix = '%') {
  if (!element) return;
  const isPositive = value >= 0;
  element.textContent = `${isPositive ? '↑' : '↓'} ${Math.abs(value).toFixed(1)}${suffix} vs last month`;
  element.style.color = isPositive ? '#2d5a32' : '#8e2d3c';
}

function renderOverviewStats(analytics) {
  const pendingEl = document.getElementById('statPendingCount');
  const confirmedEl = document.getElementById('statConfirmedCount');
  const revenueEl = document.getElementById('statRevenue');
  const conversionEl = document.getElementById('statConversion');

  if (pendingEl) pendingEl.textContent = String(analytics.pendingCount || 0);
  if (confirmedEl) confirmedEl.textContent = String(analytics.confirmedCount || 0);
  if (revenueEl) revenueEl.textContent = formatMoney(analytics.totalRevenue || 0);
  if (conversionEl) conversionEl.textContent = `${analytics.conversionRate || 0}%`;

  setTrendElement(document.getElementById('pendingTrend'), analytics.pendingCount > 0 ? 8.4 : 0, '%');
  setTrendElement(document.getElementById('confirmedTrend'), analytics.confirmedCount > 0 ? 14.2 : 0, '%');
  setTrendElement(document.getElementById('revenueTrend'), Number(analytics.revenueTrend || 0), '%');
  setTrendElement(document.getElementById('conversionTrend'), Number(analytics.conversionRate || 0), '%');
}

function renderRevenueChart(data) {
  const chart = document.getElementById('revenueChart');
  if (!chart || !data?.monthlySeries?.length) return;

  const maxValue = Math.max(...data.monthlySeries.map(item => item.value), 1);
  chart.innerHTML = data.monthlySeries.map((item) => {
    const height = Math.max((item.value / maxValue) * 100, 6);
    return `
      <div class="bar-col">
        <div class="bar" style="height:${height}%"></div>
        <div class="bar-lbl">${item.label}</div>
      </div>
    `;
  }).join('');
}

function renderTypeChart(data) {
  const donut = document.getElementById('typeDonut');
  const list = document.getElementById('typeList');
  if (!donut || !list) return;

  const entries = Object.entries(data?.typeBreakdown || {});
  const total = entries.reduce((sum, [, count]) => sum + count, 0) || 1;
  const palette = ['#c96b8a', '#d7a55e', '#7a9e7e', '#6c8fe0', '#d58f79', '#9d7ad6', '#7ca3b8', '#c7b98f'];

  let current = 0;
  const gradientParts = entries.map(([label, count], index) => {
    const start = current;
    current += (count / total) * 100;
    return `${palette[index % palette.length]} ${start}% ${current}%`;
  });

  donut.style.background = `conic-gradient(${gradientParts.join(', ')})`;
  donut.innerHTML = '<span>' + total + '</span>';

  list.innerHTML = entries.map(([label, count], index) => `
    <div class="type-item">
      <span><i style="background:${palette[index % palette.length]}"></i>${label}</span>
      <strong>${count}</strong>
    </div>
  `).join('');
}

async function renderAuditLog() {
  const table = document.getElementById('activityTableBody');
  if (!table) return;

  try {
    const response = await fetch('/api/audit');
    if (!response.ok) throw new Error('Unable to load audit log');
    const rows = await response.json();

    if (!rows.length) {
      table.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);">No activity entries yet.</td></tr>';
      return;
    }

    table.innerHTML = rows.map((row) => `
      <tr>
        <td>${new Date(row.created_at).toLocaleString()}</td>
        <td>${row.actor}</td>
        <td>${row.action}</td>
        <td>${row.details || '—'}</td>
      </tr>
    `).join('');
  } catch (error) {
    console.error(error);
    table.innerHTML = '<tr><td colspan="4" style="text-align:center;color:var(--muted);">Unable to load audit entries.</td></tr>';
  }
}

async function loadDashboardAnalytics() {
  try {
    const response = await fetch('/api/analytics');
    if (!response.ok) throw new Error('Unable to load analytics');
    const data = await response.json();
    renderOverviewStats(data);
    renderRevenueChart(data);
    renderTypeChart(data);
  } catch (error) {
    console.error(error);
  }
}

async function refreshAdminViews() {
  await loadBookingsFromServer();
  await loadDashboardAnalytics();
  await renderAuditLog();
  await loadGuestExperience();
}

function escapeGuestHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, (character) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

function formatGuestEventDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, {
    weekday: 'short', month: 'short', day: 'numeric', year: 'numeric'
  });
}

function renderAttendanceChart(events) {
  const chart = document.getElementById('attendanceChart');
  if (!chart) return;
  const withRsvps = events.filter((event) => event.rsvpCount > 0);
  if (!withRsvps.length) {
    chart.innerHTML = '<p class="guest-empty">Attendance will appear once guests RSVP.</p>';
    return;
  }

  chart.innerHTML = withRsvps.map((event) => {
    const percent = Math.round((event.checkedInCount / event.rsvpCount) * 100);
    return `
      <div class="attendance-row">
        <div class="attendance-event"><strong>${escapeGuestHtml(event.type)}</strong><span>${formatGuestEventDate(event.date)}</span></div>
        <div class="attendance-track" role="img" aria-label="${percent}% of RSVPs checked in"><span style="width:${percent}%"></span></div>
        <strong class="attendance-count">${event.checkedInCount}<span> / ${event.rsvpCount}</span></strong>
      </div>
    `;
  }).join('');
}

function renderGuestEvents(events) {
  const grid = document.getElementById('guestEventGrid');
  if (!grid) return;

  const totalRsvps = events.reduce((sum, event) => sum + event.rsvpCount, 0);
  const totalArrivals = events.reduce((sum, event) => sum + event.checkedInCount, 0);
  const dietaryCount = events.reduce((sum, event) => sum + event.guests.filter((guest) => guest.dietary_needs).length, 0);
  document.getElementById('passportEventCount').textContent = String(events.length);
  document.getElementById('passportRsvpCount').textContent = String(totalRsvps);
  document.getElementById('passportArrivals').textContent = String(totalArrivals);
  document.getElementById('passportDietaryCount').textContent = String(dietaryCount);

  if (!events.length) {
    grid.innerHTML = '<div class="ad-panel guest-empty-panel"><p class="guest-empty">Confirmed events will appear here when they are ready for invitations.</p></div>';
    return;
  }

  grid.innerHTML = events.map((event) => {
    const guestsMarkup = event.guests.length
      ? `<div class="guest-pass-list">${event.guests.map((guest) => {
        const message = `Hi ${guest.guest_name}, a little reminder about ${event.type} on ${formatGuestEventDate(event.date)} at ${event.venue_name}, ${event.start_time}. Your table is ${guest.table_number}. We look forward to seeing you!`;
        const whatsapp = `https://wa.me/${String(guest.phone).replace(/\\D/g, '')}?text=${encodeURIComponent(message)}`;
        return `
          <article class="guest-pass-row">
            <img src="${guest.qrDataUrl}" alt="${escapeGuestHtml(guest.guest_name)}'s check-in QR pass" loading="lazy"/>
            <div class="guest-pass-info">
              <strong>${escapeGuestHtml(guest.guest_name)}</strong>
              <span>Table ${guest.table_number} · ${escapeGuestHtml(guest.meal_choice)}</span>
              ${guest.dietary_needs ? `<span class="guest-dietary-flag">CATERING · ${escapeGuestHtml(guest.dietary_needs)}</span>` : ''}
            </div>
            <span class="guest-arrival ${guest.checked_in_at ? 'arrived' : ''}">${guest.checked_in_at ? 'Arrived' : 'Expected'}</span>
            <a class="guest-reminder" href="${whatsapp}" target="_blank" rel="noreferrer" aria-label="Send WhatsApp reminder to ${escapeGuestHtml(guest.guest_name)}" title="Open WhatsApp reminder">WhatsApp ↗</a>
          </article>
        `;
      }).join('')}</div>`
      : '<p class="guest-empty guest-empty-inline">No RSVPs yet. Share the event invitation to start the guest list.</p>';

    const mealSummary = Object.entries(event.mealCounts).map(([meal, count]) => `${escapeGuestHtml(meal)} · ${count}`).join('  /  ') || 'No meal selections yet';
    return `
      <article class="ad-panel guest-event-card">
        <header class="guest-event-heading">
          <div><p class="invite-eyebrow invite-eyebrow-dark">${escapeGuestHtml(event.type)} · ${formatGuestEventDate(event.date)}</p><h2>${escapeGuestHtml(event.name)}'s celebration</h2></div>
          <div class="guest-event-actions"><a class="guest-link-button" href="/event.html?id=${event.id}" target="_blank" rel="noreferrer">Open guest page ↗</a><button type="button" class="guest-copy-button" onclick="copyGuestInvite(${event.id})">Copy invite link</button></div>
        </header>
        <div class="guest-event-summary"><span><strong>${event.rsvpCount}</strong> attending</span><span><strong>${event.checkedInCount}</strong> checked in</span><span class="guest-meal-summary">${mealSummary}</span></div>
        <form class="guest-event-settings" onsubmit="saveGuestEventDetails(event, ${event.id})">
          <label>Venue<input name="venue_name" maxlength="120" value="${escapeGuestHtml(event.venue_name || '')}"/></label>
          <label>Address<input name="venue_address" maxlength="240" value="${escapeGuestHtml(event.venue_address || '')}" placeholder="Street, suburb, city"/></label>
          <label>Start time<input name="start_time" type="time" value="${escapeGuestHtml(event.start_time || '17:00')}"/></label>
          <label>Arrival notes<textarea name="directions" maxlength="500" rows="2" placeholder="Parking, entrance, or arrival details">${escapeGuestHtml(event.directions || '')}</textarea></label>
          <button type="submit" class="guest-save-button">Save event details</button>
        </form>
        <div class="guest-catering-line"><span>MEAL COUNTS</span><strong>${mealSummary}</strong></div>
        <div class="guest-list-heading"><h3>Guest passports</h3><span>Each QR pass is personal and records one arrival</span></div>
        ${guestsMarkup}
      </article>
    `;
  }).join('');
}

async function loadGuestExperience() {
  const grid = document.getElementById('guestEventGrid');
  if (!grid) return;
  try {
    const response = await fetch('/api/admin/guest-events', {
      headers: { Authorization: `Bearer ${currentSessionToken}` }
    });
    if (!response.ok) throw new Error('Unable to load guest events');
    currentGuestEvents = await response.json();
    if (!grid.querySelector('.guest-event-settings:focus-within')) {
      renderGuestEvents(currentGuestEvents);
      renderAttendanceChart(currentGuestEvents);
    }
    const updated = document.getElementById('attendanceUpdated');
    if (updated) updated.textContent = `Updated ${new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} · refreshes every 15 seconds`;
  } catch (error) {
    console.error(error);
    grid.innerHTML = '<p class="guest-empty">Guest experience data is unavailable right now.</p>';
  }
}

async function saveGuestEventDetails(event, eventId) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  const button = form.querySelector('button[type="submit"]');
  button.disabled = true;
  button.textContent = 'Saving...';

  try {
    const response = await fetch(`/api/admin/events/${eventId}/details`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${currentSessionToken}` },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to save event details.');
    button.blur();
    await loadGuestExperience();
  } catch (error) {
    alert(error.message);
    button.disabled = false;
    button.textContent = 'Save event details';
  }
}

async function copyGuestInvite(eventId) {
  const inviteUrl = `${window.location.origin}/event.html?id=${eventId}`;
  try {
    await navigator.clipboard.writeText(inviteUrl);
    alert('Guest invitation link copied.');
  } catch (error) {
    window.prompt('Copy this guest invitation link:', inviteUrl);
  }
}

function showScannerStatus(message, isError = false) {
  const status = document.getElementById('scannerStatus');
  if (!status) return;
  status.textContent = message;
  status.classList.toggle('error', isError);
}

async function startStaffScanner() {
  if (staffQrScanner) return;
  const startButton = document.getElementById('startScanner');
  const stopButton = document.getElementById('stopScanner');
  const cameraSelect = document.getElementById('cameraSelect');
  startButton.disabled = true;
  showScannerStatus('Requesting camera access...');

  try {
    const preferredCameraId = cameraSelect.value;
    if (navigator.permissions?.query) {
      try {
        const cameraPermission = await navigator.permissions.query({ name: 'camera' });
        if (cameraPermission.state === 'denied') {
          throw new Error('Camera access is blocked for this site. Use the camera icon beside the address bar, allow camera access for localhost, then reload this page.');
        }
      } catch (error) {
        if (error.message.includes('Camera access is blocked')) throw error;
      }
    }

    const cameras = await Html5Qrcode.getCameras();
    if (!cameras.length) throw new Error('No camera was found. Connect a camera or use a phone to scan the guest pass.');

    cameraSelect.replaceChildren(...cameras.map((camera, index) => {
      const option = document.createElement('option');
      option.value = camera.id;
      option.textContent = camera.label || `Camera ${index + 1}`;
      return option;
    }));
    cameraSelect.value = cameras.some((camera) => camera.id === preferredCameraId)
      ? preferredCameraId
      : cameras[0].id;

    staffQrScanner = new Html5Qrcode('staffQrReader', {
      formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
    });
    await staffQrScanner.start(
      cameraSelect.value,
      { fps: 18, videoConstraints: { width: { ideal: 1280 }, height: { ideal: 720 } } },
      handleStaffQrScan,
      () => {}
    );
    stopButton.disabled = false;
    cameraSelect.disabled = false;
    showScannerStatus('Camera is on. Hold a guest QR pass in front of it.');
  } catch (error) {
    staffQrScanner = null;
    startButton.disabled = false;
    stopButton.disabled = true;
    showScannerStatus(error.message || 'Could not start the camera. Check browser camera permissions.', true);
  }
}

async function stopStaffScanner() {
  if (staffQrScanner) {
    try {
      await staffQrScanner.stop();
      await staffQrScanner.clear();
    } catch (error) {
      console.warn('Scanner stopped:', error.message);
    }
    staffQrScanner = null;
  }

  const startButton = document.getElementById('startScanner');
  const stopButton = document.getElementById('stopScanner');
  const cameraSelect = document.getElementById('cameraSelect');
  if (startButton) startButton.disabled = false;
  if (stopButton) stopButton.disabled = true;
  if (cameraSelect) cameraSelect.disabled = false;
}

async function changeStaffCamera() {
  if (!staffQrScanner) return;
  await stopStaffScanner();
  await startStaffScanner();
}

async function handleStaffQrScan(decodedText) {
  if (staffScanInProgress) return;
  staffScanInProgress = true;
  showScannerStatus('Pass found. Confirming guest...');

  try {
    let token = decodedText.trim();
    try {
      token = new URL(token, window.location.origin).searchParams.get('token') || token;
    } catch (error) {
      token = decodedText.trim();
    }
    if (!/^[a-f0-9]{48}$/i.test(token)) throw new Error('That QR code is not an EventZone guest pass.');

    const response = await fetch(`/api/check-ins/${encodeURIComponent(token)}`, { method: 'POST' });
    const guest = await response.json();
    if (!response.ok) throw new Error(guest.error || 'This guest pass could not be verified.');

    document.getElementById('staffGuestName').textContent = guest.guest_name;
    document.getElementById('staffEventInfo').textContent = `${guest.type} · ${formatGuestEventDate(guest.date)} · Hosted by ${guest.host_name}`;
    document.getElementById('staffTable').textContent = `Table ${guest.table_number}`;
    document.getElementById('staffMeal').textContent = guest.meal_choice;
    document.getElementById('staffDietary').textContent = guest.dietary_needs || '';
    document.getElementById('staffDietaryRow').hidden = !guest.dietary_needs;
    document.getElementById('staffCheckinTime').textContent = `Arrival recorded at ${new Date(`${guest.checked_in_at.replace(' ', 'T')}Z`).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
    document.getElementById('staffCheckinResult').hidden = false;
    showScannerStatus('Guest checked in successfully.');
    await stopStaffScanner();
  } catch (error) {
    showScannerStatus(error.message, true);
    await stopStaffScanner();
  } finally {
    staffScanInProgress = false;
  }
}

async function scanStaffQrImage(file) {
  if (!file || staffScanInProgress) return;
  await stopStaffScanner();
  showScannerStatus('Reading QR code from the selected photo...');

  const imageScanner = new Html5Qrcode('staffQrReader', {
    formatsToSupport: [Html5QrcodeSupportedFormats.QR_CODE]
  });

  try {
    const decodedText = await imageScanner.scanFile(file, false);
    await handleStaffQrScan(decodedText);
  } catch (error) {
    showScannerStatus('Could not read a QR code from that photo. Try a clearer image or use the camera.', true);
  } finally {
    try { imageScanner.clear(); } catch {}
    const fileInput = document.getElementById('qrImageFile');
    if (fileInput) fileInput.value = '';
  }
}

async function loadBookingsFromServer() {
  try {
    const response = await fetch('/api/bookings');
    if (!response.ok) throw new Error('Unable to load bookings');
    const rows = await response.json();
    databaseBookings = rows;
    syncBookedDatesFromBookings();
    renderBookingsTable();
    renderCalendar();
  } catch (error) {
    console.error(error);
  }
}

async function updateBookingStatus(id, status) {
  try {
    const response = await fetch(`/api/bookings/${id}/status`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status })
    });

    if (!response.ok) throw new Error('Unable to update booking status');
    await loadBookingsFromServer();
  } catch (error) {
    console.error(error);
    alert('Unable to update the request status right now.');
  }
}

function setStatusFilter(status, chipElement) {
  currentStatusFilter = status;
  document.querySelectorAll('.booking-filter-chip').forEach(c => c.classList.remove('active'));
  if (chipElement) chipElement.classList.add('active');
  renderBookingsTable();
}

function restoreBookedDates() {
  const stored = localStorage.getItem('eventzone-booked-dates');
  if (!stored) return;

  stored.split(',').filter(Boolean).forEach(date => bookedEventDates.add(date));
}

function saveBookedDates() {
  localStorage.setItem('eventzone-booked-dates', Array.from(bookedEventDates).join(','));
}

function syncBookedDatesFromBookings() {
  const nextBookedDates = new Set(bookedEventDates);

  databaseBookings.forEach(booking => {
    if (!booking.date || booking.status === 'Declined') return;
    const normalized = booking.date.split('T')[0];
    if (normalized) nextBookedDates.add(normalized);
  });

  bookedEventDates = nextBookedDates;
  saveBookedDates();
}

function formatDateKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function renderCalendar() {
  const monthLabel = document.getElementById('calendarMonthLabel');
  if (monthLabel) {
    monthLabel.textContent = currentCalendarMonth.toLocaleString('en', { month: 'long', year: 'numeric' });
  }

  const grid = document.getElementById('calendarGrid');
  if (!grid) return;

  const year = currentCalendarMonth.getFullYear();
  const month = currentCalendarMonth.getMonth();
  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startOffset = (firstDay.getDay() + 6) % 7;
  const totalCells = Math.ceil((startOffset + lastDay.getDate()) / 7) * 7;

  grid.innerHTML = '';

  for (let i = 0; i < totalCells; i += 1) {
    const dayNumber = i - startOffset + 1;
    const date = new Date(year, month, dayNumber);
    const isCurrentMonth = date.getMonth() === month;
    const dateKey = formatDateKey(date);
    const isBooked = bookedEventDates.has(dateKey);

    const dayButton = document.createElement('button');
    dayButton.className = `cal-day${isCurrentMonth ? '' : ' muted'}${isBooked ? ' booked' : ''}`;
    dayButton.textContent = date.getDate();
    dayButton.type = 'button';

    if (isCurrentMonth) {
      dayButton.onclick = () => {
        if (bookedEventDates.has(dateKey)) {
          bookedEventDates.delete(dateKey);
        } else {
          bookedEventDates.add(dateKey);
        }
        saveBookedDates();
        renderCalendar();
      };
    }

    grid.appendChild(dayButton);
  }
}

function changeCalendarMonth(step) {
  currentCalendarMonth = new Date(currentCalendarMonth.getFullYear(), currentCalendarMonth.getMonth() + step, 1);
  renderCalendar();
}

// 5. Drawer Modal Functions
function openDrawer(id) {
  const item = databaseBookings.find(b => b.id === id);
  if(!item) return;

  document.getElementById('drawerTitle').innerText = item.name;
  document.getElementById('drawerEmail').innerText = item.email;
  document.getElementById('drawerType').innerText = item.type;
  document.getElementById('drawerDate').innerText = item.date;
  document.getElementById('drawerNotes').innerText = item.notes || "No notes attached.";
  
  const statusBadge = document.getElementById('drawerStatus');
  statusBadge.innerText = item.status.toUpperCase();
  statusBadge.className = `badge ${getStatusBadgeClass(item.status)}`;

  document.getElementById('drawer').classList.add('open');
}

function closeDrawer() {
  document.getElementById('drawer').classList.remove('open');
}

// 6. SQL Query Viewer
const sqlQueries = {
  schema: `CREATE TABLE IF NOT EXISTS events (\n  id INT PRIMARY KEY AUTO_INCREMENT,\n  client_name VARCHAR(255) NOT NULL,\n  email VARCHAR(255) NOT NULL,\n  event_type VARCHAR(50) NOT NULL,\n  target_date DATE NOT NULL,\n  notes TEXT,\n  status VARCHAR(20) DEFAULT 'Pending',\n  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP\n);`,
  analytics: `SELECT \n  event_type,\n  COUNT(*) AS total_reservations,\n  SUM(CASE \n    WHEN event_type = 'Wedding' THEN 12500\n    WHEN event_type = 'Gala' THEN 18000\n    WHEN event_type = 'Soiree' THEN 6200\n    ELSE 0\n  END) AS estimated_revenue_zar\nFROM events\nGROUP BY event_type;`,
  filter: `SELECT * FROM events\nWHERE status = 'Pending'\nORDER BY target_date ASC;`
};

function loadSqlQuery(type, chipElement) {
  if(chipElement) {
    document.querySelectorAll('.q-chip').forEach(c => c.classList.remove('active'));
    chipElement.classList.add('active');
  }
  document.getElementById('sqlOutputBlock').innerText = sqlQueries[type] || 'Select query from chips above.';
}

async function checkDateAvailability(date) {
  if (!date) return true;

  try {
    const response = await fetch(`/api/bookings/availability?date=${encodeURIComponent(date)}`);
    const result = await response.json();
    return result.available !== false;
  } catch (error) {
    console.error(error);
    return true;
  }
}

// 7. Customer Booking Form Handling
async function submitBookingForm() {
  const name = document.getElementById('formName').value;
  const email = document.getElementById('formEmail').value;
  const type = document.getElementById('formType').value;
  const date = document.getElementById('formDate').value;
  const notes = document.getElementById('formNotes').value;

  if(!name || !email || !date) {
    alert("Please complete all required fields (Name, Email, and Target Date).");
    return;
  }

  const dateAvailable = await checkDateAvailability(date);
  if (!dateAvailable) {
    alert('That date is already booked. Please choose another one.');
    return;
  }

  try {
    const response = await fetch('/api/bookings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, email, type, date, notes })
    });

    const result = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(result.error || 'Booking could not be saved');
    }

    await loadBookingsFromServer();
    document.getElementById('bookingFormContainer').style.display = 'none';
    document.getElementById('bookingSuccessMessage').style.display = 'block';
  } catch (error) {
    console.error(error);
    alert(error.message || 'Unable to save your booking right now.');
  }
}

// Navbar Scroll Effect
window.addEventListener('scroll', () => {
  const nav = document.getElementById('custNav');
  if(window.scrollY > 50) {
    nav.classList.add('scrolled');
  } else {
    nav.classList.remove('scrolled');
  }
});

window.addEventListener('DOMContentLoaded', () => {
  restoreBookedDates();
  renderCalendar();
  loadBookingsFromServer();
  document.getElementById('startScanner')?.addEventListener('click', startStaffScanner);
  document.getElementById('stopScanner')?.addEventListener('click', stopStaffScanner);
  document.getElementById('cameraSelect')?.addEventListener('change', changeStaffCamera);
  document.getElementById('scanNextGuest')?.addEventListener('click', () => {
    document.getElementById('staffCheckinResult').hidden = true;
    showScannerStatus('Ready for the next guest. Start the camera to scan another pass.');
  });
  document.getElementById('qrImageFile')?.addEventListener('change', (event) => {
    scanStaffQrImage(event.target.files?.[0]);
  });
  window.setInterval(() => {
    const dashboard = document.getElementById('adminDashboard');
    const guestPage = document.getElementById('page-guestExperience');
    if (dashboard && dashboard.style.display !== 'none' && guestPage?.classList.contains('active')) {
      loadGuestExperience();
    }
  }, 15000);

  const slides = document.querySelectorAll('.hero-slide');
  if (slides.length) {
    let currentSlide = 0;
    setInterval(() => {
      slides[currentSlide].classList.remove('active');
      currentSlide = (currentSlide + 1) % slides.length;
      slides[currentSlide].classList.add('active');
    }, 4000);
  }

  const showcaseSlides = document.querySelectorAll('.showcase-slide');
  const showcaseDots = document.querySelectorAll('.showcase-dot');
  const prevBtn = document.querySelector('.showcase-prev');
  const nextBtn = document.querySelector('.showcase-next');

  if (showcaseSlides.length) {
    let showcaseIndex = 0;
    const renderShowcaseSlide = (index) => {
      showcaseSlides.forEach((slide, i) => {
        slide.classList.toggle('active', i === index);
      });
      showcaseDots.forEach((dot, i) => {
        dot.classList.toggle('active', i === index);
      });
    };

    const goToShowcaseSlide = (nextIndex) => {
      showcaseIndex = (nextIndex + showcaseSlides.length) % showcaseSlides.length;
      renderShowcaseSlide(showcaseIndex);
    };

    prevBtn?.addEventListener('click', () => goToShowcaseSlide(showcaseIndex - 1));
    nextBtn?.addEventListener('click', () => goToShowcaseSlide(showcaseIndex + 1));

    showcaseDots.forEach((dot, index) => {
      dot.addEventListener('click', () => goToShowcaseSlide(index));
    });

    setInterval(() => {
      goToShowcaseSlide(showcaseIndex + 1);
    }, 4200);
  }
});