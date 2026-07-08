'use strict';

const GEMINI_URL_BASE = 'https://generativelanguage.googleapis.com/v1beta/models/';

/**
 * Thin wrapper around the Gemini API.
 * Kept separate from route handling so it's easy to mock in tests
 * and easy to swap providers later.
 */
async function callLLM({ systemPrompt, userMessage, contextJson, model, apiKey }) {
  if (!apiKey) {
    throw new Error('Missing GEMINI_API_KEY. Copy .env.example to .env and add your key.');
  }

  const modelName = model || 'gemini-2.5-flash';
  const url = `${GEMINI_URL_BASE}${modelName}:generateContent?key=${apiKey}`;

  const body = {
    systemInstruction: {
      parts: [{ text: systemPrompt }]
    },
    contents: [
      {
        role: 'user',
        parts: [
          { text: `LIVE_CONTEXT (JSON, source of truth - do not contradict it):\n${JSON.stringify(contextJson)}\n\nUser message: ${userMessage}` }
        ]
      }
    ],
    generationConfig: {
      maxOutputTokens: 600,
    }
  };

  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Gemini API error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  return data.candidates?.[0]?.content?.parts?.[0]?.text || '';
}

module.exports = { callLLM };
