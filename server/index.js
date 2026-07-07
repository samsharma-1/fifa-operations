'use strict';

require('dotenv').config();
const path = require('path');
const express = require('express');

const gates = require('./data/gates.json');
const transport = require('./data/transport.json');
const incidents = require('./data/incidents.json');
const volunteers = require('./data/volunteers.json');

const {
  buildSnapshot,
  recommendGate,
  recommendTransport,
  triageIncidents,
  findNearestVolunteer,
} = require('./decisionEngine');
const { getSystemPrompt } = require('./rolePrompts');
const { callClaude } = require('./llmClient');

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, '..', 'public')));

const VALID_ROLES = ['fan', 'volunteer', 'staff', 'organizer'];

function liveData() {
  // In a real deployment this would read from live stadium sensors /
  // ticketing / transit APIs. Here it's simulated with small random
  // jitter so the dashboard visibly "moves" without external services.
  return {
    gates: gates.map((g) => ({
      ...g,
      currentFlowPerMin: Math.max(
        0,
        Math.min(g.capacityPerMin, g.currentFlowPerMin + Math.round((Math.random() - 0.5) * 10))
      ),
      queueLengthMin: Math.max(0, g.queueLengthMin + Math.round((Math.random() - 0.5) * 3)),
    })),
    transport,
    incidents,
    volunteers,
  };
}

function validateRole(req, res, next) {
  const role = req.body.role || req.query.role;
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }
  next();
}

// --- Dashboard data (no LLM call needed - fast, deterministic) ---
app.get('/api/context/:role', (req, res) => {
  const { role } = req.params;
  if (!VALID_ROLES.includes(role)) {
    return res.status(400).json({ error: `role must be one of: ${VALID_ROLES.join(', ')}` });
  }
  const snapshot = buildSnapshot(role, liveData());
  res.json(snapshot);
});

// --- Direct decision-engine endpoints (used by widgets, also LLM-free) ---
app.get('/api/gate-recommendation', (req, res) => {
  const needsAccessible = req.query.accessible === 'true';
  res.json(recommendGate(liveData().gates, { needsAccessible }));
});

app.get('/api/transport-recommendation', (req, res) => {
  const minutesUntilKickoff = Number(req.query.minutes) || 60;
  res.json(recommendTransport(transport, { minutesUntilKickoff }));
});

app.get('/api/incidents', (req, res) => {
  res.json(triageIncidents(incidents));
});

app.get('/api/nearest-volunteer', (req, res) => {
  const zone = req.query.zone || '';
  res.json(findNearestVolunteer(volunteers, zone));
});

// --- Conversational assistant (grounded LLM call) ---
app.post('/api/chat', validateRole, async (req, res) => {
  const { role, message, language } = req.body;

  if (!message || typeof message !== 'string' || message.trim().length === 0) {
    return res.status(400).json({ error: 'message is required' });
  }
  if (message.length > 2000) {
    return res.status(400).json({ error: 'message too long (max 2000 chars)' });
  }

  try {
    const snapshot = buildSnapshot(role, liveData());
    const systemPrompt = getSystemPrompt(role);
    const languageNote = language ? `\nRespond in: ${language}.` : '';

    const reply = await callClaude({
      systemPrompt: systemPrompt + languageNote,
      userMessage: message,
      contextJson: snapshot,
      model: process.env.ANTHROPIC_MODEL,
      apiKey: process.env.ANTHROPIC_API_KEY,
    });

    res.json({ reply, snapshotUsed: snapshot.timestamp });
  } catch (err) {
    console.error('[chat] error:', err.message);
    res.status(502).json({
      error: 'The assistant is temporarily unavailable. Please try again or ask on-site staff for help.',
    });
  }
});

app.get('/api/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
if (require.main === module) {
  app.listen(PORT, () => console.log(`Smart Stadium Copilot running on http://localhost:${PORT}`));
}

module.exports = app;
