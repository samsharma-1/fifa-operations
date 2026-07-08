'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  recommendGate,
  getCrowdAlerts,
  recommendTransport,
  triageIncidents,
  findNearestVolunteer,
  processCCTVFeed,
} = require('../decisionEngine');

const gatesFixture = [
  { id: 'G1', name: 'Gate 1', capacityPerMin: 100, currentFlowPerMin: 95, queueLengthMin: 20, accessible: true, status: 'open' },
  { id: 'G2', name: 'Gate 2', capacityPerMin: 100, currentFlowPerMin: 20, queueLengthMin: 2, accessible: false, status: 'open' },
  { id: 'G3', name: 'Gate 3', capacityPerMin: 50, currentFlowPerMin: 10, queueLengthMin: 1, accessible: true, status: 'closed' },
];

test('recommendGate picks the shortest-queue open gate', () => {
  const result = recommendGate(gatesFixture, {});
  assert.equal(result.recommendation.id, 'G2');
});

test('recommendGate respects accessibility requirement', () => {
  const result = recommendGate(gatesFixture, { needsAccessible: true });
  // G3 is accessible but closed, so only G1 qualifies
  assert.equal(result.recommendation.id, 'G1');
});

test('recommendGate returns null when nothing matches', () => {
  const closedOnly = [{ id: 'GX', name: 'X', capacityPerMin: 10, currentFlowPerMin: 1, queueLengthMin: 1, accessible: true, status: 'closed' }];
  const result = recommendGate(closedOnly, {});
  assert.equal(result.recommendation, null);
});

test('getCrowdAlerts flags gates over the busy threshold', () => {
  const alerts = getCrowdAlerts(gatesFixture);
  const ids = alerts.map((a) => a.gateId);
  assert.ok(ids.includes('G1'));
  assert.ok(!ids.includes('G2'));
});

test('recommendTransport filters out options slower than time available', () => {
  const transportFixture = {
    metro: [{ line: 'L1', nearestStation: 'S1', etaMin: 5, crowdLevel: 'low' }],
    shuttle: [{ route: 'R1', etaMin: 90, seatsAvailable: 5 }],
  };
  const result = recommendTransport(transportFixture, { minutesUntilKickoff: 30 });
  assert.equal(result.best.label.includes('L1'), true);
});

test('recommendTransport flags urgency when time is short', () => {
  const transportFixture = { metro: [], shuttle: [] };
  const result = recommendTransport(transportFixture, { minutesUntilKickoff: 10 });
  assert.equal(result.urgent, true);
});

test('triageIncidents sorts high severity first, then most recent', () => {
  const incidentsFixture = [
    { id: 'A', type: 'x', location: 'l', severity: 'low', status: 'open', reportedMinAgo: 1 },
    { id: 'B', type: 'x', location: 'l', severity: 'high', status: 'open', reportedMinAgo: 5 },
    { id: 'C', type: 'x', location: 'l', severity: 'high', status: 'open', reportedMinAgo: 1 },
  ];
  const sorted = triageIncidents(incidentsFixture);
  assert.deepEqual(sorted.map((i) => i.id), ['C', 'B', 'A']);
  assert.equal(sorted[0].escalate, true);
  assert.equal(sorted[2].escalate, false);
});

test('triageIncidents excludes resolved incidents', () => {
  const incidentsFixture = [
    { id: 'A', type: 'x', location: 'l', severity: 'high', status: 'resolved', reportedMinAgo: 1 },
  ];
  const sorted = triageIncidents(incidentsFixture);
  assert.equal(sorted.length, 0);
});

test('findNearestVolunteer prefers same zone and fewer open tasks', () => {
  const volunteersFixture = [
    { id: 'V1', name: 'A', role: 'r', zone: 'Gate A', shiftEnd: '18:00', tasksOpen: 3 },
    { id: 'V2', name: 'B', role: 'r', zone: 'Gate A', shiftEnd: '18:00', tasksOpen: 1 },
    { id: 'V3', name: 'C', role: 'r', zone: 'Gate B', shiftEnd: '18:00', tasksOpen: 0 },
  ];
  const result = findNearestVolunteer(volunteersFixture, 'Gate A');
  assert.equal(result.id, 'V2');
});

test('findNearestVolunteer falls back to full pool if zone has no match', () => {
  const volunteersFixture = [
    { id: 'V1', name: 'A', role: 'r', zone: 'Gate A', shiftEnd: '18:00', tasksOpen: 2 },
  ];
  const result = findNearestVolunteer(volunteersFixture, 'Nonexistent Zone');
  assert.equal(result.id, 'V1');
});

test('processCCTVFeed translates high occupancy to overcrowding incident', () => {
  const mockCctv = [
    { camera_id: 'CAM-X', zone: 'Test Zone', people_count: 100, occupancy_percent: 95, incident: 'High Crowd Density', severity: 'High', confidence: 0.9 }
  ];
  const { generatedIncidents } = processCCTVFeed(mockCctv);
  assert.strictEqual(generatedIncidents.length, 1);
  assert.strictEqual(generatedIncidents[0].type, 'overcrowding');
  assert.strictEqual(generatedIncidents[0].severity, 'high');
});
