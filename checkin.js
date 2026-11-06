const checkinToken = new URLSearchParams(window.location.search).get('token');

async function confirmArrival() {
  if (!checkinToken) throw new Error('This QR pass is missing its check-in code.');

  const response = await fetch(`/api/check-ins/${encodeURIComponent(checkinToken)}`, { method: 'POST' });
  const guest = await response.json();
  if (!response.ok) throw new Error(guest.error || 'This guest pass could not be verified.');

  document.getElementById('checkinTitle').textContent = `Welcome, ${guest.guest_name}.`;
  document.getElementById('checkinMessage').textContent = 'Your arrival has been recorded. Enjoy the celebration.';
  document.getElementById('checkinEvent').textContent = `${guest.type} · ${guest.date}`;
  document.getElementById('checkinTable').textContent = `Table ${guest.table_number}`;
  document.getElementById('checkinMeal').textContent = guest.meal_choice;
  document.getElementById('checkinDetails').hidden = false;

  if (guest.dietary_needs) {
    document.getElementById('checkinDietary').textContent = guest.dietary_needs;
    document.getElementById('dietaryAlert').hidden = false;
  }
}

confirmArrival().catch((error) => {
  document.getElementById('checkinTitle').textContent = 'Pass not recognised';
  document.getElementById('checkinMessage').textContent = error.message;
});