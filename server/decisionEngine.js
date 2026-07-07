'use strict';

/**
 * Decision Engine
 * ----------------
 * Pure, deterministic, testable functions that turn raw "live" stadium
 * data into operational recommendations. The LLM is used to explain /
 * phrase these recommendations naturally and multilingually - it never
 * invents the underlying facts. This keeps the assistant grounded,
 * auditable, and cheap to run (most simple queries never need to hit
 * the LLM at all).
 */

const CROWD_BUSY_THRESHOLD = 0.85; // flow/capacity ratio considered "busy"
const QUEUE_ALERT_MIN = 12; // minutes of queue considered worth flagging
const INCIDENT_ESCALATE_SEVERITY = ['high'];

function gateLoadRatio(gate) {
  if (!gate.capacityPerMin) return 0;
  return gate.currentFlowPerMin / gate.capacityPerMin;
}

/**
 * Recommend the best entry gate for a fan, optionally requiring accessibility.
 */
function recommendGate(gates, { needsAccessible = false } = {}) {
  const candidates = gates.filter(
    (g) => g.status === 'open' && (!needsAccessible || g.accessible)
  );
  if (candidates.length === 0) {
    return { recommendation: null, reason: 'No open gates match the requirements right now.' };
  }
  const scored = candidates
    .map((g) => ({ gate: g, load: gateLoadRatio(g), queue: g.queueLengthMin }))
    .sort((a, b) => a.queue - b.queue || a.load - b.load);

  const best = scored[0];
  const busiest = [...scored].sort((a, b) => b.load - a.load)[0];

  return {
    recommendation: best.gate,
    alternativeAvoid: busiest.load >= CROWD_BUSY_THRESHOLD ? busiest.gate : null,
    reason:
      best.queue <= QUEUE_ALERT_MIN
        ? `${best.gate.name} has the shortest wait (~${best.queue} min).`
        : `All gates are busy; ${best.gate.name} is currently the least congested (~${best.queue} min wait).`,
  };
}

/**
 * Flag gates that need crowd-management attention (for staff/organizers).
 */
function getCrowdAlerts(gates) {
  return gates
    .filter((g) => gateLoadRatio(g) >= CROWD_BUSY_THRESHOLD || g.queueLengthMin >= QUEUE_ALERT_MIN)
    .map((g) => ({
      gateId: g.id,
      name: g.name,
      loadPercent: Math.round(gateLoadRatio(g) * 100),
      queueLengthMin: g.queueLengthMin,
      suggestedAction:
        gateLoadRatio(g) >= CROWD_BUSY_THRESHOLD
          ? 'Open overflow lane / redirect fans to a lower-load gate'
          : 'Monitor - queue building but flow still nominal',
    }));
}

/**
 * Recommend a transport option based on how much time the fan has.
 */
function recommendTransport(transport, { minutesUntilKickoff = 60 } = {}) {
  const options = [];

  transport.metro.forEach((m) =>
    options.push({ mode: 'metro', label: `${m.line} (${m.nearestStation})`, etaMin: m.etaMin, crowdLevel: m.crowdLevel })
  );
  transport.shuttle.forEach((s) =>
    options.push({ mode: 'shuttle', label: s.route, etaMin: s.etaMin, seatsAvailable: s.seatsAvailable })
  );

  const viable = options.filter((o) => o.etaMin < minutesUntilKickoff);
  viable.sort((a, b) => a.etaMin - b.etaMin);

  return {
    best: viable[0] || null,
    allOptions: options,
    urgent: minutesUntilKickoff <= 20,
  };
}

/**
 * Rank open incidents for staff triage: severity first, then recency.
 */
function triageIncidents(incidents) {
  const severityRank = { high: 3, medium: 2, low: 1 };
  return [...incidents]
    .filter((i) => i.status !== 'resolved')
    .sort((a, b) => {
      const sevDiff = (severityRank[b.severity] || 0) - (severityRank[a.severity] || 0);
      if (sevDiff !== 0) return sevDiff;
      return a.reportedMinAgo - b.reportedMinAgo;
    })
    .map((i) => ({
      ...i,
      escalate: INCIDENT_ESCALATE_SEVERITY.includes(i.severity),
    }));
}

/**
 * Suggest the nearest available volunteer for a given zone.
 */
function findNearestVolunteer(volunteers, zone) {
  const inZone = volunteers.filter((v) => v.zone.toLowerCase() === String(zone).toLowerCase());
  const pool = inZone.length > 0 ? inZone : volunteers;
  const sorted = [...pool].sort((a, b) => a.tasksOpen - b.tasksOpen);
  return sorted[0] || null;
}

/**
 * Build a compact operational snapshot for a given role.
 * This is what gets fed to the LLM as grounding context, and also what
 * powers the dashboard widgets directly (no LLM call needed for the UI).
 */
function buildSnapshot(role, data) {
  const { gates, transport, incidents, volunteers } = data;
  const base = {
    role,
    timestamp: new Date().toISOString(),
    crowdAlerts: getCrowdAlerts(gates),
    incidents: triageIncidents(incidents).slice(0, 5),
  };

  switch (role) {
    case 'fan':
      return {
        ...base,
        suggestedGate: recommendGate(gates, {}),
        transportOptions: recommendTransport(transport, {}),
      };
    case 'volunteer':
      return {
        ...base,
        myZoneLoad: getCrowdAlerts(gates),
        openTasks: volunteers,
      };
    case 'staff':
      return {
        ...base,
        gateStatus: gates,
        triagedIncidents: triageIncidents(incidents),
      };
    case 'organizer':
      return {
        ...base,
        gateStatus: gates,
        transport,
        triagedIncidents: triageIncidents(incidents),
        volunteers,
        kpis: {
          gatesOverThreshold: getCrowdAlerts(gates).length,
          openHighSeverityIncidents: incidents.filter((i) => i.severity === 'high' && i.status !== 'resolved').length,
          totalOpenVolunteerTasks: volunteers.reduce((sum, v) => sum + v.tasksOpen, 0),
        },
      };
    default:
      return base;
  }
}

module.exports = {
  recommendGate,
  getCrowdAlerts,
  recommendTransport,
  triageIncidents,
  findNearestVolunteer,
  buildSnapshot,
  CROWD_BUSY_THRESHOLD,
  QUEUE_ALERT_MIN,
};
