'use strict';

const state = {
  role: 'fan',
  chatHistory: [],
};

const roleTabs = document.querySelectorAll('.role-tab');
const widgetsEl = document.getElementById('widgets');
const gateMarkersEl = document.getElementById('gateMarkers');
const chatLogEl = document.getElementById('chatLog');
const chatFormEl = document.getElementById('chatForm');
const chatInputEl = document.getElementById('chatInput');
const chatStatusEl = document.getElementById('chatStatus');
const langSelectEl = document.getElementById('langSelect');

roleTabs.forEach((tab) => {
  tab.addEventListener('click', () => setRole(tab.dataset.role));
});

function setRole(role) {
  state.role = role;
  roleTabs.forEach((t) => t.setAttribute('aria-selected', String(t.dataset.role === role)));
  loadContext();
  addSystemNote(`Switched to ${capitalize(role)} view. Ask me anything relevant to this role.`);
}

function capitalize(s) {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

async function loadContext() {
  widgetsEl.innerHTML = '<p class="chat-status">Loading live data…</p>';
  try {
    const res = await fetch(`/api/context/${state.role}`);
    if (!res.ok) throw new Error('context fetch failed');
    const data = await res.json();
    renderWidgets(state.role, data);
  } catch (err) {
    widgetsEl.innerHTML = `<p class="chat-status">Could not load live data. Is the server running? (${err.message})</p>`;
  }
}

// --- Gate ring visualization -------------------------------------------------

function gateStatusClass(loadPercent, queueLengthMin) {
  if (loadPercent >= 85 || queueLengthMin >= 18) return 'status-alert';
  if (loadPercent >= 60 || queueLengthMin >= 8) return 'status-watch';
  return 'status-good';
}

async function renderGateRing() {
  // Pull the full gate list via the staff snapshot (always includes gateStatus),
  // regardless of which role is currently selected - the ring is shared context.
  let gates = [];
  let cctv = [];
  try {
    const ctxRes = await fetch(`/api/context/staff`);
    const ctx = await ctxRes.json();
    gates = ctx.gateStatus || [];
    cctv = ctx.cctvIntelligence || [];
  } catch (e) {
    gates = [];
    cctv = [];
  }

  gateMarkersEl.innerHTML = '';
  const cx = 240, cy = 150, rx = 190, ry = 120;
  const n = gates.length || 1;

  gates.forEach((g, i) => {
    const angle = (Math.PI * 2 * i) / n - Math.PI / 2;
    const x = cx + rx * Math.cos(angle);
    const y = cy + ry * Math.sin(angle);
    const loadPercent = Math.round((g.currentFlowPerMin / g.capacityPerMin) * 100);
    const cls = gateStatusClass(loadPercent, g.queueLengthMin);

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', `gate-marker ${cls}`);

    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    circle.setAttribute('cx', x);
    circle.setAttribute('cy', y);
    circle.setAttribute('r', 12);
    group.appendChild(circle);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', x);
    label.setAttribute('y', y - 18);
    label.textContent = g.id.replace('GATE-', '');
    group.appendChild(label);

    const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    titleEl.textContent = `${g.name}: ${loadPercent}% load, ${g.queueLengthMin} min queue`;
    group.appendChild(titleEl);

    gateMarkersEl.appendChild(group);
  });

  // Plot CCTV cameras
  cctv.forEach((c, i) => {
    let x, y;
    if (c.zone.includes('Gate A')) { x = 240; y = 30; }
    else if (c.zone.includes('Concourse')) { x = 240; y = 150; }
    else if (c.zone.includes('Food Court')) { x = 160; y = 150; }
    else if (c.zone.includes('Escalator')) { x = 320; y = 150; }
    else if (c.zone.includes('Fan Zone')) { x = 240; y = 270; }
    else { x = 240 + Math.cos(i) * 50; y = 150 + Math.sin(i) * 50; }

    const cls = c.incident ? 'status-alert' : (c.occupancyPercent >= 75 ? 'status-watch' : 'status-good');

    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g');
    group.setAttribute('class', `cctv-marker ${cls}`);

    const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    rect.setAttribute('x', x - 14);
    rect.setAttribute('y', y - 9);
    rect.setAttribute('width', 28);
    rect.setAttribute('height', 18);
    rect.setAttribute('rx', 4);
    group.appendChild(rect);

    const label = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    label.setAttribute('x', x);
    label.setAttribute('y', y + 3);
    label.textContent = c.id.replace('CAM-', 'C');
    group.appendChild(label);

    const titleEl = document.createElementNS('http://www.w3.org/2000/svg', 'title');
    titleEl.textContent = `CCTV ${c.id} (${c.zone}): ${c.occupancyPercent}% load${c.incident ? ` - ALERT: ${c.incident}` : ''}`;
    group.appendChild(titleEl);

    gateMarkersEl.appendChild(group);
  });
}

// --- Role-specific widgets ---------------------------------------------------

function renderWidgets(role, data) {
  const renderers = { fan: renderFanWidgets, volunteer: renderVolunteerWidgets, staff: renderStaffWidgets, organizer: renderOrganizerWidgets };
  widgetsEl.innerHTML = '';
  (renderers[role] || renderFanWidgets)(data);
}

function card(title, innerHtml) {
  const div = document.createElement('div');
  div.className = 'widget-card';
  div.innerHTML = `<h3>${title}</h3>${innerHtml}`;
  return div;
}

function severityBadge(sev) {
  return `<span class="badge badge-${sev}">${sev}</span>`;
}

function renderFanWidgets(data) {
  const g = data.suggestedGate || {};
  const rec = g.recommendation;
  widgetsEl.appendChild(
    card(
      'Best gate for you',
      rec
        ? `<p><strong>${rec.name}</strong></p><p>${g.reason}</p>${g.alternativeAvoid ? `<p>Avoid: ${g.alternativeAvoid.name} (busy right now).</p>` : ''}`
        : '<p>No gate data available right now.</p>'
    )
  );

  const t = data.transportOptions || {};
  widgetsEl.appendChild(
    card(
      'Getting here',
      t.best
        ? `<p>Fastest option: <strong>${t.best.label}</strong> — ~${t.best.etaMin} min</p><ul>${(t.allOptions || [])
            .slice(0, 4)
            .map((o) => `<li>${o.label}: ~${o.etaMin} min</li>`)
            .join('')}</ul>`
        : '<p>No transport data available.</p>'
    )
  );

  widgetsEl.appendChild(
    card(
      'Live alerts near you',
      (data.crowdAlerts || []).length
        ? `<ul>${data.crowdAlerts.map((a) => `<li>${a.name} — ${a.loadPercent}% busy</li>`).join('')}</ul>`
        : '<p>No congestion alerts right now — enjoy the match!</p>'
    )
  );
}

function renderVolunteerWidgets(data) {
  widgetsEl.appendChild(
    card(
      'Zones needing support',
      (data.myZoneLoad || []).length
        ? `<ul>${data.myZoneLoad.map((a) => `<li>${a.name}: ${a.suggestedAction}</li>`).join('')}</ul>`
        : '<p>All zones nominal right now.</p>'
    )
  );

  widgetsEl.appendChild(
    card(
      'Volunteer roster',
      `<ul>${(data.openTasks || [])
        .map((v) => `<li>${v.name} — ${v.role} (${v.zone}) · ${v.tasksOpen} open task(s)</li>`)
        .join('')}</ul>`
    )
  );

  widgetsEl.appendChild(
    card(
      'Active incidents to be aware of',
      (data.incidents || [])
        .map((i) => `<p>${severityBadge(i.severity)} ${i.type.replace('_', ' ')} — ${i.location}</p>`)
        .join('') || '<p>No active incidents.</p>'
    )
  );
}

function renderStaffWidgets(data) {
  widgetsEl.appendChild(
    card(
      'Triaged incidents',
      (data.triagedIncidents || [])
        .map(
          (i) =>
            `<p>${severityBadge(i.severity)} <strong>${i.type.replace('_', ' ')}</strong> — ${i.location} (${i.reportedMinAgo} min ago)${
              i.escalate ? ' — <em>escalate</em>' : ''
            }</p>`
        )
        .join('') || '<p>No active incidents.</p>'
    )
  );

  widgetsEl.appendChild(
    card(
      'Gate status',
      `<ul>${(data.gateStatus || [])
        .map((g) => `<li>${g.name}: ${Math.round((g.currentFlowPerMin / g.capacityPerMin) * 100)}% load, queue ${g.queueLengthMin} min</li>`)
        .join('')}</ul>`
    )
  );

  widgetsEl.appendChild(
    card(
      'Live CCTV Intelligence',
      (data.cctvIntelligence || [])
        .map(
          (c) =>
            `<p><strong>${c.zone} (${c.id})</strong>: ${c.peopleCount} people (${c.occupancyPercent}% load) ${c.incident ? `— ${severityBadge(c.severity)} <em>${c.incident}</em>` : ''}</p>`
        )
        .join('') || '<p>No CCTV data available.</p>'
    )
  );
}

function renderOrganizerWidgets(data) {
  const k = data.kpis || {};
  widgetsEl.appendChild(
    card(
      'Operational KPIs',
      `<p>Gates over threshold: <strong>${k.gatesOverThreshold ?? '—'}</strong></p>
       <p>Open high-severity incidents: <strong>${k.openHighSeverityIncidents ?? '—'}</strong></p>
       <p>Open volunteer tasks: <strong>${k.totalOpenVolunteerTasks ?? '—'}</strong></p>`
    )
  );

  widgetsEl.appendChild(
    card(
      'Incident overview',
      (data.triagedIncidents || [])
        .slice(0, 5)
        .map((i) => `<p>${severityBadge(i.severity)} ${i.type.replace('_', ' ')} — ${i.location}</p>`)
        .join('') || '<p>No active incidents.</p>'
    )
  );

  widgetsEl.appendChild(
    card(
      'Computer Vision Alerts',
      (data.cctvAlerts || [])
        .map((c) => `<p>${severityBadge(c.severity)} <strong>${c.incident}</strong> detected at ${c.zone} (${c.id})</p>`)
        .join('') || '<p>No active AI alerts.</p>'
    )
  );
}

// --- Chat ---------------------------------------------------------------

function addMessage(role, text) {
  const div = document.createElement('div');
  div.className = `msg msg-${role}`;
  div.textContent = text;
  chatLogEl.appendChild(div);
  chatLogEl.scrollTop = chatLogEl.scrollHeight;
}

function addSystemNote(text) {
  addMessage('bot', text);
}

chatFormEl.addEventListener('submit', async (e) => {
  e.preventDefault();
  const message = chatInputEl.value.trim();
  if (!message) return;

  addMessage('user', message);
  chatInputEl.value = '';
  chatInputEl.disabled = true;
  chatFormEl.querySelector('button').disabled = true;
  chatStatusEl.textContent = 'Stadium Copilot is thinking…';

  try {
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: state.role, message, language: langSelectEl.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || 'Something went wrong');
    addMessage('bot', data.reply);
    chatStatusEl.textContent = '';
  } catch (err) {
    addMessage('error', err.message);
    chatStatusEl.textContent = 'There was a problem reaching the assistant.';
  } finally {
    chatInputEl.disabled = false;
    chatFormEl.querySelector('button').disabled = false;
    chatInputEl.focus();
  }
});

// --- Init -----------------------------------------------------------------

renderGateRing();
loadContext();
addSystemNote(
  'Welcome to Stadium Copilot. Pick a role above, then ask me about gates, transport, tasks, or incidents.'
);

// Refresh live data periodically to simulate real-time updates
setInterval(() => {
  renderGateRing();
  loadContext();
}, 20000);
