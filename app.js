import { loadProgress, saveProgress, loadPending, markPending, clearPending } from './storage.js';
import { clearableDates, computeStreak, iso, mergeProgress, toCSV, weeklySummary, weekStart } from './progress.js';
import { pull, push, isConfigured } from './sync.js';
import { WEEK, DAY_KEYS, istNow, resolveNow } from './schedule.js';
import { nextExam, formatExamDates, EXAMS } from './exams.js';

/* ---------- day panels ---------- */
/* The ledger gutter is 56px, so a '6:45 – 7:45' range is stacked rather than
   set on one line. Anything without a range renders as a single line. */
function whenCell(time) {
  const [from, to] = time.split(' – ');
  return `<div class="when t-time"><span>${from}</span>` +
         (to ? `<span>&ndash;${to}</span>` : '') + `</div>`;
}

function rowHTML(dayKey, block, i) {
  const subj = block.subject ? `<span class="subj t-label">${block.subject}</span>` : '';
  const eff = block.effort
    ? `<span class="effort t-label${block.effort.cls ? ' ' + block.effort.cls : ''}">${block.effort.text}</span>`
    : '';
  const detail = block.detail ? `<em class="t-note">${block.detail}</em>` : '';
  return `<div class="row ledger lane-${block.lane}" data-day="${dayKey}" data-i="${i}">` +
         whenCell(block.time) +
         `<div class="what"><strong class="t-body">${block.label}${subj}${eff}</strong>${detail}</div></div>`;
}

function renderDay(dayKey) {
  const day = WEEK[dayKey];
  document.getElementById('p-' + dayKey).innerHTML =
    `<div class="day-head"><h3 class="t-title">${day.title}</h3>` +
    `<span class="tag t-label">${day.tag}</span></div>` +
    `<p class="day-note t-note">${day.note}</p>` +
    day.blocks.map((b, i) => rowHTML(dayKey, b, i)).join('');
}

DAY_KEYS.forEach(renderDay);

/* ---------- NOW ---------- */
function renderNow() {
  const { dayKey, minutes } = istNow();
  const { state, dayKey: blockDay, block } = resolveNow(dayKey, minutes);

  const label = block.subject ? `${block.label} — ${block.subject}` : block.label;
  const when = state === 'now' ? block.time : block.time.split(' – ')[0];
  const dayPrefix = blockDay === dayKey ? '' : ` · ${WEEK[blockDay].title.slice(0, 3)}`;
  const banner = document.getElementById('nowBanner');
  banner.classList.toggle('next', state !== 'now');
  banner.innerHTML = whenCell(when) +
    `<div class="what"><span class="state t-label">` +
    `${state === 'now' ? 'NOW' : 'NEXT'}${dayPrefix}</span>` +
    `<span class="what-now t-body">${label}</span></div>`;

  document.querySelectorAll('.row.is-now').forEach((el) => el.classList.remove('is-now'));
  if (state === 'now') {
    const i = WEEK[dayKey].blocks.indexOf(block);
    document.querySelector(`.row[data-day="${dayKey}"][data-i="${i}"]`)?.classList.add('is-now');
  }
}

renderNow();
setInterval(renderNow, 60000);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') renderNow();
});

/* ---------- day tabs ---------- */
const tabs=document.querySelectorAll('.tab'),panels=document.querySelectorAll('.panel');
function showDay(d){
  tabs.forEach(t=>{const on=t.dataset.d===d;t.classList.toggle('on',on);t.setAttribute('aria-selected',on)});
  panels.forEach(p=>p.classList.toggle('on',p.id==='p-'+d));
}
tabs.forEach(t=>t.addEventListener('click',()=>showDay(t.dataset.d)));
showDay(['sun','mon','tue','wed','thu','fri','sat'][new Date().getDay()]);

/* ---------- progress store ---------- */
let progress = loadProgress();

const saveStatus = document.getElementById('saveStatus');
function setSaveStatus(text, color) {
  saveStatus.textContent = text;
  saveStatus.style.color = color || 'var(--twilight)';
}

/* Called after every mutation. The localStorage write is synchronous and
   effectively cannot fail, so status goes straight to saved; Task 8 hangs the
   remote queue off the same call. */
function commit(dates) {
  for (const date of dates) {
    progress[date] = { ...progress[date], u: new Date().toISOString() };
  }
  saveProgress(progress);
  setSaveStatus('✓ saved', 'var(--linseed)');
  setTimeout(() => {
    if (saveStatus.textContent === '✓ saved') setSaveStatus('');
  }, 2500);
  queueSync(dates);
  renderWeek();
}

/* ---------- remote sync ---------- */
const syncEl = document.getElementById('syncStatus');
let lastSyncAt = null;
let syncTimer = null;
let attempt = 0;
let flushing = false;

function setSyncStatus(text, color) {
  syncEl.textContent = text;
  syncEl.style.color = color || 'var(--twilight)';
}

function describeIdle() {
  const pending = loadPending();
  if (!isConfigured()) return setSyncStatus('local only · sync not configured');
  if (pending.length) return setSyncStatus(`offline · ${pending.length} unsynced`, 'var(--linseed)');
  if (lastSyncAt) {
    const mins = Math.round((Date.now() - lastSyncAt) / 60000);
    return setSyncStatus(mins < 1 ? 'synced · just now' : `synced · ${mins} min ago`);
  }
  setSyncStatus('');
}

async function flushSync() {
  if (!isConfigured()) return describeIdle();
  /* 'online', visibilitychange and the debounce timer all call this with no
     coordination. Two overlapping pushes would race the same way A1 did, so a
     second caller re-arms the debounce instead of starting its own push. */
  if (flushing) return armFlush();
  const dates = loadPending();
  if (!dates.length) return describeIdle();
  flushing = true;
  setSyncStatus('syncing…');
  try {
    /* push() serialises its body synchronously, so these are the exact values
       the network sees. A date whose 'u' has moved on by the time we get back
       was ticked mid-flight and must stay queued. */
    const sent = dates.map((d) => (progress[d] || {}).u);
    await push(progress, dates);
    clearPending(clearableDates(dates, sent, progress));
    lastSyncAt = Date.now();
    attempt = 0;
    if (loadPending().length) armFlush();
    describeIdle();
  } catch {
    /* Back off 1s, 2s, 4s, 8s, then stop and wait for the next tick or an
       'online' event. An unbounded retry loop would burn battery all day. */
    if (attempt < 4) {
      attempt++;
      setSyncStatus(`retrying sync (${attempt}/4)…`, 'var(--linseed)');
      clearTimeout(syncTimer);
      syncTimer = setTimeout(flushSync, 1000 * 2 ** (attempt - 1));
    } else {
      attempt = 0;
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
const todayISO = () => iso(new Date());
let selDate=todayISO();

/* ---------- scorecard ---------- */
const ticks={s:document.getElementById('t-s'),w:document.getElementById('t-w'),z:document.getElementById('t-z')};
const scDate=document.getElementById('scDate'),backBtn=document.getElementById('backToday');

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
  const rec = progress[selDate] || (progress[selDate] = {});
  if ((rec.note || '') !== noteInput.value.trim()) {
    rec.note = noteInput.value.trim();
    commit([selDate]);
  }
});

function renderScorecard(){
  const rec=progress[selDate]||{};
  Object.entries(ticks).forEach(([k,el])=>el.classList.toggle('done',!!rec[k]));
  const d=new Date(selDate+'T00:00:00');
  const isToday=selDate===todayISO();
  scDate.textContent=(isToday?'Today · ':'')+d.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
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

function renderStreak() {
  document.getElementById('streak').textContent = computeStreak(progress, iso(new Date()));
}

/* ---------- calendar ---------- */
let calY,calM;
{const n=new Date();calY=n.getFullYear();calM=n.getMonth()}
const grid=document.getElementById('calGrid'),mName=document.getElementById('mName');

function renderCalendar(){
  mName.textContent=new Date(calY,calM,1).toLocaleDateString('en-IN',{month:'long',year:'numeric'});
  grid.innerHTML='';
  ['S','M','T','W','T','F','S'].forEach(d=>{
    const h=document.createElement('div');h.className='cal-dow t-label';h.textContent=d;grid.appendChild(h);
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
    /* A complete day is a filled block, so consecutive ones read as one bar.
       A partial day shows one bar per habit. A past day with nothing on it
       gets a dot ball — in a scorebook that mark means "failed to score". */
    let mk='';
    if(!full){
      mk=(rec.s?'<i class="b-s"></i>':'')+(rec.w?'<i class="b-w"></i>':'')+(rec.z?'<i class="b-z"></i>':'');
      if(!mk&&dISO<tISO)mk='<span class="dot">·</span>';
    }
    const c=document.createElement('button');
    c.type='button';
    c.className='cell'+(dISO===tISO?' today':'')+(full?' full':'')+(dISO===selDate?' sel':'');
    c.innerHTML=`<span class="dnum t-time">${d}</span><span class="mk">${mk}</span>`;
    c.title=dISO;
    c.addEventListener('click',()=>{selDate=dISO;renderScorecard();renderCalendar();
      document.querySelector('.scorecard').scrollIntoView({behavior:'smooth',block:'center'})});
    grid.appendChild(c);
  }
  document.getElementById('stFull').textContent=cF;
  document.getElementById('stS').textContent=cS;
  document.getElementById('stW').textContent=cW;
}
document.getElementById('prevM').addEventListener('click',()=>{calM--;if(calM<0){calM=11;calY--}renderCalendar()});
document.getElementById('nextM').addEventListener('click',()=>{calM++;if(calM>11){calM=0;calY++}renderCalendar()});

/* ---------- exam countdown ---------- */
function renderExam() {
  const next = nextExam(todayISO());
  if (!next) return;   /* every exam past — the line stays empty */

  const line = document.getElementById('examLine');
  line.textContent = next.days === 0 ? `${next.label} · today`
                   : next.days === 1 ? `${next.label} · 1 day`
                   : `${next.label} · ${next.days} days`;
  const group = EXAMS.find((e) => e.label === next.label);
  line.title = `${next.label} · ${formatExamDates(group.dates)}`;
}

renderExam();

/* ---------- weekly summary ---------- */
function renderWeek() {
  const start = weekStart(todayISO());
  const sum = weeklySummary(progress, start);
  document.getElementById('weekStats').innerHTML = [
    [`${sum.study}/5`, 'Study days'],
    [`${sum.workout}/7`, 'Workouts'],
    [`${sum.sleep}/7`, 'Slept by 11'],
    [sum.bestStreak, 'Best streak'],
  ].map(([n, cap]) =>
    `<div class="week-stat"><b class="t-title">${n}</b><span class="t-label">${cap}</span></div>`).join('');

  const notes = document.getElementById('weekNotes');
  notes.innerHTML = sum.notes.length
    ? sum.notes.map((n) => {
        const label = new Date(n.date + 'T00:00:00')
          .toLocaleDateString('en-IN', { weekday: 'short', day: 'numeric' });
        return `<li class="ledger"><span class="when t-time">${label}</span>` +
               `<span class="what t-note">${n.note}</span></li>`;
      }).join('')
    : `<li class="t-note">No notes yet this week — the week started ${start}.</li>`;
}

/* ---------- export ---------- */
function download(filename, text, mime) {
  const url = URL.createObjectURL(new Blob([text], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
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

/* ---------- init ---------- */
renderScorecard();
renderCalendar();
renderWeek();

(async () => {
  if (!isConfigured()) return describeIdle();
  try {
    setSyncStatus('syncing…');
    progress = mergeProgress(progress, await pull());
    saveProgress(progress);
    renderScorecard();
    renderCalendar();
    renderWeek();
    lastSyncAt = Date.now();
  } catch {
    /* Offline or unreachable — localStorage already rendered, so there is
       nothing for the user to lose here. */
  }
  flushSync();
})();

window.addEventListener('online', flushSync);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden' && loadPending().length) flushSync();
});
setInterval(describeIdle, 60000);

/* ---------- service worker ---------- */
if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('./sw.js').catch(() => {
      /* Registration fails over file:// and on some private modes. The app
         works fine without it — only offline start-up is lost. */
    });
  });
}
