// send-daily-email.js
// Runs once a day via GitHub Actions. Reads planner-data.json, figures out
// today's workout + schedule, formats an email, and sends it via Resend.

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// ---------- Load data ----------
const dataPath = path.join(__dirname, 'planner-data.json');
const data = JSON.parse(fs.readFileSync(dataPath, 'utf-8'));

// ---------- Figure out today ----------
const tz = data.owner.timezone || 'America/New_York';
const now = new Date();
const todayName = now.toLocaleDateString('en-US', { weekday: 'long', timeZone: tz });
const dateStr = now.toLocaleDateString('en-US', {
  weekday: 'long', year: 'numeric', month: 'long', day: 'numeric', timeZone: tz
});

// Which program week are we in? (1–4, repeating)
const startDate = new Date(data.program_start_date + 'T00:00:00');
const daysSinceStart = Math.floor((now - startDate) / (1000 * 60 * 60 * 24));
const programWeek = ((Math.floor(daysSinceStart / 7) % 4) + 4) % 4 + 1;
const weekMod = data.week_modifiers[String(programWeek)];

// Today's schedule + workout
const today = data.weekly_schedule[todayName];
if (!today) {
  console.error(`No schedule for ${todayName}`);
  process.exit(1);
}
const workout = data.workouts[today.workout_day] || data.workouts.Rest;

// ---------- Build email HTML ----------
const html = renderEmail({ dateStr, todayName, today, workout, weekMod });
const text = renderPlainText({ dateStr, todayName, today, workout, weekMod });

// ---------- Send via Resend ----------
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const FROM_EMAIL = process.env.FROM_EMAIL || 'planner@resend.dev';
const TO_EMAIL = data.owner.email;

if (!RESEND_API_KEY) {
  console.error('Missing RESEND_API_KEY env var');
  process.exit(1);
}

const subject = `${todayName} — ${today.workout_day} · ${weekMod.label}`;

const response = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${RESEND_API_KEY}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    from: FROM_EMAIL,
    to: TO_EMAIL,
    subject,
    html,
    text,
  }),
});

if (!response.ok) {
  const err = await response.text();
  console.error('Resend error:', response.status, err);
  process.exit(1);
}

const result = await response.json();
console.log('Email sent:', result.id || result);

// ======================================================================
// RENDERERS
// ======================================================================

function renderEmail({ dateStr, todayName, today, workout, weekMod }) {
  const scheduleRows = today.blocks.map(b => `
    <tr>
      <td style="padding:6px 12px 6px 0;font-family:'SF Mono',Monaco,monospace;font-size:12px;color:#6b5e50;white-space:nowrap;vertical-align:top;">${b.time}</td>
      <td style="padding:6px 0;font-size:15px;color:#2a2520;vertical-align:top;">${escapeHtml(b.label)}</td>
    </tr>
  `).join('');

  const exerciseBlocks = workout.exercises.map((ex, i) => `
    <div style="margin-bottom:18px;padding-bottom:18px;border-bottom:1px solid #eee5d6;">
      <div style="font-size:11px;font-family:'SF Mono',Monaco,monospace;color:#8b6b3a;text-transform:uppercase;letter-spacing:0.1em;margin-bottom:4px;">Exercise ${i + 1}</div>
      <div style="font-size:17px;font-weight:500;color:#2a2520;margin-bottom:6px;">${escapeHtml(ex.name)}</div>
      <div style="font-family:'SF Mono',Monaco,monospace;font-size:13px;color:#8b3a3a;margin-bottom:8px;">${escapeHtml(ex.notation)}</div>
      <div style="font-size:14px;color:#4a4238;line-height:1.5;margin-bottom:6px;">${escapeHtml(ex.detail)}</div>
      ${ex.progression && ex.progression !== '—' ? `
        <div style="font-size:12px;color:#6b5e50;font-style:italic;">↳ ${escapeHtml(ex.progression)}</div>
      ` : ''}
    </div>
  `).join('');

  return `<!DOCTYPE html>
<html>
<body style="margin:0;padding:0;background:#faf7f2;font-family:Georgia,serif;">
  <div style="max-width:600px;margin:0 auto;padding:32px 24px;">
    <div style="border-bottom:1px solid #2a2520;padding-bottom:20px;margin-bottom:24px;">
      <div style="font-family:'SF Mono',Monaco,monospace;font-size:11px;color:#6b5e50;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:4px;">Your day — ${dateStr}</div>
      <h1 style="font-size:34px;font-weight:400;font-style:italic;margin:0;color:#2a2520;letter-spacing:-0.02em;">${todayName}</h1>
      <div style="margin-top:6px;font-size:13px;color:#6b5e50;">${weekMod.label} · ${today.type}</div>
    </div>

    <div style="background:rgba(255,255,255,0.6);padding:20px 22px;margin-bottom:24px;border:1px solid #eee5d6;">
      <div style="font-family:'SF Mono',Monaco,monospace;font-size:10px;color:#6b5e50;text-transform:uppercase;letter-spacing:0.15em;margin-bottom:12px;">Today's schedule</div>
      <table style="width:100%;border-collapse:collapse;">${scheduleRows}</table>
    </div>

    ${today.workout_day !== 'Rest' ? `
    <div style="background:rgba(255,255,255,0.6);padding:20px 22px;border:1px solid #eee5d6;">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:16px;border-bottom:1px dashed #d4c8b0;padding-bottom:12px;">
        <div>
          <div style="font-family:'SF Mono',Monaco,monospace;font-size:10px;color:#6b5e50;text-transform:uppercase;letter-spacing:0.15em;">Workout</div>
          <div style="font-size:22px;font-style:italic;color:#2a2520;margin-top:2px;">${today.workout_day} Day</div>
        </div>
        <div style="font-size:12px;color:#6b5e50;text-align:right;">${escapeHtml(workout.focus)}</div>
      </div>
      ${exerciseBlocks}
      <div style="margin-top:8px;padding:14px;background:#f3ede0;font-size:13px;color:#4a4238;font-style:italic;line-height:1.5;">
        <strong style="font-style:normal;color:#8b6b3a;">This week:</strong> ${escapeHtml(weekMod.note)}
      </div>
    </div>
    ` : `
    <div style="background:rgba(255,255,255,0.6);padding:20px 22px;border:1px solid #eee5d6;text-align:center;">
      <div style="font-size:17px;font-style:italic;color:#2a2520;">No lifting today.</div>
      <div style="font-size:13px;color:#6b5e50;margin-top:6px;">${escapeHtml(workout.exercises[0].detail)}</div>
    </div>
    `}

    <div style="margin-top:32px;text-align:center;font-family:'SF Mono',Monaco,monospace;font-size:10px;color:#8b8579;text-transform:uppercase;letter-spacing:0.15em;">
      Seven Days, Well Spent
    </div>
  </div>
</body>
</html>`;
}

function renderPlainText({ dateStr, todayName, today, workout, weekMod }) {
  let out = `${todayName.toUpperCase()} — ${dateStr}\n`;
  out += `${weekMod.label} · ${today.type}\n`;
  out += '='.repeat(50) + '\n\n';

  out += 'SCHEDULE\n';
  out += '-'.repeat(50) + '\n';
  today.blocks.forEach(b => {
    out += `  ${b.time.padEnd(14)} ${b.label}\n`;
  });
  out += '\n';

  if (today.workout_day !== 'Rest') {
    out += `WORKOUT: ${today.workout_day.toUpperCase()} DAY\n`;
    out += `Focus: ${workout.focus}\n`;
    out += '-'.repeat(50) + '\n';
    workout.exercises.forEach((ex, i) => {
      out += `\n${i + 1}. ${ex.name}\n`;
      out += `   ${ex.notation}\n`;
      out += `   ${ex.detail}\n`;
      if (ex.progression && ex.progression !== '—') {
        out += `   ↳ ${ex.progression}\n`;
      }
    });
    out += `\nThis week: ${weekMod.note}\n`;
  } else {
    out += `REST DAY\n${workout.exercises[0].detail}\n`;
  }

  return out;
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
