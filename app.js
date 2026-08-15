/* ---------- day tabs ---------- */
const tabs=document.querySelectorAll('.tab'),panels=document.querySelectorAll('.panel');
function showDay(d){
  tabs.forEach(t=>{const on=t.dataset.d===d;t.classList.toggle('on',on);t.setAttribute('aria-selected',on)});
  panels.forEach(p=>p.classList.toggle('on',p.id==='p-'+d));
}
tabs.forEach(t=>t.addEventListener('click',()=>showDay(t.dataset.d)));
showDay(['sun','mon','tue','wed','thu','fri','sat'][new Date().getDay()]);

/* ---------- progress store ---------- */
const KEY='weekly-innings-progress';
let progress={};           /* {"2026-08-20":{s:1,w:1,z:1}} */
let memoryOnly=false;
const hasStore=typeof window.storage!=='undefined'&&window.storage&&typeof window.storage.get==='function';

async function loadProgress(attempt=1){
  if(!hasStore){memoryOnly=true;document.getElementById('storageNote').style.display='block';return}
  try{
    const r=await window.storage.get(KEY);
    if(r&&r.value)progress=JSON.parse(r.value);
  }catch(e){
    /* A missing key also throws — only retry on what looks like a
       server error, so a fresh start doesn't loop forever. */
    const msg=String(e&&e.message||e);
    if(attempt<3&&/server|internal|network|timeout/i.test(msg)){
      await new Promise(res=>setTimeout(res,1200*attempt));
      return loadProgress(attempt+1);
    }
  }
}
/* Debounced save with automatic retry — the storage backend can
   occasionally return a transient server error, so we retry with
   backoff and show status instead of silently dropping the tick. */
const saveStatus=document.getElementById('saveStatus');
let saveTimer=null,retries=0;
function setStatus(txt,color){saveStatus.textContent=txt;saveStatus.style.color=color||'var(--muted)'}

function saveProgress(){           /* callers don't need to await */
  if(memoryOnly)return;
  clearTimeout(saveTimer);
  setStatus('saving…');
  saveTimer=setTimeout(doSave,600); /* coalesce rapid ticks into one write */
}
async function doSave(){
  try{
    const r=await window.storage.set(KEY,JSON.stringify(progress));
    if(!r)throw new Error('empty result');
    retries=0;
    setStatus('✓ saved','#7BC49A');
    setTimeout(()=>{if(saveStatus.textContent==='✓ saved')setStatus('')},2500);
  }catch(e){
    if(retries<4){
      retries++;
      const wait=1000*Math.pow(2,retries-1);   /* 1s, 2s, 4s, 8s */
      setStatus('retrying save ('+retries+'/4)…','var(--amber)');
      saveTimer=setTimeout(doSave,wait);
    }else{
      retries=0;
      setStatus('⚠ not saved — tap any tick to retry','var(--ball)');
    }
  }
}
/* if a save is still pending when the page is left, try once more */
document.addEventListener('visibilitychange',()=>{
  if(document.visibilityState==='hidden'&&saveTimer){clearTimeout(saveTimer);doSave()}
});

/* ---------- dates ---------- */
const iso=d=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
const todayISO=()=>iso(new Date());
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
  el.addEventListener('click',async()=>{
    const rec=progress[selDate]||(progress[selDate]={});
    rec[k]=rec[k]?0:1;
    renderScorecard();renderCalendar();
    saveProgress();
  });
});
backBtn.addEventListener('click',()=>{selDate=todayISO();renderScorecard();renderCalendar()});

function renderStreak(){
  let n=0,d=new Date();
  /* today counts if already complete; otherwise start from yesterday */
  const t=progress[iso(d)];
  if(!(t&&t.s&&t.w))d.setDate(d.getDate()-1);
  while(true){
    const r=progress[iso(d)];
    if(r&&r.s&&r.w){n++;d.setDate(d.getDate()-1)}else break;
  }
  document.getElementById('streak').textContent=n;
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
(async()=>{await loadProgress();renderScorecard();renderCalendar()})();
