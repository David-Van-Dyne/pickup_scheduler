function getAdminToken() {
  return localStorage.getItem('adm_token') || '';
}

function isAppointmentEvent(ev) {
  return Boolean(ev && ev.source === 'appointment' && typeof ev.appointmentId === 'string');
}

function loadEventsFromLocalStorage() {
  const raw = localStorage.getItem('events');
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((ev) => {
        if (!ev || !ev.date) return null;
        return { ...ev, date: new Date(ev.date) };
      })
      .filter(Boolean);
  } catch {
    return [];
  }
}

function saveEventsToLocalStorage(events) {
  const serializable = events.map((ev) => ({
    ...ev,
    date: ev.date instanceof Date ? ev.date.toISOString() : ev.date,
  }));
  localStorage.setItem('events', JSON.stringify(serializable));
}

function hashStringToInt32(value) {
  // djb2
  let hash = 5381;
  for (let i = 0; i < value.length; i++) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  // force 32-bit
  return hash | 0;
}

function clampMinutes(value) {
  if (value < 0) return 0;
  if (value > 1440) return 1440;
  return value;
}

function extractMeridiem(value) {
  const v = String(value || '').toUpperCase();
  if (/(\b|\s)AM\b/.test(v)) return 'AM';
  if (/(\b|\s)PM\b/.test(v)) return 'PM';
  return null;
}

function parseClockToMinutes(value, defaultMeridiem) {
  let v = String(value || '').toUpperCase().trim();
  const meridiem = extractMeridiem(v) || defaultMeridiem;
  if (!meridiem) return null;

  v = v.replace(/\s*(AM|PM)\s*$/i, '').trim();
  if (!v) return null;

  const [hRaw, mRaw] = v.split(':');
  const hour = Number.parseInt(hRaw, 10);
  const minute = mRaw ? Number.parseInt(mRaw, 10) : 0;

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (minute < 0 || minute > 59) return null;

  let h = hour;
  if (h < 1 || h > 12) return null;
  if (meridiem === 'AM' && h === 12) h = 0;
  if (meridiem === 'PM' && h !== 12) h += 12;

  return (h * 60) + minute;
}

function timeWindowToMinutesRange(timeWindow) {
  const tw = String(timeWindow || '').trim();
  const parts = tw.split('-');
  if (parts.length !== 2) return null;

  const startPart = parts[0].trim();
  const endPart = parts[1].trim();

  const endMeridiem = extractMeridiem(endPart);
  const startMeridiem = extractMeridiem(startPart) || endMeridiem;
  if (!endMeridiem) return null;

  const startTime = parseClockToMinutes(startPart, startMeridiem);
  const endTime = parseClockToMinutes(endPart, endMeridiem);
  if (startTime === null || endTime === null) return null;

  return {
    startTime: clampMinutes(startTime),
    endTime: clampMinutes(endTime),
  };
}

function appointmentToEvent(apt) {
  const appointmentId = String(apt?.id || '').trim();
  const dateStr = String(apt?.date || '').trim();
  if (!appointmentId || !dateStr) return null;

  const minutesRange = timeWindowToMinutesRange(apt?.timeWindow);
  const startTime = minutesRange?.startTime ?? 0;
  const endTime = minutesRange?.endTime ?? 1440;

  // Use a stable negative numeric id to avoid breaking the event edit form (it parses ids as int).
  const stable = hashStringToInt32(appointmentId);
  const id = -Math.abs(stable || 1);

  const companyName = String(apt?.companyName || '').trim();
  const address = String(apt?.address || '').trim();
  const name = String(apt?.name || '').trim();
  const timeWindow = String(apt?.timeWindow || '').trim();
  const title = [timeWindow, companyName, address].filter(Boolean).join(' - ') || 'Appointment';

  return {
    id,
    title,
    date: new Date(`${dateStr}T00:00:00`),
    startTime,
    endTime,
    color: '#ef4444',
    source: 'appointment',
    appointmentId,
  };
}

async function syncAppointmentsIntoCalendar() {
  const token = getAdminToken();
  if (!token) return;

  const res = await fetch('/api/appointments', {
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });

  if (!res.ok) return;

  const data = await res.json().catch(() => ({}));
  const appointments = Array.isArray(data?.appointments) ? data.appointments : [];

  const appointmentEvents = appointments
    .filter((a) => a && a.status !== 'cancelled')
    .map(appointmentToEvent)
    .filter(Boolean);

  const existing = loadEventsFromLocalStorage();
  const nonAppointments = existing.filter((ev) => !isAppointmentEvent(ev));

  saveEventsToLocalStorage([...nonAppointments, ...appointmentEvents]);

  document.dispatchEvent(new CustomEvent('events-change', { bubbles: true }));
}

async function editAppointmentFromCalendar(appointmentEvent) {
  const token = getAdminToken();
  if (!token) {
    alert('Admin session missing. Please log in again.');
    return;
  }

  const appointmentId = appointmentEvent.appointmentId;

  // Ask user for new values (press Cancel to abort)
  const companyName = prompt('Company Name:', '');
  if (companyName === null) return;

  const address = prompt('Pickup Address:', '');
  if (address === null) return;

  const date = prompt('Date (YYYY-MM-DD):', '');
  if (date === null) return;

  const timeWindow = prompt('Time Window (optional, exact like "8-11 AM"):', '');
  if (timeWindow === null) return;

  const tiresCount = prompt('Number of tires:', '');
  if (tiresCount === null) return;

  const notes = prompt('Notes:', '');
  if (notes === null) return;

  const patch = {
    companyName: companyName.trim(),
    address: address.trim(),
    date: date.trim(),
    timeWindow: timeWindow.trim(),
    tiresCount: tiresCount.trim(),
    notes: notes.trim(),
  };

  const res = await fetch(`/api/appointments/${encodeURIComponent(appointmentId)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(patch),
  });

  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    alert(data.error || 'Failed to update appointment.');
    return;
  }

  // Re-pull from server so titles/date/time refresh correctly
  await syncAppointmentsIntoCalendar();
}

function enableAppointmentEditing() {
  document.addEventListener(
    'event-edit-request',
    async (e) => {
      const ev = e?.detail?.event;
      const token = getAdminToken();

      if (isAppointmentEvent(ev) && token) {
        
      }

      if (!isAppointmentEvent(ev)) return;
        
      e.stopImmediatePropagation();
      const appointmentId = ev.appointmentId;
      await fetch(`/api/appointments/${encodeURIComponent(ev.appointmentId)}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${token}`,
        },
      });

      // e.stopPropagation();

      editAppointmentFromCalendar(ev).catch((err) => {
        console.warn('[appointment-calendar-sync] edit failed', err);
        alert('Failed to update appointment.');
      });
    },
    true
  );
}

// Run on import.
enableAppointmentEditing();
syncAppointmentsIntoCalendar().catch((err) => {
  console.warn('[appointment-calendar-sync] failed', err);
});
