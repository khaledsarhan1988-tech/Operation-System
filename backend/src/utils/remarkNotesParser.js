'use strict';
const crypto = require('crypto');

const TIMESTAMP_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})\s*,?\s*(\d{1,2}):(\d{2})\s*(AM|PM)\s*$/i;

function toIso(day, month, year, hh, mm, ampm) {
  let H = parseInt(hh, 10);
  const M = parseInt(mm, 10);
  const ap = String(ampm).toUpperCase();
  if (ap === 'PM' && H !== 12) H += 12;
  if (ap === 'AM' && H === 12) H = 0;
  const pad = n => String(n).padStart(2, '0');
  const D = pad(parseInt(day, 10));
  const Mo = pad(parseInt(month, 10));
  return `${year}-${Mo}-${D}T${pad(H)}:${pad(M)}:00`;
}

function parseNotes(raw) {
  if (!raw || typeof raw !== 'string') return [];
  const text = raw.replace(/\r\n/g, '\n').trim();
  if (!text) return [];

  const blocks = text.split(/\n\s*\n/);
  const notes = [];

  for (const block of blocks) {
    const lines = block.split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (lines.length === 0) continue;

    const lastLine = lines[lines.length - 1];
    const m = lastLine.match(TIMESTAMP_RE);

    if (m) {
      const noteText = lines.slice(0, -1).join('\n').trim();
      const timestamp = toIso(m[1], m[2], m[3], m[4], m[5], m[6]);
      notes.push({ text: noteText, timestamp });
    } else {
      notes.push({ text: lines.join('\n'), timestamp: null });
    }
  }

  return notes;
}

function hashNotes(raw) {
  if (!raw) return '';
  return crypto.createHash('sha1').update(String(raw)).digest('hex');
}

function noteKey(note) {
  return `${note.timestamp || ''}||${(note.text || '').trim()}`;
}

module.exports = { parseNotes, hashNotes, noteKey };
