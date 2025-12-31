async function getConfig() {
  const res = await fetch('/api/config');
  if (!res.ok) throw new Error('Failed to load config');
  return res.json();
}

function setMinDate(input) {
  const today = new Date();
  const yyyy = today.getFullYear();
  const mm = String(today.getMonth() + 1).padStart(2, '0');
  const dd = String(today.getDate() + 1).padStart(2, '0'); // earliest next-day
  input.min = `${yyyy}-${mm}-${dd}`;
}

function disableBlackouts(input, blackoutDates) {
  // Basic UX: show note; real disabling varies by browser
  if (!blackoutDates || blackoutDates.length === 0) return;
  input.addEventListener('change', () => {
    if (blackoutDates.includes(input.value)) {
      alert('Selected date is unavailable. Please choose another date.');
      input.value = '';
    }
  });
}

function formToJson(form) {
  const data = new FormData(form);
  return Object.fromEntries(data.entries());
}

function showStatus(msg, cls) {
  const el = document.getElementById('status');
  const btn = document.getElementById('submitBtn');
  const btnText = document.getElementById('btnText');

  el.textContent = msg;
  el.className = cls || '';

  if (cls === 'loading') {
    btn.disabled = true;
    btnText.textContent = '⏳ Processing...';
    btn.classList.add('loading');
  } else {
    btn.disabled = false;
    btnText.textContent = '� Schedule Tire Pickup';
    btn.classList.remove('loading');
  }
}

async function submitAppointment(evt) {
  evt.preventDefault();
  const form = evt.currentTarget;
  const payload = formToJson(form);

  showStatus('⏳ Submitting your pickup request...', 'loading');

  try {
    const res = await fetch('/api/appointments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Request failed');

    form.reset();
    showStatus(`✅ Success! Your confirmation number is ${data.confirmation}. We'll contact you soon!`, 'success');

    // Auto-clear success message after 10 seconds
    setTimeout(() => {
      showStatus('', '');
    }, 10000);

  } catch (e) {
    showStatus(`❌ ${e.message}`, 'error');
  }
}

(async function init() {
  try {
    showStatus('⏳ Loading pickup scheduler...', 'loading');

    const cfg = await getConfig();

    // Only update elements that exist
    const brandEl = document.getElementById('brand');
    if (brandEl) {
      brandEl.textContent = cfg.businessName || 'Used Tire Pickup';
    }

    const hotlineEl = document.getElementById('hotline');
    if (hotlineEl && cfg.businessPhone) {
      hotlineEl.textContent = `Questions? Call ${cfg.businessPhone}`;
    }

    // Update phone link if it exists
    const phoneLink = document.getElementById('phoneLink');
    if (phoneLink && cfg.businessPhone) {
      phoneLink.href = `tel:${cfg.businessPhone}`;
      phoneLink.textContent = cfg.businessPhone;
    }

    const tw = document.getElementById('timeWindow');
    if (tw) {
      // Clear existing options except the placeholder
      tw.innerHTML = '<option value="">Select a time window</option>';

      (cfg.timeWindows || []).forEach(w => {
        const opt = document.createElement('option');
        opt.value = w;
        opt.textContent = w;
        tw.appendChild(opt);
      });
    }

    const date = document.getElementById('date');
    if (date) {
      setMinDate(date);
      disableBlackouts(date, cfg.blackoutDates || []);
    }

    const form = document.getElementById('apptForm');
    if (form) {
      form.addEventListener('submit', submitAppointment);
    }

    showStatus('✅ Ready to schedule your pickup!', 'success');
    setTimeout(() => showStatus('', ''), 3000);

  } catch (e) {
    showStatus('❌ Failed to initialize page. Please refresh and try again.', 'error');
    console.error('Initialization error:', e);
  }
})();

