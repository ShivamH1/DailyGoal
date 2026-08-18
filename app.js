import { loadProgress, saveProgress, loadPending, markPending, clearPending } from './storage.js';
import { computeStreak, iso, mergeProgress } from './progress.js';
import { pull, push, isConfigured } from './sync.js';
import { WEEK, DAY_KEYS, istNow, resolveNow } from './schedule.js';

/* ---------- day panels ---------- */
function rowHTML(dayKey, block, i) {
  const subj = block.subject ? `<span class="subj">${block.subject}</span>` : '';
  const eff = block.effort ? `<span class="effort ${block.effort.cls}">${block.effort.text}</span>` : '';
  const detail = block.detail ? `<em>${block.detail}</em>` : '';
  return `<div class="row" data-day="${dayKey}" data-i="${i}">` +
         `<div class="time">${block.time}</div>` +
         `<div class="bar b-${block.lane}"></div>` +
         `<div class="what"><strong>${block.label}${subj}${eff}</strong>${detail}</div></div>`;
}

function renderDay(dayKey) {
  const day = WEEK[dayKey];
  document.getElementById('p-' + dayKey).innerHTML =
    `<div class="day-head"><h2>${day.title}</h2><span class="tag">${day.tag}</span></div>` +
    `<p class="day-note">${day.note}</p>` +
    day.blocks.map((b, i) => rowHTML(dayKey, b, i)).join('');
}

DAY_KEYS.forEach(renderDay);

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
  saveStatus.style.color = color || 'var(--muted)';
}

/* Called after every mutation. The localStorage write is synchronous and
   effectively cannot fail, so status goes straight to saved; Task 8 hangs the
   remote queue off the same call. */
function commit(dates) {
  for (const date of dates) {
    progress[date] = { ...progress[date], u: new Date().toISOString() };
  }
  saveProgress(progress);
  setSaveStatus('✓ saved', '#7BC49A');
  setTimeout(() => {
    if (saveStatus.textContent === '✓ saved') setSaveStatus('');
  }, 2500);
  queueSync(dates);
}

/* ---------- remote sync ---------- */
const syncEl = document.getElementById('syncStatus');
let lastSyncAt = null;
let syncTimer = null;
let attempt = 0;

function setSyncStatus(text, color) {
  syncEl.textContent = text;
  syncEl.style.color = color || 'var(--muted)';
}

function describeIdle() {
  const pending = loadPending();
  if (!isConfigured()) return setSyncStatus('local only · sync not configured');
  if (pending.length) return setSyncStatus(`offline · ${pending.length} unsynced`, 'var(--amber)');
  if (lastSyncAt) {
    const mins = Math.round((Date.now() - lastSyncAt) / 60000);
    return setSyncStatus(mins < 1 ? 'synced · just now' : `synced · ${mins} min ago`);
  }
  setSyncStatus('');
}

async function flushSync() {
  if (!isConfigured()) return describeIdle();
  const dates = loadPending();
  if (!dates.length) return describeIdle();
  setSyncStatus('syncing…');
  try {
    await push(progress, dates);
    clearPending(dates);
    lastSyncAt = Date.now();
    attempt = 0;
    describeIdle();
  } catch {
    /* Back off 1s, 2s, 4s, 8s, then stop and wait for the next tick or an
       'online' event. An unbounded retry loop would burn battery all day. */
    if (attempt < 4) {
      attempt++;
      setSyncStatus(`retrying sync (${attempt}/4)…`, 'var(--amber)');
      clearTimeout(syncTimer);
      syncTimer = setTimeout(flushSync, 1000 * 2 ** (attempt - 1));
    } else {
      attempt = 0;
      describeIdle();
    }
  }
}

function queueSync(dates) {
  markPending(dates);
  clearTimeout(syncTimer);
  syncTimer = setTimeout(flushSync, 600);   /* coalesce rapid ticks */
}

/* ---------- dates ---------- */
const todayISO = () => iso(new Date());
let selDate=todayISO();

/* ---------- scorecard ---------- */
const ticks={s:document.getElementById('t-s'),w:document.getElementById('t-w'),z:document.getElementById('t-z')};
const scDate=document.getElementById('scDate'),backBtn=document.getElementById('backToday');

function renderScorecard(){
  const rec=progress[selDate]||{};
  Object.entries(ticks).forEach(([k,el])=>el.classList.toggle('done',!!rec[k]));
  const d=new Date(selDate+'T00:00:00');
  const isToday=selDate===todayISO();
  scDate.textContent=(isToday?'Today · ':'')+d.toLocaleDateString('en-IN',{weekday:'short',day:'numeric',month:'short'});
  backBtn.style.display=isToday?'none':'inline';
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
    const c=document.createElement('div');
    c.className='cell'+(dISO===tISO?' today':'')+(full?' full':'')+(dISO===selDate?' sel':'');
    c.innerHTML=`<span class="dnum">${d}</span><span class="pips">${rec.s?'<i class="pip p-s"></i>':''}${rec.w?'<i class="pip p-w"></i>':''}${rec.z?'<i class="pip p-z"></i>':''}</span>`;
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

/* ---------- init ---------- */
renderScorecard();
renderCalendar();

(async () => {
  if (!isConfigured()) return describeIdle();
  try {
    setSyncStatus('syncing…');
    progress = mergeProgress(progress, await pull());
    saveProgress(progress);
    renderScorecard();
    renderCalendar();
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
