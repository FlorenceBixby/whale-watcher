export function renderUI() {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Whale Watcher</title>
<style>
:root{--bg:#0f1115;--card:#171a21;--line:#262b36;--text:#e6e8ee;--muted:#8b93a7;--accent:#5b8def;--ok:#3fb950;--warn:#e5a50a;--bad:#f85149}
*{box-sizing:border-box;margin:0;padding:0}
body{background:var(--bg);color:var(--text);font:14px/1.5 -apple-system,BlinkMacSystemFont,"Inter",Segoe UI,sans-serif;padding:32px 20px;max-width:960px;margin:0 auto}
h1{font-size:22px;font-weight:600;letter-spacing:-.01em}
h1 span{color:var(--muted);font-weight:400;font-size:14px;margin-left:10px}
.grid{display:grid;grid-template-columns:320px 1fr;gap:16px;margin-top:24px}
@media(max-width:760px){.grid{grid-template-columns:1fr}}
.card{background:var(--card);border:1px solid var(--line);border-radius:12px;padding:18px}
.card h2{font-size:12px;text-transform:uppercase;letter-spacing:.08em;color:var(--muted);margin-bottom:12px}
label{display:block;font-size:12px;color:var(--muted);margin:10px 0 4px}
input{width:100%;background:#0f1115;border:1px solid var(--line);border-radius:8px;color:var(--text);padding:9px 11px;font:inherit}
input:focus{outline:none;border-color:var(--accent)}
.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:12px}
button{background:var(--accent);color:#fff;border:0;border-radius:8px;padding:9px 14px;font:inherit;font-weight:600;cursor:pointer}
button.ghost{background:transparent;border:1px solid var(--line);color:var(--text)}
button:disabled{opacity:.5;cursor:default}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin-top:8px}
.chip{background:#0f1115;border:1px solid var(--line);border-radius:999px;padding:4px 10px;font-size:13px;display:flex;gap:6px;align-items:center}
.chip b{cursor:pointer;color:var(--muted)}
.chip b:hover{color:var(--bad)}
.status{display:grid;grid-template-columns:1fr 1fr;gap:8px 16px;font-size:13px}
.status div span{color:var(--muted);display:block;font-size:11px;text-transform:uppercase;letter-spacing:.06em}
.dot{display:inline-block;width:8px;height:8px;border-radius:50%;margin-right:6px;background:var(--muted)}
.dot.on{background:var(--ok)}
.alert{padding:12px 0;border-top:1px solid var(--line)}
.alert:first-child{border-top:0;padding-top:0}
.alert .meta{font-size:11px;color:var(--muted);text-transform:uppercase;letter-spacing:.06em;margin-bottom:3px}
.tag{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;margin-right:6px;text-transform:none;letter-spacing:0}
.tag.flow{background:#26307a;color:#c7d0ff}.tag.darkpool{background:#2b2d31;color:#cfd3dc}.tag.congress{background:#5a3a10;color:#ffd9a8}.tag.insider{background:#12442a;color:#b5f2c9}
.err{color:var(--bad);font-size:12px;margin-top:8px;word-break:break-word}
.empty{color:var(--muted);font-size:13px}
</style>
</head>
<body>
<h1>Whale Watcher <span>unusual money, in plain English — one agent per watchlist</span></h1>
<div class="grid">
  <div>
    <div class="card">
      <h2>Watchlist</h2>
      <label>Admin key</label><input id="key" type="password" autocomplete="off" placeholder="ADMIN_KEY">
      <label>Watchlist name</label><input id="name" value="main" placeholder="main">
      <label>Add tickers</label><input id="tickers" placeholder="NVDA AAPL TSLA">
      <div class="row"><button id="add">Add</button><button id="load" class="ghost">Load</button></div>
      <div class="chips" id="chips"></div>
    </div>
    <div class="card" style="margin-top:16px">
      <h2>Agent</h2>
      <div class="status" id="status"><div class="empty">Load a watchlist.</div></div>
      <div class="row"><button id="start">Start polling</button><button id="stop" class="ghost">Stop</button><button id="poll" class="ghost">Poll now</button></div>
      <label>Poll every (seconds)</label><input id="every" value="300">
      <div class="err" id="err"></div>
    </div>
  </div>
  <div class="card">
    <h2>Recent alerts</h2>
    <div id="alerts"><div class="empty">Nothing yet.</div></div>
  </div>
</div>
<script>
const $=id=>document.getElementById(id);
try{$('key').value=localStorage.getItem('ww_key')||'';$('name').value=localStorage.getItem('ww_name')||'main'}catch{}
let timer=null;
async function api(path,body){
  try{localStorage.setItem('ww_key',$('key').value);localStorage.setItem('ww_name',$('name').value)}catch{}
  const res=await fetch('/api/watchlists/'+encodeURIComponent($('name').value.trim().toLowerCase())+(path||''),{
    method:body?'POST':'GET',headers:{'Content-Type':'application/json','X-Admin-Key':$('key').value},body:body?JSON.stringify(body):undefined});
  const data=await res.json().catch(()=>({}));
  if(!res.ok)throw new Error(data.error||('HTTP '+res.status));
  return data;
}
function render(s){
  $('chips').innerHTML=(s.tickers||[]).map(t=>'<span class="chip">'+t+'<b data-t="'+t+'" title="remove">&times;</b></span>').join('')||'<span class="empty">No tickers yet.</span>';
  $('status').innerHTML=[
    ['State','<span class="dot '+(s.running?'on':'')+'"></span>'+(s.running?'polling every '+s.pollEverySeconds+'s':'stopped')],
    ['Polls',s.polls||0],['Last poll',s.lastPollAt?new Date(s.lastPollAt).toLocaleTimeString():'—'],
    ['Thresholds','flow ≥ $'+Math.round(s.thresholds.minFlowPremium/1000)+'K · dark ≥ $'+Math.round(s.thresholds.minDarkpoolPremium/1e6)+'M']
  ].map(([k,v])=>'<div><span>'+k+'</span>'+v+'</div>').join('');
  $('err').textContent=s.lastError||'';
  $('alerts').innerHTML=(s.alerts||[]).length?s.alerts.map(a=>'<div class="alert"><div class="meta"><span class="tag '+a.feed+'">'+a.feed+'</span>'+a.ticker+' · '+new Date(a.detectedAt).toLocaleString()+'</div><div>'+esc(a.text)+'</div></div>').join(''):'<div class="empty">Nothing yet — add tickers and hit Poll now.</div>';
}
const esc=s=>String(s).replace(/[&<>]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
async function refresh(){try{render(await api());$('err').textContent=''}catch(e){$('err').textContent=e.message}}
function watch(){clearInterval(timer);timer=setInterval(refresh,10000)}
$('load').onclick=()=>{refresh();watch()};
$('add').onclick=async()=>{try{render(await api('/tickers',{add:$('tickers').value}));$('tickers').value='';watch()}catch(e){$('err').textContent=e.message}};
$('chips').onclick=async e=>{const t=e.target.dataset.t;if(t){try{render(await api('/tickers',{remove:t}))}catch(err){$('err').textContent=err.message}}};
$('start').onclick=async()=>{try{await api('/start',{everySeconds:Number($('every').value)});await refresh();watch()}catch(e){$('err').textContent=e.message}};
$('stop').onclick=async()=>{try{await api('/stop',{});await refresh()}catch(e){$('err').textContent=e.message}};
$('poll').onclick=async()=>{$('poll').disabled=true;try{await api('/poll',{});await refresh();watch()}catch(e){$('err').textContent=e.message}finally{$('poll').disabled=false}};
if($('key').value){refresh();watch()}
</script>
</body>
</html>`;
}
