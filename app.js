import {
  loadProgress, saveProgress, loadPending, markPending, clearPending,
  setNamespace, migrateLegacy,
  loadDoc, saveDoc, markDocPending, loadDocPending, clearDocPending,
} from './storage.js';
import { clearableDates, computeStreak, growthVals, mergeProgress, toCSV, weeklySummary, weekStart } from './progress.js';
import { pull, push, isConfigured, isAuthError, pullDoc, pushDoc } from './sync.js';
import { defaultProfile, normalizeProfile, mergeDoc } from './profile.js';
import { WEEK, DAY_KEYS, istDateISO, istNow, resolveNow } from './schedule.js';
import { nextDeadline, formatDates } from './deadlines.js';
import {
  isAuthConfigured, loadSession, completeSignIn, beginSignIn, signOut,
  stripAuthParams, authView, currentUserId,
} from './auth.js';

/* ---------- day panels ---------- */
/* The design's time column: 96px, right-aligned, and a '6:45 – 7:45' range
   split on ' – ' across two lines — '6:45' then '– 7:45'. A block with no
   range ('Morning', '8:15 onwards') stays one line. */
function whenCell(time) {
  const [from, to] = time.split(' – ');
  return `<div class="when"><span>${from}</span>` +
         (to ? `<span>&ndash; ${to}</span>` : '') + `</div>`;
}

/* The legend's own words, so the dot's accessible name and the legend agree.
   The lane dot is now a soft neutral-400 by the user's decision, which is
   below the 3:1 graphics floor on purpose — so the lane must not be carried
   by colour alone. Every dot names its lane in text. */
const LANE_LABELS = { study: 'Study', work: 'Work', fit: 'Workout', cricket: 'Cricket', rest: 'Rest' };

/* Time first, then the block: the design's row is a 96px right-aligned time
   column beside a body that opens with the lane dot. The lane is a dot now,
   not a bar down the side. */
function rowHTML(dayKey, block, i) {
  const subj = block.subject ? `<span class="subj">${block.subject}</span>` : '';
  const eff = block.effort
    ? `<span class="effort${block.effort.cls ? ' ' + block.effort.cls : ''}">${block.effort.text}</span>`
    : '';
  const detail = block.detail ? `<em>${block.detail}</em>` : '';
  return `<div class="row lane-${block.lane}" data-day="${dayKey}" data-i="${i}">` +
         whenCell(block.time) +
         `<div class="body"><span class="lane-dot" role="img" ` +
         `aria-label="${LANE_LABELS[block.lane] || block.lane}" ` +
         `title="${LANE_LABELS[block.lane] || block.lane}"></span>` +
         `<div class="what"><strong>${block.label}${subj}${eff}</strong>${detail}</div>` +
         `</div></div>`;
}

function renderDay(dayKey) {
  const day = WEEK[dayKey];
  document.getElementById('p-' + dayKey).innerHTML =
    `<div class="day-head"><h3>${day.title}</h3>` +
    `<span class="tag">${day.tag}</span></div>` +
    `<p class="day-note">${day.note}</p>` +
    `<div class="blocks">${day.blocks.map((b, i) => rowHTML(dayKey, b, i)).join('')}</div>`;
}

/* ---------- NOW ---------- */
let nowKey = '';
function renderNow() {
  const { dayKey, minutes } = istNow();
  const { state, dayKey: blockDay, block } = resolveNow(dayKey, minutes);

  /* The pill is an aria-live region. Rewriting it every 60 seconds makes
     VoiceOver announce the same sentence once a minute all day, so the DOM is
     only touched when the sentence actually changes. */
  const key = `${state}|${dayKey}|${blockDay}|${block.start}`;
  if (key === nowKey) return;
  nowKey = key;

  const label = block.subject ? `${block.label} — ${block.subject}` : block.label;
  const [from, to] = block.time.split(' – ');
  const dayPrefix = blockDay === dayKey ? '' : ` · ${WEEK[blockDay].title.slice(0, 3)}`;
  /* The design's wording: '<b>Now</b> Work · until 6:30' for a block in
     progress. A block with no end time ('Lights out', 'Morning') drops the
     tail rather than inventing one. When nothing is running the app's own
     next/gap/rollover wording stands, prefixed with the day when the next
     block belongs to tomorrow. */
  const text = state === 'now'
    ? `<b>Now</b> ${label}${to ? ` · until ${to}` : ''}`
    : `<b>Next</b>${dayPrefix} ${label} · ${from}`;
  const banner = document.getElementById('nowBanner');
  banner.classList.toggle('next', state !== 'now');
  banner.innerHTML =
    `<span class="now-dot" aria-hidden="true"></span><span class="now-text">${text}</span>`;

  document.querySelectorAll('.row.is-now').forEach((el) => el.classList.remove('is-now'));
  if (state === 'now') {
    const i = WEEK[dayKey].blocks.indexOf(block);
    document.querySelector(`.row[data-day="${dayKey}"][data-i="${i}"]`)?.classList.add('is-now');
  }
}

/* ---------- day tabs ---------- */
const tabs=document.querySelectorAll('.tab'),panels=document.querySelectorAll('.panel');
function showDay(d){
  tabs.forEach(t=>{const on=t.dataset.d===d;t.classList.toggle('on',on);t.setAttribute('aria-pressed',on)});
  panels.forEach(p=>p.classList.toggle('on',p.id==='p-'+d));
}
tabs.forEach(t=>t.addEventListener('click',()=>showDay(t.dataset.d)));

/* Reading storage before we know which account we are is exactly the bug
   namespacing exists to prevent (Task 8) — startApp() populates this once
   there is a session. */
let progress = {};

/* The per-account profile document. `profile` is always a normalized, usable
   shape (defaultProfile() until a real one loads); `profileDoc` is the raw
   { value, u } envelope or null, and that null is load-bearing — it is how
   the onboarding wizard will tell "never set up" from "set up, empty" apart,
   so nothing here may collapse it into an empty document. */
let profile = defaultProfile();
let profileDoc = null;

const saveStatus = document.getElementById('saveStatus');
/* Save and sync now share one line under the note. They keep one span each —
   this writer owns #saveStatus, describeIdle owns #syncStatus — and the
   stylesheet draws the '·' between them only when both are non-empty, so
   'Saved · synced just now' reads as one sentence without either function
   having to know about the other. */
function setSaveStatus(text, color) {
  saveStatus.textContent = text;
  saveStatus.style.color = color || 'var(--text-muted)';
}

/* Called after every mutation. The localStorage write is synchronous but it
   can still fail — Lockdown Mode, an embedded context, storage switched off,
   quota — and write() reports that. Saying "saved" when nothing was saved is
   the original bug of this project, so the result is honoured here. The remote
   queue is armed either way: the network tier may well still work. */
function commit(dates) {
  for (const date of dates) {
    progress[date] = { ...progress[date], u: new Date().toISOString() };
  }
  if (saveProgress(progress)) {
    setSaveStatus('✓ saved', 'var(--ok)');
    setTimeout(() => {
      if (saveStatus.textContent === '✓ saved') setSaveStatus('');
    }, 2500);
  } else {
    setSaveStatus('⚠ not saved', 'var(--warn)');
  }
  queueSync(dates);
  renderWeek();
}

/* The re-render hook called after the profile is committed and after it is
   pulled from the server. Deadlines are profile-derived state, so they must
   refresh here — Task 15 grows this further to render the season line,
   ground rules, legend and tick labels. */
function renderProfile() {
  renderDeadline();
}

/* Same shape as commit(): stamp, write locally, queue, re-render. The stamp
   is what the flush compares against to decide whether an edit landed while
   its own push was in flight. pushDoc throws on a null/undefined/empty
   updatedAt, so this always supplies a real ISO timestamp rather than
   leaving it to whatever profileDoc.u happened to hold before. */
function commitProfile() {
  profileDoc = { value: profile, u: new Date().toISOString() };
  if (!saveDoc('profile', profileDoc)) setSaveStatus('⚠ not saved', 'var(--warn)');
  markDocPending('profile');
  armFlush();
  renderProfile();
}

/* ---------- remote sync ---------- */
const syncEl = document.getElementById('syncStatus');
let lastSyncAt = null;
let syncTimer = null;
let attempt = 0;
let flushing = false;
/* Set when a request fails, cleared when one succeeds. Without it a failed
   pull with an empty queue falls through to setSyncStatus(''), which is
   exactly what a healthy idle app looks like. */
let offline = false;
/* Set when authedFetch reports there is no session to attach a token from —
   a revoked or expired refresh token, distinct from `offline`. No amount of
   retrying fixes this, and calling it "offline" would send the user hunting
   for a network problem that does not exist. */
let signedOut = false;

function setSyncStatus(text, color) {
  syncEl.textContent = text;
  syncEl.style.color = color || 'var(--text-muted)';
}

function describeIdle() {
  /* Both queues, not just the dates one. A profile-only edit — an onboarding
     session touches no ticks at all — leaves loadPending() empty while a
     document is genuinely queued, and reporting "synced" there is simply
     untrue. Same class of lie as the "offline" that turned out to mean
     "signed out". */
  const pending = [...loadPending(), ...loadDocPending()];
  if (!isConfigured()) return setSyncStatus('local only · sync not configured');
  /* Checked before `offline`: both can theoretically be true (a dead session
     discovered, then a later network attempt also fails) and "offline" would
     be the more misleading of the two to show, since it invites waiting for
     a connection to come back rather than signing in again. */
  if (signedOut) return setSyncStatus(
    pending.length ? `signed out · ${pending.length} unsynced` : 'signed out',
    'var(--warn)');
  /* Queued and failed are different states. During the 600 ms debounce, or
     with a push in flight on a perfectly good connection, there is pending
     work and nothing is wrong — saying "offline" there is just false. */
  if (offline) return setSyncStatus(
    pending.length ? `offline · ${pending.length} unsynced` : 'offline · not synced',
    'var(--warn)');
  if (pending.length) return setSyncStatus(`queued · ${pending.length}`);
  if (lastSyncAt) {
    const mins = Math.round((Date.now() - lastSyncAt) / 60000);
    /* No middot here: the stylesheet already draws one between this span and
       the save span, so 'synced · just now' rendered as
       '✓ saved · synced · just now'. The design's line is 'Saved · synced
       just now'. */
    return setSyncStatus(mins < 1 ? 'synced just now' : `synced ${mins} min ago`);
  }
  setSyncStatus('');
}

/* Both paths that talk to the server can discover a dead session, and this
   is the same response either way. Factored out rather than duplicated
   because the two paths disagree about which is the common case: a session
   usually dies while the app is CLOSED, so the pull on next open finds out
   first, and the flush branch below only runs at all when something is
   queued. */
function enterSignedOut() {
  clearTimeout(syncTimer);
  attempt = 0;
  offline = false;
  signedOut = true;
  describeIdle();
  authError.textContent =
    'Your sign-in expired. Sign in again — nothing here was lost.';
  showView('signed-out');
}

async function flushSync() {
  if (!isConfigured()) return describeIdle();
  /* 'online', visibilitychange and the debounce timer all call this with no
     coordination. Two overlapping pushes would race the same way A1 did, so a
     second caller re-arms the debounce instead of starting its own push. */
  if (flushing) return armFlush();
  const dates = loadPending();
  const kinds = loadDocPending();
  /* A profile-only edit (no ticks touched) must still flush. The plan's
     original guard here was `if (!dates.length) return describeIdle();`,
     which would strand a queued document forever whenever the progress queue
     was empty — the common case for an onboarding-only session. */
  if (!dates.length && !kinds.length) return describeIdle();
  flushing = true;
  setSyncStatus('syncing…');
  try {
    /* push() serialises its body synchronously, so these are the exact values
       the network sees. A date whose 'u' has moved on by the time we get back
       was ticked mid-flight and must stay queued. */
    const sent = dates.map((d) => (progress[d] || {}).u);
    if (dates.length) {
      await push(progress, dates);
      clearPending(clearableDates(dates, sent, progress));
    }
    if (kinds.length) {
      /* Exactly the trap clearableDates exists for, one document at a time:
         the body is serialised before the await, so an edit made mid-flight
         must not be cleared by the push that never carried it.
         scheduleDoc does not exist until Task 18 — docFor returns null for
         any kind it does not yet know how to find, and that kind is skipped
         rather than pushed or wrongly cleared. */
      const docFor = (k) => (k === 'profile' ? profileDoc : null);
      for (const k of kinds) {
        const doc = docFor(k);
        if (!doc) continue;
        /* Snapshot immediately before THIS kind's own await, not once before
           the loop. A pre-loop snapshot is right only for the first kind: by
           the time a later one is reached, earlier pushes have already
           awaited, so its baseline would predate an edit that its own push
           then correctly carried — and the push would fail to clear. There is
           only one kind today, so this is dormant until Task 18 adds the
           schedule; the shape is the same trap clearableDates exists for. */
        const sentU = doc.u;
        await pushDoc(k, doc.value, sentU);
        if (docFor(k)?.u === sentU) clearDocPending([k]);
      }
    }
    lastSyncAt = Date.now();
    attempt = 0;
    offline = false;
    signedOut = false;
    if (loadPending().length || loadDocPending().length) armFlush();
    describeIdle();
  } catch (err) {
    /* authedFetch throws this exact, stable error when there is no session to
       attach a token from — a refresh token the server has already rejected.
       No number of retries recovers that, so the backoff below is for a
       genuine network failure only; this branch never schedules one, and the
       queue is left exactly as markPending wrote it for the next sign-in to
       pick up. clearPending is not called on this path. */
    if (isAuthError(err)) {
      enterSignedOut();
    } else if (signedOut) {
      /* initSync fires flushSync() without awaiting it, then awaits its own
         pull, so a push can still be in flight when the pull discovers the
         session is dead. If that push then fails for an ordinary network
         reason, its branch would write "retrying sync" over "signed out" —
         retrying being the one thing that cannot help here. The queue is
         untouched either way; only the message would have been wrong. */
      describeIdle();
    } else if (attempt < 4) {
      /* Back off 1s, 2s, 4s, 8s, then stop and wait for the next tick or an
         'online' event. An unbounded retry loop would burn battery all day. */
      attempt++;
      setSyncStatus(`retrying sync (${attempt}/4)…`, 'var(--warn)');
      clearTimeout(syncTimer);
      syncTimer = setTimeout(flushSync, 1000 * 2 ** (attempt - 1));
    } else {
      attempt = 0;
      offline = true;
      describeIdle();
    }
  } finally {
    flushing = false;
  }
}

function armFlush() {
  clearTimeout(syncTimer);
  syncTimer = setTimeout(flushSync, 600);   /* coalesce rapid ticks */
}

function queueSync(dates) {
  markPending(dates);
  armFlush();
}

/* ---------- dates ---------- */
const todayISO = () => istDateISO();
let selDate=todayISO();
let today=selDate;

/* A backgrounded PWA crosses midnight easily — the 11 PM session routinely
   does. Without this the banner rolls over while the scorecard still shows
   yesterday, the streak recomputes against the new today, and the next tick
   lands on the wrong date. */
function rolloverIfNeeded() {
  const now = todayISO();
  if (now === today) return;
  const wasOnToday = selDate === today;
  today = now;
  showDay(istNow().dayKey);
  /* selDate only follows today forward if the user was actually sitting on
     today when it happened, and isn't mid-note. Otherwise a deliberate look
     at a past day (or a past month) gets yanked forward with no warning, and
     worse, a note started before midnight — which renderScorecard leaves
     alone while noteInput has focus — would have its next debounce/blur
     write yesterday's half-typed text into today's record. Leaving selDate
     put keeps the note filed under the day it was started on. */
  if (wasOnToday && document.activeElement !== noteInput) {
    selDate = now;
    const [y, m] = now.split('-').map(Number);
    calY = y; calM = m - 1;
  }
  renderScorecard();
  renderCalendar();
  renderWeek();
  renderDeadline();
}

/* ---------- scorecard ---------- */
const ticks={s:document.getElementById('t-s'),w:document.getElementById('t-w'),z:document.getElementById('t-z')};
const scDate=document.getElementById('scDate'),scSub=document.getElementById('scSub'),
      backBtn=document.getElementById('backToday');

/* ---------- daily note ---------- */
const noteInput = document.getElementById('noteInput');
let noteTimer = null;

noteInput.addEventListener('input', () => {
  clearTimeout(noteTimer);
  /* Same 600 ms coalescing as ticks — one write per pause, not per keystroke. */
  noteTimer = setTimeout(() => {
    const rec = progress[selDate] || (progress[selDate] = {});
    rec.note = noteInput.value.trim();
    commit([selDate]);
  }, 600);
});

noteInput.addEventListener('blur', () => {
  clearTimeout(noteTimer);
  const value = noteInput.value.trim();
  /* Read before creating: blurring an untouched input used to leave an empty
     record behind, which a later save persisted and both exports listed. */
  if ((progress[selDate]?.note || '') === value) return;
  const rec = progress[selDate] || (progress[selDate] = {});
  rec.note = value;
  commit([selDate]);
});

function renderScorecard(){
  const rec=progress[selDate]||{};
  Object.entries(ticks).forEach(([k,el])=>{
    const on=!!rec[k];
    el.classList.toggle('done',on);
    el.setAttribute('aria-pressed',on);
  });
  const d=new Date(selDate+'T00:00:00');
  const isToday=selDate===todayISO();
  /* The design's heading is a flat "Today" beside a small "Thu, 20 Aug". That
     is right for today and a lie for any other day, so the heading names the
     weekday when the user has navigated off today. */
  scDate.textContent=isToday?'Today':d.toLocaleDateString('en-IN',{weekday:'long'});
  scSub.textContent=d.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
  backBtn.style.display=isToday?'none':'inline';
  /* Never clobber what the user is actively typing: the init pull() resolves
     asynchronously and re-renders, which would otherwise wipe an in-progress
     note. Switching days still swaps the note, because clicking a calendar
     cell moves focus off the input first. */
  if (document.activeElement !== noteInput) noteInput.value = rec.note || '';
  renderStreak();
}
Object.entries(ticks).forEach(([k,el])=>{
  el.addEventListener('click',()=>{
    const rec=progress[selDate]||(progress[selDate]={});
    rec[k]=rec[k]?0:1;
    renderScorecard();renderCalendar();
    commit([selDate]);
  });
});
backBtn.addEventListener('click',()=>{selDate=todayISO();renderScorecard();renderCalendar()});

const growthEl = document.getElementById('growthDots');

function renderStreak() {
  const t = todayISO();
  document.getElementById('streak').textContent = computeStreak(progress, t);
  /* Both the size and the cap are growthVals's, in progress.js and under
     test. All this does is put the numbers on the elements. */
  const vals = growthVals(progress, t);
  growthEl.innerHTML = vals.map((v) =>
    `<i class="${v.complete ? 'live' : ''}" style="width:${v.size}px"` +
    ` title="${v.date} — ${v.complete ? 'complete' : 'missed'}"></i>`).join('');
  /* A missed dot is deliberately faint — the growing accent run is meant to
     be the whole story. That only works if nobody has to see it: the label
     carries the tally and the run itself in words, because the container is
     role="img" and its children are not exposed. */
  const done = vals.filter((v) => v.complete).length;
  const run = vals[vals.length - 1].run;
  growthEl.setAttribute('aria-label',
    `Last ${vals.length} days: ${done} complete, ${vals.length - done} missed. ` +
    (run ? `Current run ${run} day${run === 1 ? '' : 's'}.` : 'Today is not complete yet.'));
}

/* ---------- calendar ---------- */
let calY,calM;
{const [y,m]=todayISO().split('-').map(Number);calY=y;calM=m-1}
const grid=document.getElementById('calGrid'),mName=document.getElementById('mName');

function renderCalendar(){
  mName.textContent=new Date(calY,calM,1).toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  grid.innerHTML='';
  ['S','M','T','W','T','F','S'].forEach(d=>{
    const h=document.createElement('div');h.className='cal-dow';h.textContent=d;grid.appendChild(h);
  });
  const first=new Date(calY,calM,1).getDay();
  const days=new Date(calY,calM+1,0).getDate();
  for(let i=0;i<first;i++){const c=document.createElement('div');c.className='cell blank';grid.appendChild(c)}
  let cS=0,cW=0,cF=0;
  const tISO=todayISO();
  for(let d=1;d<=days;d++){
    const dISO=`${calY}-${String(calM+1).padStart(2,'0')}-${String(d).padStart(2,'0')}`;
    const rec=progress[dISO]||{};
    const full=rec.s&&rec.w&&rec.z;
    if(rec.s)cS++;if(rec.w)cW++;if(full)cF++;
    /* A complete day is a filled circle and carries no pips — the fill has
       already said all three were scored. Any other day shows one pip per
       habit that was, beneath the numeral. The old scorebook "dot ball" for
       an empty past day is not in the design and is gone with it. */
    let mk='';
    if(!full){
      mk=(rec.s?'<i class="b-s"></i>':'')+(rec.w?'<i class="b-w"></i>':'')+(rec.z?'<i class="b-z"></i>':'');
    }
    const c=document.createElement('button');
    c.type='button';
    /* A future date is dimmer than a past one; the class is what carries
       that, so the stylesheet can hold it to its own contrast floor. */
    c.className='cell'+(dISO===tISO?' today':'')+(full?' full':'')
      +(dISO===selDate?' sel':'')+(dISO>tISO?' future':'');
    c.innerHTML=`<span class="dnum">${d}</span>`+(mk?`<span class="mk">${mk}</span>`:'');
    c.title=dISO;
    c.addEventListener('click',()=>{selDate=dISO;renderScorecard();renderCalendar();
      /* The one animation the stylesheet's reduce query cannot reach. */
      const reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
      document.querySelector('.scorecard').scrollIntoView({behavior:reduce?'auto':'smooth',block:'center'})});
    grid.appendChild(c);
  }
  document.getElementById('stFull').textContent=cF;
  document.getElementById('stS').textContent=cS;
  document.getElementById('stW').textContent=cW;
}
document.getElementById('prevM').addEventListener('click',()=>{calM--;if(calM<0){calM=11;calY--}renderCalendar()});
document.getElementById('nextM').addEventListener('click',()=>{calM++;if(calM>11){calM=0;calY++}renderCalendar()});

/* ---------- deadline countdown ---------- */
function renderDeadline() {
  const next = nextDeadline(profile.deadlines, todayISO());
  const line = document.getElementById('examLine');
  /* Cleared, not just skipped. Rendering nothing is not the same as leaving
     yesterday's countdown up, and this runs across the midnight after the
     final deadline — where the difference is a line reading 'EC-3 in 1 day'
     forever. With no deadlines at all (every new account) this is simply the
     resting state. */
  if (!next) { line.textContent = ''; line.removeAttribute('title'); return; }

  line.textContent = next.days === 0 ? `${next.label} today`
                   : next.days === 1 ? `${next.label} in 1 day`
                   : `${next.label} in ${next.days} days`;
  const group = profile.deadlines.find((d) => d.label === next.label);
  line.title = `${next.label} · ${formatDates(group.dates)}`;
}

/* ---------- weekly summary ---------- */
function renderWeek() {
  const start = weekStart(todayISO());
  const sum = weeklySummary(progress, start);
  /* The design gives each of the four its own numeral colour, so the class
     rides along with the value. */
  document.getElementById('weekStats').innerHTML = [
    [`${sum.study}/5`, 'Study days', ''],
    [`${sum.workout}/7`, 'Workouts', ' s-fit'],
    [`${sum.sleep}/7`, 'Slept by 11', ' s-sleep'],
    [sum.bestStreak, 'Best run', ''],
  ].map(([n, cap, cls]) =>
    `<div class="week-stat${cls}"><b>${n}</b><span>${cap}</span></div>`).join('');

  /* The note is the one string on this page the user (or, given the no-auth
     design, anyone with the URL and the anon key) authors. Through innerHTML
     "can write a short string" becomes "can run script in this session", which
     is well outside the accepted risk — so this list is built as text. The
     schedule's &amp;/&rsquo; entities stay on innerHTML; those are ours. */
  const notes = document.getElementById('weekNotes');
  notes.textContent = '';
  if (!sum.notes.length) {
    const li = document.createElement('li');
    li.className = 'week-empty';
    li.textContent = `No notes yet this week — the week started ${start}.`;
    notes.appendChild(li);
    return;
  }
  for (const n of sum.notes) {
    const li = document.createElement('li');
    const when = document.createElement('span');
    when.className = 'when';
    when.textContent = new Date(n.date + 'T00:00:00')
      .toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
    const what = document.createElement('span');
    what.className = 'what';
    what.textContent = n.note;
    li.append(when, what);
    notes.appendChild(li);
  }
}

/* ---------- export ---------- */
function download(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  /* Safari, iOS included — the primary device — has historically ignored a
     click on an anchor that is not in the document. */
  document.body.appendChild(a);
  a.click();
  a.remove();
  /* Revoke on the next tick — revoking synchronously can cancel the download
     on some mobile browsers. */
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

document.getElementById('exportJson').addEventListener('click', () => {
  download(`weekly-innings-${todayISO()}.json`, JSON.stringify(progress, null, 2), 'application/json');
});

document.getElementById('exportCsv').addEventListener('click', () => {
  download(`weekly-innings-${todayISO()}.csv`, toCSV(progress), 'text/csv');
});

/* ---------- remote sync bootstrap ---------- */
async function initSync() {
  if (!isConfigured()) return describeIdle();
  /* The flush is not sequenced behind the pull. A pull that hangs must not
     hold the queue hostage: a hung connection is precisely the case the queue
     exists for. Trade-off: a queued row can now go out before the merge below
     has a chance to fold in a newer remote write, so a stale local row can
     briefly clobber it. This mostly self-heals — the merge updates
     progress[d].u, which keeps the date in clearableDates so it gets re-pushed
     with the winning value — but not if the pull itself fails, in which case
     the stale push stands until the next local edit. Deliberate; a sequenced
     pull-then-flush would be safer here but reintroduces the hang risk. */
  flushSync();
  try {
    setSyncStatus('syncing…');
    progress = mergeProgress(progress, await pull());
    saveProgress(progress);
    renderScorecard();
    renderCalendar();
    renderWeek();
    /* Everything pullDoc returns is untrusted — an older app version, a
       hand-edited row, or (per the plan for a later project) a language
       model. mergeDoc only picks the newer envelope by timestamp; it does
       not vouch for what is inside it. normalizeProfile is what actually
       defends `profile` from a malformed or hostile value, so nothing
       downstream ever renders the raw remote payload. */
    const remoteProfile = await pullDoc('profile');
    const winner = mergeDoc(profileDoc, remoteProfile);
    const remoteWon = !!winner && winner === remoteProfile;
    /* Normalise BEFORE the envelope is rebuilt, not after. mergeDoc only picks
       the newer envelope by timestamp; it does not vouch for what is inside
       one. Assigning its pick straight to profileDoc would persist the raw
       remote value to localStorage AND make it the body of the next push —
       so an older app version, a hand-edited row, or a language model in the
       later project could write malformed content back to the server through
       a client that never inspected it. Only `profile` was being normalised,
       which protects what is rendered and nothing else. */
    profile = normalizeProfile(winner?.value);
    profileDoc = winner ? { value: profile, u: winner.u } : null;
    saveDoc('profile', profileDoc);
    /* A queued local edit that just lost the merge has nothing left to send.
       Left queued, the next flush would push the REMOTE value straight back,
       bump updated_at for no reason, and clear the queue — which reads
       exactly like the local edit synced when it was actually superseded. */
    if (remoteWon) clearDocPending(['profile']);
    renderProfile();
    lastSyncAt = Date.now();
    offline = false;
  } catch (err) {
    /* A session that expired while the app was closed is discovered HERE, not
       in the flush: flushSync returns early when the queue is empty, which it
       usually is on a cold open. Reporting that as "offline" invites waiting
       for a connection that was never the problem. */
    if (isAuthError(err)) return enterSignedOut();
    /* Offline or unreachable — localStorage already rendered, so there is
       nothing for the user to lose. The status line has to say so all the
       same: blank reads as a healthy idle app. */
    offline = true;
  }
  if (!flushing) describeIdle();
}

/* One tick and one visibility handler for the whole page: the day can roll
   over, the banner can move on and the sync line can age, and all three want
   the same two moments. describeIdle stays out of the way of a live flush. */
function tick() {
  rolloverIfNeeded();
  renderNow();
  if (!flushing) describeIdle();
}

/* ---------- start ---------- */
/* Everything above this point only defines functions and binds listeners on
   elements that exist whether or not there is a session. Nothing reads
   storage or renders data until startApp() runs, and startApp() only runs
   once there is a session — reading progress before we know which account we
   are is exactly the bug namespacing exists to prevent (Task 8). */
function startApp() {
  /* migrate-then-namespace reads in the order the data actually moves: adopt
     whatever was written before accounts existed, then point every storage.js
     read/write at this account. migrateLegacy takes the uid as an explicit
     argument (never the module namespace — see keyFor's default parameter),
     so this ordering is a readability choice, not a correctness dependency;
     the two calls could run in either order with the same result. */
  const uid = currentUserId();
  migrateLegacy(uid);
  setNamespace(uid);
  /* Normalise BEFORE the envelope is rebuilt, not after — see the identical
     reasoning at the initSync fix above. profileDoc is both what gets written
     back to localStorage and the body of the next push, so an unnormalised
     value read from storage (an older app version, a hand-edited key) must
     never reach it. loadDoc's null must survive unchanged: it is how the
     onboarding wizard tells "never set up" from "set up, empty" apart. */
  const loadedProfile = loadDoc('profile');
  profile = normalizeProfile(loadedProfile?.value);
  profileDoc = loadedProfile ? { value: profile, u: loadedProfile.u } : null;
  DAY_KEYS.forEach(renderDay);
  renderNow();
  showDay(istNow().dayKey);
  progress = loadProgress();
  renderScorecard();
  renderCalendar();
  renderWeek();
  renderDeadline();
  renderProfile();
  initSync();
  setInterval(tick, 60000);
  window.addEventListener('online', flushSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') tick();
    else if (loadPending().length || loadDocPending().length) flushSync();
  });
}

/* ---------- the signed-out gate ---------- */
const gate = document.getElementById('authGate');
const appMain = document.getElementById('appMain');
const signOutBtn = document.getElementById('signOutBtn');
const accountBar = document.getElementById('accountBar');
const authError = document.getElementById('authError');

function showView(view) {
  gate.hidden = view === 'app';
  appMain.hidden = view !== 'app';
  accountBar.hidden = view !== 'app';
  if (view === 'unconfigured') {
    /* textContent, not innerHTML — the rule holds for our own strings too,
       so there is never a second way of writing text on this page. */
    authError.textContent =
      'This build has no Supabase configuration. Run `npm run config` and reload.';
    document.getElementById('signInBtn').hidden = true;
  }
}

document.getElementById('signInBtn').addEventListener('click', async () => {
  authError.textContent = '';
  try {
    await beginSignIn({});
  } catch (e) {
    authError.textContent = 'Could not start sign-in. Check your connection and try again.';
  }
});

signOutBtn.addEventListener('click', async () => {
  await signOut({});
  /* The reload is load-bearing, not just tidiness: storage.js's namespace is
     module state, and nothing else resets it. Drop the reload and the next
     account to sign in on this browser inherits the previous one's namespace
     and reads their data. If this ever becomes a soft transition, call
     setNamespace('') explicitly first. */
  location.reload();
});

(async () => {
  let session = null;
  try {
    session = await completeSignIn({});
    if (session) history.replaceState(null, '', stripAuthParams(location.href));
  } catch (e) {
    authError.textContent = 'Sign-in did not complete. Please try again.';
    history.replaceState(null, '', stripAuthParams(location.href));
  }
  session = session || loadSession();
  const view = authView(isAuthConfigured(), session);
  showView(view);
  if (view === 'app') startApp();
})();

/* ---------- service worker ---------- */
/* Caching the shell is useful signed out too, so registration stays here
   rather than moving into startApp(). */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* Registration fails over file:// and on some private modes. The app
         works fine without it — only offline start-up is lost. */
    });
  });
}
