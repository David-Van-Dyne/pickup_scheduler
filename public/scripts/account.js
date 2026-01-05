function $(sel) {
  return document.querySelector(sel);
}

async function request(path, { method = 'GET', body } = {}) {
  const res = await fetch(path, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });

  const text = await res.text();
  let data = {};
  try {
    data = text ? JSON.parse(text) : {};
  } catch {
    data = { raw: text };
  }

  if (!res.ok) throw new Error(data.error || `${method} ${path} failed`);
  return data;
}

document.addEventListener('DOMContentLoaded', () => {
  const form = $('.form-account');
  const saveButton = $('#save-account');

  if (!form || !saveButton) return;

  const getValue = (name) => {
    const input = form.querySelector(`[name="${name}"]`);
    return (input?.value || '').trim();
  };

  async function saveAccount() {
    const payload = {
      company: getValue('company'),
      contactName: getValue('contact-name'),
      email: getValue('email'),
      phone: getValue('phone'),
      address: getValue('address'),
      city: getValue('city'),
      state: getValue('state'),
      zip: getValue('zip'),
    };

    if (
      !payload.company ||
      !payload.contactName ||
      !payload.phone ||
      !payload.address ||
      !payload.city ||
      !payload.state ||
      !payload.zip
    ) {
      alert('Please fill out: Company, Contact Name, Phone, Address, City, State, and Zip.');
      return;
    }

    saveButton.disabled = true;
    try {
      await request('/api/public/accounts', { method: 'POST', body: payload });
      alert('Account saved!');
      form.reset();
    } catch (err) {
      alert(err.message);
    } finally {
      saveButton.disabled = false;
    }
  }

  // Button is outside the <form> in the current HTML, so we handle click.
  saveButton.addEventListener('click', (e) => {
    e.preventDefault();
    saveAccount();
  });

  // Also handle Enter key submit if the user triggers a form submit.
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    saveAccount();
  });
});


