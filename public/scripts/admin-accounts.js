function $(sel) {
  return document.querySelector(sel);
}

function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') node.className = v;
    else if (k === 'text') node.textContent = v;
    else if (k.startsWith('data-')) node.setAttribute(k, v);
    else if (k in node) node[k] = v;
    else node.setAttribute(k, v);
  }
  for (const child of children) node.appendChild(child);
  return node;
}

function getAdminToken() {
  return localStorage.getItem('adm_token') || '';
}

let cachedAccounts = [];

async function fetchAccounts() {
  const token = getAdminToken();
  if (!token) throw new Error('Not logged in (missing adm_token).');

  const res = await fetch('/api/accounts', {
    headers: { Authorization: `Bearer ${token}` },
  });

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }

  if (!res.ok) throw new Error(data.error || 'Failed to load accounts.');
  return data.accounts || [];
}

async function patchAccount(id, patch) {
  const token = getAdminToken();
  if (!token) throw new Error('Not logged in (missing adm_token).');

  const res = await fetch(`/api/accounts/${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(patch || {}),
  });

  const text = await res.text();
  let data = {};
  try { data = text ? JSON.parse(text) : {}; } catch { data = {}; }
  if (!res.ok) throw new Error(data.error || 'Failed to save account.');
  return data.account;
}

function field(labelText, value, { type = 'text', multiline = false } = {}) {
  const id = `f_${Math.random().toString(16).slice(2)}`;
  const label = el('label', { class: 'form__label', htmlFor: id, text: labelText });

  const input = multiline
    ? el('textarea', { id, class: 'input input--fill', value: value || '', rows: 3 })
    : el('input', { id, class: 'input input--fill', type, value: value || '' });

  const wrapper = el('div', { class: 'form__field' }, [label, input]);
  return { wrapper, input };
}

function renderEditableAccounts(output, accounts) {
  output.innerHTML = '';
  output.classList.add('accounts-grid');

  if (!accounts.length) {
    output.appendChild(el('div', { text: 'No accounts found.' }));
    return;
  }

  for (const account of accounts) {
    const title = el('h4', {
      class: 'account-card__title',
      text: `${account.company || ''}${account.company ? ' — ' : ''}${account.name || ''}`.trim() || account.id,
    });

    const companyF = field('Company', account.company || '');
    const nameF = field('Contact Name', account.name || account.contactName || '');
    const emailF = field('Email', account.email || '', { type: 'email' });
    const phoneF = field('Phone', account.phone || '', { type: 'tel' });
    const addressF = field('Address', account.address || '');
    const cityF = field('City', account.city || '');
    const stateF = field('State', account.state || '');
    const zipF = field('Zip', account.zip || '');
    const notesF = field('Notes', account.notes || '', { multiline: true });

    const status = el('span', { text: '' });
    const saveBtn = el('button', { class: 'button button--primary button--sm', type: 'button', text: 'Save' });

    saveBtn.addEventListener('click', async () => {
      saveBtn.disabled = true;
      status.textContent = 'Saving...';
      try {
        const patch = {
          company: companyF.input.value.trim(),
          name: nameF.input.value.trim(),
          email: emailF.input.value.trim(),
          phone: phoneF.input.value.trim(),
          address: addressF.input.value.trim(),
          city: cityF.input.value.trim(),
          state: stateF.input.value.trim(),
          zip: zipF.input.value.trim(),
          notes: notesF.input.value,
        };
        await patchAccount(account.id, patch);
        status.textContent = 'Saved.';
      } catch (err) {
        status.textContent = `Error: ${err.message}`;
      } finally {
        saveBtn.disabled = false;
      }
    });

    const actions = el('div', { class: 'dialog__actions' }, [status, saveBtn]);

    const fields = el('div', { class: 'form__fields' }, [
      title,
      companyF.wrapper,
      nameF.wrapper,
      emailF.wrapper,
      phoneF.wrapper,
      addressF.wrapper,
      cityF.wrapper,
      stateF.wrapper,
      zipF.wrapper,
      notesF.wrapper,
    ]);

    const editor = el('div', { class: 'account-card__content' }, [fields, actions]);

    const card = el('div', { class: 'account-card' }, [editor]);
    output.appendChild(card);
  }
}

function accountLabel(a) {
  const left = (a.company || '').trim();
  const right = (a.name || a.contactName || '').trim();
  const label = `${left}${left && right ? ' — ' : ''}${right}`.trim();
  return label || a.id;
}

function filteredAccountsBySearch(accounts, query) {
  const q = (query || '').trim().toLowerCase();
  if (!q) return accounts;
  return accounts.filter(a => {
    const hay = [a.company, a.name, a.contactName, a.email, a.phone, a.city, a.state, a.zip, a.address, a.id]
      .filter(Boolean)
      .join(' ')
      .toLowerCase();
    return hay.includes(q);
  });
}

function populateAccountSelect(selectEl, accounts, { selectedValue } = {}) {
  const keep = selectedValue ?? selectEl.value;
  selectEl.innerHTML = '';

  selectEl.appendChild(el('option', { value: '', text: 'Select an account…' }));
  selectEl.appendChild(el('option', { value: 'all', text: 'All accounts' }));

  for (const a of accounts) {
    selectEl.appendChild(el('option', { value: a.id, text: accountLabel(a) }));
  }

  // Restore selection if still available.
  const values = new Set(Array.from(selectEl.options).map(o => o.value));
  selectEl.value = values.has(keep) ? keep : '';
}

function renderSelection() {
  const output = $('#accountsOutput');
  const selectEl = $('#accountSelect');
  const searchEl = $('#accountSearch');
  if (!output || !selectEl || !searchEl) return;

  const visible = filteredAccountsBySearch(cachedAccounts, searchEl.value);
  const selected = selectEl.value;

  if (selected === 'all') {
    renderEditableAccounts(output, visible);
    return;
  }

  if (!selected) {
    output.classList.add('accounts-grid');
    output.innerHTML = '';
    output.appendChild(el('div', { text: 'Select an account from the dropdown (or choose All accounts).' }));
    return;
  }

  const account = cachedAccounts.find(a => a.id === selected);
  if (!account) {
    output.classList.add('accounts-grid');
    output.innerHTML = '';
    output.appendChild(el('div', { text: 'Account not found.' }));
    return;
  }

  // Respect search: if the selected account isn't in the filtered set, show a hint.
  if (!visible.some(a => a.id === account.id)) {
    output.classList.add('accounts-grid');
    output.innerHTML = '';
    output.appendChild(el('div', { text: 'Selected account is filtered out by the current search.' }));
    return;
  }

  renderEditableAccounts(output, [account]);
}

async function showAccountsPanel() {
  const panel = $('#accountsPanel');
  const output = $('#accountsOutput');
  const searchEl = $('#accountSearch');
  const selectEl = $('#accountSelect');

  if (!panel || !output || !searchEl || !selectEl) {
    throw new Error('Missing accounts panel elements in admin.html');
  }

  panel.hidden = false;
  output.textContent = 'Loading accounts...';

  cachedAccounts = await fetchAccounts();

  // Initial dropdown population (unfiltered).
  populateAccountSelect(selectEl, cachedAccounts, { selectedValue: '' });
  // Default to "no selection" so we don't show everything at once.
  selectEl.value = '';
  searchEl.value = '';
  renderSelection();

  // Wire interactions.
  if (!selectEl.dataset.bound) {
    selectEl.addEventListener('change', () => {
      renderSelection();
    });
    selectEl.dataset.bound = '1';
  }

  if (!searchEl.dataset.bound) {
    searchEl.addEventListener('input', () => {
      const filtered = filteredAccountsBySearch(searchEl.value);
      if (filtered.length === 0) {
        selectEl.value = "";
      } else {
        selectEl.value = "all";
      }
      renderSelection();
    });
    searchEl.dataset.bound = '1';
  }

  // Smooth-scroll to the accounts section after it renders.
  requestAnimationFrame(() => {
    panel.scrollIntoView({ behavior: 'smooth', block: 'start' });
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = $('.account-button');
  if (!btn) return;

  btn.addEventListener('click', async () => {
    try {
      await showAccountsPanel();
    } catch (err) {
      alert(err.message);
    }
  });
});