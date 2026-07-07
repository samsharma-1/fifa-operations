'use strict';

const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';

/**
 * Thin wrapper around the Anthropic Messages API.
 * Kept separate from route handling so it's easy to mock in tests
 * and easy to swap providers later.
 */
async function callClaude({ systemPrompt, userMessage, contextJson, model, apiKey }) {
  if (!apiKey) {
    throw new Error('Missing ANTHROPIC_API_KEY. Copy .env.example to .env and add your key.');
  }

  const body = {
    model: model || 'claude-sonnet-4-6',
    max_tokens: 600,
    system: systemPrompt,
    messages: [
      {
        role: 'user',
        content: `LIVE_CONTEXT (JSON, source of truth - do not contradict it):\n${JSON.stringify(
          contextJson
        )}\n\nUser message: ${userMessage}`,
      },
    ],
  };

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Anthropic API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  const textBlock = (data.content || []).find((b) => b.type === 'text');
  return textBlock ? textBlock.text : '';
}

module.exports = { callClaude };
