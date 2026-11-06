const eventId = new URLSearchParams(window.location.search).get('id');
const rsvpForm = document.getElementById('rsvpForm');
const rsvpError = document.getElementById('rsvpError');
const rsvpSubmit = document.getElementById('rsvpSubmit');

const eventImages = {
  Wedding: 'https://images.unsplash.com/photo-1519225421980-715cb0215aed?auto=format&fit=crop&w=1800&q=85',
  Gala: 'https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1800&q=85',
  Soiree: 'https://images.unsplash.com/photo-1465495976277-4387d4b0b4c6?auto=format&fit=crop&w=1800&q=85',
  Birthday: 'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1800&q=85',
  Corporate: 'https://images.unsplash.com/photo-1520854221256-17451cc331bf?auto=format&fit=crop&w=1800&q=85'
};

function displayDate(value) {
  const date = new Date(`${value}T12:00:00`);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
}

async function loadEvent() {
  if (!eventId || !/^\d+$/.test(eventId)) throw new Error('This invitation link is not valid.');
  const response = await fetch(`/api/events/${eventId}`);
  const event = await response.json();
  if (!response.ok) throw new Error(event.error || 'This invitation is not available.');

  document.title = `${event.type} Invitation | EventZone`;
  document.getElementById('eventHero').src = eventImages[event.type] || eventImages.Wedding;
  document.getElementById('eventTitle').textContent = `${event.type} celebration`;
  document.getElementById('eventHost').textContent = `Celebrating with ${event.name}`;
  document.getElementById('eventDate').textContent = displayDate(event.date);
  document.getElementById('eventTime').textContent = event.start_time || '';
  document.getElementById('eventVenue').textContent = event.venue_name || 'Venue to be announced';
  document.getElementById('eventAddress').textContent = event.venue_address || '';
  document.getElementById('eventDirections').textContent = event.directions || '';
  const reminderMessage = `Hi EventZone, please send me a WhatsApp reminder for the ${event.type} on ${displayDate(event.date)}.`;
  document.getElementById('whatsappReminder').href = `https://wa.me/27812345678?text=${encodeURIComponent(reminderMessage)}`;

  if (event.venue_address) {
    const directionsLink = document.getElementById('directionsLink');
    directionsLink.href = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(event.venue_address)}`;
    directionsLink.hidden = false;
  }
}

rsvpForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  rsvpError.hidden = true;
  rsvpSubmit.disabled = true;
  rsvpSubmit.textContent = 'Saving your RSVP...';

  const formData = new FormData(rsvpForm);
  const payload = Object.fromEntries(formData.entries());

  try {
    const response = await fetch(`/api/events/${eventId}/rsvp`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || 'Unable to save your RSVP.');

    document.getElementById('passGreeting').textContent = `You're on the list, ${result.guest.name}.`;
    document.getElementById('passQr').src = result.qrDataUrl;
    document.getElementById('passTable').textContent = result.guest.table_number;
    document.getElementById('passMeal').textContent = result.guest.meal_choice;
    document.getElementById('passDietary').textContent = result.guest.dietary_needs
      ? `Catering note: ${result.guest.dietary_needs}`
      : 'No dietary notes added';
    rsvpForm.hidden = true;
    document.getElementById('guestPass').hidden = false;
    document.getElementById('guestPass').scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (error) {
    rsvpError.textContent = error.message;
    rsvpError.hidden = false;
    rsvpSubmit.disabled = false;
    rsvpSubmit.innerHTML = 'Send my RSVP <span aria-hidden="true">↗</span>';
  }
});

loadEvent().catch((error) => {
  document.getElementById('eventTitle').textContent = 'Invitation unavailable';
  document.getElementById('eventHost').textContent = error.message;
  rsvpForm.hidden = true;
});