import { createStore, initialsAvatar } from "./store";
import { buildBriefPrompt, parseBriefReply } from "../briefPrompt";

// Доска команды. Перенесена из прототипа: интерфейс на DOM, данные в Supabase.
export function startBoard({ sb, me }) {

/* ---------------- constants ---------------- */
const BLOCKS = [
  {id:"plan",  label:"Месячный план", ix:"01"},
  {id:"tests", label:"Тестовая доска", ix:"02"},
  {id:"ideas", label:"Идеи", ix:"03"},
  {id:"calls", label:"Созвоны", ix:"04"},
  {id:"admin", label:"Доступы и логи", ix:"05"},
];
const TASK_ST = [
  {id:"planned", label:"Запланировано", cls:"", dot:"var(--idle)"},
  {id:"in_progress", label:"В работе", cls:"acc", dot:"var(--accent)"},
  {id:"need_data", label:"Нужны данные", cls:"warn", dot:"var(--warn)"},
  {id:"done", label:"Завершено", cls:"ok", dot:"var(--ok)"},
  {id:"rejected", label:"Отклонено", cls:"crit", dot:"var(--crit)"},
];
const TEST_COL = [
  {id:"backlog", label:"Бэклог", dot:"var(--idle)"},
  {id:"prep", label:"Подготовка", dot:"var(--ink-3)"},
  {id:"testing", label:"Тест", dot:"var(--accent)"},
  {id:"review", label:"Проверка", dot:"var(--warn)"},
  {id:"processing", label:"Обработка", dot:"#8a5cf6"},
  {id:"done", label:"Завершено", dot:"var(--ok)"},
];
const IDEA_ST = [
  {id:"new", label:"Новая", cls:""},
  {id:"call", label:"Обсудить на созвоне", cls:"warn"},
  {id:"taken", label:"Взята в работу", cls:"ok"},
  {id:"dropped", label:"Отложена", cls:"crit"},
];
const ROLES = [
  {id:"admin", label:"Администратор"},
  {id:"buyer", label:"Медиабайер"},
  {id:"viewer", label:"Наблюдатель"},
];
const DEFAULT_BLOCKS = { buyer:["plan","tests","ideas","calls"], viewer:["plan","ideas","calls"] };
const MONTHS = ["Январь","Февраль","Март","Апрель","Май","Июнь","Июль","Август","Сентябрь","Октябрь","Ноябрь","Декабрь"];
const MONTHS_G = ["янв","фев","мар","апр","мая","июн","июл","авг","сен","окт","ноя","дек"];

/* ---------------- state ---------------- */
const S = {
  db:null, user:null, sample:null, assets:null,
  ai:{brief:false,transcribe:false}, me:null, meRole:"viewer", canEdit:false, isOwner:false, canWrite:null, readOnly:false, profiles:[],
  hubs:[], tasks:[], tests:[], ideas:[], calls:[], members:{}, access:null, logs:[],
  loaded:{}, names:{}, view:"plan",
  month: monthKey(new Date()), planMode:"hubs",
  ideaFilter:"all", testFilter:"all", callSel:null, hubTab:"list",
  drawer:null, offline:false,
};

/* ---------------- helpers ---------------- */
function monthKey(d){ return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0"); }
function monthLabel(k){ const [y,m]=k.split("-"); return MONTHS[+m-1]+" "+y; }
function shiftMonth(k,n){ const [y,m]=k.split("-").map(Number); return monthKey(new Date(y,m-1+n,1)); }
function today(){ const d=new Date(); return d.getFullYear()+"-"+String(d.getMonth()+1).padStart(2,"0")+"-"+String(d.getDate()).padStart(2,"0"); }
function fmtDate(s){ if(!s) return "—"; const [y,m,d]=s.split("-"); return (+d)+" "+MONTHS_G[+m-1]; }
function fmtTime(ms){ if(!ms) return ""; const d=new Date(ms); return d.getDate()+" "+MONTHS_G[d.getMonth()]+", "+String(d.getHours()).padStart(2,"0")+":"+String(d.getMinutes()).padStart(2,"0"); }
function isLate(due, done){ return !!due && !done && due < today(); }
function money(n){ n=Number(n)||0; return "$"+n.toLocaleString("ru-RU",{maximumFractionDigits:0}); }
function h(tag, attrs, ...kids){
  const el = document.createElement(tag);
  if(attrs) for(const [k,v] of Object.entries(attrs)){
    if(v==null || v===false) continue;
    if(k==="class") el.className=v;
    else if(k==="text") el.textContent=v;
    else if(k.startsWith("on")) el.addEventListener(k.slice(2), v);
    else if(k==="style") el.setAttribute("style", v);
    else el.setAttribute(k, v===true?"":v);
  }
  for(const c of kids.flat()){ if(c==null||c===false) continue; el.append(c.nodeType?c:document.createTextNode(String(c))); }
  return el;
}
function toast(msg){ const t=document.getElementById("toast"); t.textContent=msg; t.classList.add("on"); clearTimeout(toast._t); toast._t=setTimeout(()=>t.classList.remove("on"),2600); }
function pill(list, id){ const s=list.find(x=>x.id===id)||list[0]; return h("span",{class:"pill "+(s.cls||"")},s.label); }
function uid(){ return S.me; }

/* ---------------- people ---------------- */
function nameOf(id){ return (S.names[id] && S.names[id].name) || (id===S.me ? "Вы" : "Участник"); }
function avatarOf(id){ return (S.names[id] && S.names[id].avatarUrl) || ""; }
function av(id){ const src=avatarOf(id); const img=h("img",{class:"av",alt:"",title:nameOf(id)}); if(src) img.src=src; return img; }
function avs(ids){ return h("span",{class:"avs"}, (ids||[]).slice(0,4).map(av)); }
function person(id){ return h("span",{class:"person"}, av(id), h("span",{text:nameOf(id)})); }
function resolvePeople(){}

/* ---------------- roles & access ---------------- */
function myRole(){ return (S.members[S.me] && S.members[S.me].role) || S.meRole || "viewer"; }
function isAdmin(){ return myRole()==="admin"; }
function blocksFor(role){
  if(role==="admin") return BLOCKS.map(b=>b.id);
  const a=(S.access && S.access.blocks && S.access.blocks[role]) || DEFAULT_BLOCKS[role] || [];
  return a.filter(id=>id!=="admin");
}
function canTouchTask(t){ return !S.readOnly && (isAdmin() || (t.assignees||[]).includes(S.me)); }
function canTouchTest(t){ return !S.readOnly && (isAdmin() || t.reviewer===S.me || t.createdBy===S.me || (t.assignees||[]).includes(S.me)); }
function canWriteAny(){ return !S.readOnly && myRole()!=="viewer"; }

/* ---------------- db writes ---------------- */
async function write(fn, okMsg){
  if(!S.db){ toast("Хранилище недоступно — изменения не сохранены"); return false; }
  try{ await fn(); if(okMsg) toast(okMsg); return true; }
  catch(e){
    if(e && e.code==="invalid_argument") toast("Недостаточно прав для этого действия");
    else if(e && e.code==="quota_exceeded") toast("Хранилище заполнено: удалите старые записи");
    else toast("Не сохранилось: "+((e&&e.message)||"ошибка"));
    return false;
  }
}
function logAction(action, target){
  if(S.readOnly) return;
  sb.from("logs").insert({action, target:String(target||"").slice(0,140)}).then(()=>{ if(S.view==="admin") loadLogs(); });
}

/* ---------------- subscriptions ---------------- */
function sub(path, key, map){
  const timer=setTimeout(()=>{ if(!S.loaded[key]){ S.offline=true; refresh(); } },10000);
  S.db.collection(path).onSnapshot(snap=>{
    if(!snap.metadata.fromCache){ clearTimeout(timer); S.offline=false; }
    S[key] = map ? map(snap) : snap.docs.map(d=>Object.assign({id:d.id}, d.data()));
    S.loaded[key]=true;
    if(key!=="logs") resolvePeople();
    refresh();
  }, err=>{ clearTimeout(timer); S.loaded[key]=true; refresh(); });
}
function subAll(){
  sub("hubs","hubs");
  sub("tasks","tasks");
  sub("tests","tests");
  sub("ideas","ideas");
  sub("calls","calls");
  S.db.doc("settings/access").onSnapshot(d=>{ S.access = d.exists ? d.data() : null; renderNav(); refresh(); }, ()=>{});
}

/* ---------------- nav & shell ---------------- */
function renderNav(){
  const allowed=blocksFor(myRole());
  if(!allowed.includes(S.view)) S.view=allowed[0]||"plan";
  const nav=document.getElementById("nav"); nav.textContent="";
  for(const b of BLOCKS){
    if(!allowed.includes(b.id)) continue;
    let badge=null;
    if(b.id==="ideas"){ const n=S.ideas.filter(i=>i.status==="call").length; if(n) badge=h("span",{class:"badge",title:"Ждут созвона"},n); }
    if(b.id==="admin"){ const n=S.profiles.filter(p=>p.status==="pending").length; if(n) badge=h("span",{class:"badge",title:"Заявки на вход",style:"background:var(--warn-soft);color:var(--warn)"},n); }
    if(b.id==="tests"){ const n=S.tests.filter(t=>t.column==="testing").length; if(n) badge=h("span",{class:"badge",title:"Сейчас в тесте"},n); }
    nav.append(h("button",{class:"nav-btn","aria-current":S.view===b.id?"page":null,onclick:()=>go(b.id)},
      h("span",{class:"ix"},b.ix), h("span",null,b.label), badge));
  }
}
function renderMe(){
  const el=document.getElementById("me"); el.textContent="";
  const r=ROLES.find(x=>x.id===myRole());
  const form=h("form",{action:"/auth/signout",method:"post"},h("button",{class:"signout",type:"submit"},"Выйти"));
  el.append(av(S.me), h("div",{style:"min-width:0"}, h("div",{text:nameOf(S.me)}), h("div",{class:"role"}, r?r.label:"", " · "), form));
  form.style.display="inline";
}
function go(id){ S.view=id; try{ history.replaceState(null,"","#"+id); }catch(_){ location.hash=id; } mount(); }
window.addEventListener("hashchange",()=>{ const id=location.hash.slice(1); if(BLOCKS.some(b=>b.id===id) && id!==S.view){ S.view=id; mount(); } });

let mounted=null;
function mount(){
  renderNav();
  const main=document.getElementById("main"); main.textContent="";
  const views={plan:mountPlan, tests:mountTests, ideas:mountIdeas, calls:mountCalls, admin:mountAdmin};
  mounted = views[S.view]();
  main.append(mounted.el);
  mounted.update();
}
let rq=false;
function refresh(){
  if(rq) return; rq=true;
  requestAnimationFrame(()=>{ rq=false; renderNav(); if(mounted) mounted.update(); if(S.drawer && S.drawer.update) S.drawer.update(); });
}
function banner(){
  if(S.offline) return h("div",{class:"banner"},"База пока не отвечает: показанные данные могут быть устаревшими. Проверьте интернет.");
  if(S.readOnly) return h("div",{class:"banner"},"У вас роль «Наблюдатель»: можно смотреть, но не менять. Роль меняет администратор.");
  return null;
}

/* ================= 01 MONTH PLAN ================= */
function hubTasks(hubId){ return S.tasks.filter(t=>t.hubId===hubId); }
function monthHubs(){ return S.hubs.filter(hb=>hb.month===S.month).sort((a,b)=> (a.priority||"P3").localeCompare(b.priority||"P3") || (a.deadline||"9").localeCompare(b.deadline||"9")); }
function progress(tasks){
  const live=tasks.filter(t=>t.status!=="rejected");
  const c=k=>live.filter(t=>t.status===k).length;
  return {total:live.length, done:c("done"), work:c("in_progress"), need:c("need_data"), pct: live.length? Math.round(c("done")/live.length*100):0};
}
function progBar(p){
  if(!p.total) return h("div",{class:"bar"});
  return h("div",{class:"bar",title:`Готово ${p.done} из ${p.total}`},
    h("i",{class:"d",style:`width:${p.done/p.total*100}%`}),
    h("i",{class:"w",style:`width:${p.work/p.total*100}%`}),
    h("i",{class:"n",style:`width:${p.need/p.total*100}%`}));
}
function mountPlan(){
  const body=h("div"); const stats=h("div",{class:"stats"}); const ban=h("div");
  const segBtn=(id,label)=>h("button",{"aria-pressed":S.planMode===id?"true":"false",onclick:()=>{S.planMode=id; mount();}},label);
  const el=h("section",{class:"view"},
    h("div",{class:"view-head"},
      h("div",null,h("h1",null,"Месячный план"),h("div",{class:"sub"},"Хабы месяца, их задачи и движение по статусам")),
      h("div",{class:"spacer"}),
      h("div",{class:"month"},
        h("button",{"aria-label":"Предыдущий месяц",onclick:()=>{S.month=shiftMonth(S.month,-1); mount();}},"‹"),
        h("span",null,monthLabel(S.month)),
        h("button",{"aria-label":"Следующий месяц",onclick:()=>{S.month=shiftMonth(S.month,1); mount();}},"›")),
      h("div",{class:"seg",role:"group","aria-label":"Вид"}, segBtn("hubs","Хабы"), segBtn("tasks","Все задачи"), segBtn("board","Доска статусов")),
      isAdmin() && !S.readOnly ? h("button",{class:"btn primary",onclick:()=>openHub(null)},"+ Хаб") : null),
    ban, stats, body);
  return {el, update(){
    ban.textContent=""; const b=banner(); if(b) ban.append(b);
    const hubs=monthHubs(); const ids=new Set(hubs.map(x=>x.id));
    const tasks=S.tasks.filter(t=>ids.has(t.hubId));
    const p=progress(tasks);
    const late=tasks.filter(t=>isLate(t.deadline, t.status==="done"||t.status==="rejected")).length;
    stats.textContent="";
    stats.append(
      stat("Хабов в месяце", hubs.length),
      stat("Задач выполнено", h("span",null,p.done,h("small",null," / "+p.total))),
      stat("Нужны данные", p.need),
      stat("Просрочено", late, late?"var(--crit)":null));
    body.textContent="";
    if(S.planMode==="hubs") body.append(renderHubGrid(hubs));
    else if(S.planMode==="tasks") body.append(renderTaskTable(tasks));
    else body.append(renderStatusBoard(tasks));
  }};
}
function stat(k,v,color){ return h("div",{class:"stat"},h("div",{class:"k"},k),h("div",{class:"v",style:color?`color:${color}`:null},v)); }
function renderHubGrid(hubs){
  const g=h("div",{class:"hubs"});
  if(!hubs.length && !(isAdmin()&&!S.readOnly)) return h("div",{class:"empty"},"В этом месяце хабов пока нет.");
  for(const hb of hubs){
    const ts=hubTasks(hb.id); const p=progress(ts);
    const people=[...new Set(ts.flatMap(t=>t.assignees||[]))];
    const closed=hb.state==="closed";
    g.append(h("button",{class:"hub "+(hb.priority||"P3"),onclick:()=>openHub(hb.id)},
      h("div",{class:"row"}, h("span",{class:"prio "+(hb.priority||"P3")},hb.priority||"P3"),
        closed? h("span",{class:"pill ok"},"Закрыт") : null,
        h("span",{class:"spacer"}),
        h("span",{class:"num due"+(isLate(hb.deadline,closed)?" late":"")},"до "+fmtDate(hb.deadline))),
      h("h3",null,hb.title||"Без названия"),
      hb.goal? h("div",{class:"goal"},hb.goal):null,
      progBar(p),
      h("div",{class:"row"}, h("span",{class:"num muted"},p.pct+"% · "+p.done+"/"+p.total+" задач"),
        p.need? h("span",{class:"pill warn"},"нужны данные: "+p.need):null,
        h("span",{class:"spacer"}), avs(people))));
  }
  if(isAdmin() && !S.readOnly) g.append(h("button",{class:"hub-add",onclick:()=>openHub(null)},"+ Новый хаб на "+monthLabel(S.month).toLowerCase()));
  return g;
}
function renderTaskTable(tasks){
  if(!tasks.length) return h("div",{class:"empty"},"Задач в хабах этого месяца пока нет.");
  const hubName=id=>(S.hubs.find(x=>x.id===id)||{}).title||"—";
  const order=Object.fromEntries(TASK_ST.map((s,i)=>[s.id,i]));
  const rows=[...tasks].sort((a,b)=>(order[a.status]??0)-(order[b.status]??0) || (a.deadline||"9").localeCompare(b.deadline||"9"));
  return h("div",{class:"tbl-wrap"}, h("table",null,
    h("thead",null,h("tr",null,h("th",null,"Задача"),h("th",null,"Хаб"),h("th",null,"Исполнители"),h("th",null,"Срок"),h("th",null,"Статус"))),
    h("tbody",null, rows.map(t=>h("tr",{class:"click",onclick:()=>openTask(t.id)},
      h("td",null,h("b",null,t.title||"Без названия")),
      h("td",{class:"muted"},hubName(t.hubId)),
      h("td",null, (t.assignees||[]).length? h("span",{style:"display:flex;flex-direction:column;gap:4px"},(t.assignees||[]).map(person)) : h("span",{class:"muted"},"не назначено")),
      h("td",{class:"num due"+(isLate(t.deadline,t.status==="done"||t.status==="rejected")?" late":"")},fmtDate(t.deadline)),
      h("td",null,pill(TASK_ST,t.status)))))));
}
function kanban(cols, items, colOf, cardFn, canMove, onMove){
  const wrap=h("div",{class:"kanban"});
  for(const c of cols){
    const list=items.filter(x=>colOf(x)===c.id);
    const col=h("div",{class:"col","data-col":c.id},
      h("div",{class:"col-head"},h("span",{class:"dot",style:`background:${c.dot}`}),c.label,h("span",{class:"badge"},list.length)));
    col.addEventListener("dragover",e=>{ e.preventDefault(); col.classList.add("over"); });
    col.addEventListener("dragleave",()=>col.classList.remove("over"));
    col.addEventListener("drop",e=>{ e.preventDefault(); col.classList.remove("over"); const id=e.dataTransfer.getData("text/plain"); const it=items.find(x=>x.id===id); if(it && colOf(it)!==c.id) onMove(it,c.id); });
    if(!list.length) col.append(h("div",{class:"empty"},"Пусто"));
    for(const it of list){
      const card=cardFn(it);
      if(canMove(it)){
        card.setAttribute("draggable","true");
        card.addEventListener("dragstart",e=>{ e.dataTransfer.setData("text/plain",it.id); card.classList.add("dragging"); });
        card.addEventListener("dragend",()=>card.classList.remove("dragging"));
      }
      col.append(card);
    }
    wrap.append(col);
  }
  return wrap;
}
function moveTask(t,st){
  if(!canTouchTask(t)){ toast("Двигать задачу могут администраторы и её исполнители"); return; }
  write(()=>S.db.doc("tasks/"+t.id).update({status:st, updatedAt:Date.now()}));
  logAction("Статус задачи → "+TASK_ST.find(s=>s.id===st).label, t.title);
}
function renderStatusBoard(tasks){
  const hubName=id=>(S.hubs.find(x=>x.id===id)||{}).title||"";
  return kanban(TASK_ST, tasks, t=>t.status||"planned", t=>h("div",{class:"card",onclick:()=>openTask(t.id)},
      h("div",{class:"hubtag"},hubName(t.hubId)),
      h("div",{class:"t"},t.title||"Без названия"),
      h("div",{class:"meta"}, h("span",{class:"num due"+(isLate(t.deadline,t.status==="done"||t.status==="rejected")?" late":"")},fmtDate(t.deadline)), t.commentCount? h("span",{title:"Комментарии"},"💬 "+t.commentCount):null, h("span",{class:"spacer"}), avs(t.assignees))),
    canTouchTask, moveTask);
}

/* ---------------- drawer infra ---------------- */
function openDrawer(kind, build){
  const dr=document.getElementById("drawer"); dr.textContent=""; dr.classList.remove("wide");
  const body=h("div",{class:"dr-body"});
  const close=h("button",{class:"btn ghost","aria-label":"Закрыть",onclick:closeDrawer},"✕");
  const head=h("div",{class:"dr-head"},h("span",{class:"kind"},kind),h("span",{class:"spacer"}),close);
  dr.append(head, body);
  S.drawer = build(body, head) || {};
  dr.classList.add("on"); dr.setAttribute("aria-hidden","false");
  document.getElementById("scrim").classList.add("on");
}
function closeDrawer(){
  const dr=document.getElementById("drawer"); dr.classList.remove("on","wide"); dr.setAttribute("aria-hidden","true");
  document.getElementById("scrim").classList.remove("on"); S.drawer=null;
}
document.getElementById("scrim").addEventListener("click",closeDrawer);
document.addEventListener("keydown",e=>{ if(e.key==="Escape"){ if(document.getElementById("modal").classList.contains("on")) closeModal(); else if(S.drawer) closeDrawer(); }});
function confirmBox(text, okLabel, onOk){
  const box=document.getElementById("modalBox"); box.textContent="";
  box.append(h("div",{style:"font-weight:600;font-size:15px"},text),
    h("div",{class:"row-actions"},h("button",{class:"btn",onclick:closeModal},"Отмена"),h("button",{class:"btn primary",onclick:()=>{closeModal(); onOk();}},okLabel)));
  document.getElementById("modal").classList.add("on");
}
function closeModal(){ document.getElementById("modal").classList.remove("on"); }

/* field that saves itself on change */
function field(label, el, wide){ return h("label",{class:"f",style:wide?"grid-column:1/-1":null},label,el); }
function bindSave(el, getRef, key, opts={}){
  let last=el.value;
  const save=()=>{ const v=opts.num? Number(el.value)||0 : el.value; if(el.value===last) return; last=el.value; const ref=getRef(); if(!ref) return;
    write(()=>ref.update({[key]:v, updatedAt:Date.now()})); if(opts.log) logAction(opts.log, opts.logTarget? opts.logTarget():""); };
  el.addEventListener(el.tagName==="SELECT"?"change":"blur", save);
  if(el.tagName!=="SELECT" && el.tagName!=="TEXTAREA") el.addEventListener("keydown",e=>{ if(e.key==="Enter") el.blur(); });
  return el;
}

/* ---------------- people picker ---------------- */
function picker(selected, onChange, {single=false, disabled=false, placeholder="Добавить человека"}={}){
  let sel=[...(selected||[])];
  const chips=h("div",{class:"chips"}); const menu=h("div",{class:"menu"});
  const input=h("input",{type:"text",placeholder,"aria-label":placeholder,disabled});
  const wrap=h("div",{class:"picker"},chips,menu);
  function draw(){
    chips.textContent="";
    sel.forEach(id=>chips.append(h("span",{class:"chip"},av(id),h("span",{text:nameOf(id)}),
      disabled?null:h("button",{type:"button","aria-label":"Убрать",onclick:()=>{ sel=sel.filter(x=>x!==id); draw(); onChange(sel); }},"×"))));
    if(!disabled && (!single || !sel.length)) chips.append(input);
  }
  async function search(q){
    if(!S.user){ menu.classList.remove("on"); return; }
    const hits=await S.user.search(q);
    const known=new Set(hits.map(x=>x.id));
    const extra=Object.keys(S.members).filter(id=>!known.has(id) && (!q || nameOf(id).toLowerCase().includes(q.toLowerCase())));
    menu.textContent="";
    const all=[...hits.map(p=>{ S.names[p.id]={name:p.name,avatarUrl:p.avatarUrl}; return p.id; }), ...extra].filter(id=>!sel.includes(id));
    if(!all.length){ menu.append(h("div",{class:"muted",style:"padding:9px 10px;font-size:13px"},q?"Никого не нашлось":"Начните вводить имя")); }
    all.forEach(id=>menu.append(h("button",{type:"button",onmousedown:e=>{ e.preventDefault(); sel = single? [id] : [...sel,id]; input.value=""; menu.classList.remove("on"); draw(); onChange(sel); }},av(id),h("span",{text:nameOf(id)}))));
    menu.classList.add("on");
  }
  input.addEventListener("focus",()=>search(input.value));
  input.addEventListener("input",()=>search(input.value));
  input.addEventListener("blur",()=>setTimeout(()=>menu.classList.remove("on"),120));
  draw();
  return wrap;
}

/* ---------------- comments (shared by tasks & tests) ---------------- */
function commentsSection(collRef, onPosted){
  const list=h("div",{style:"display:flex;flex-direction:column;gap:10px"});
  const ta=h("textarea",{class:"i",rows:2,placeholder:"Прогресс, вопрос или обсуждение…","aria-label":"Новый комментарий"});
  let comments=[];
  const draw=()=>{ list.textContent=""; if(!comments.length) list.append(h("div",{class:"muted",style:"font-size:13px"},"Комментариев пока нет."));
    comments.forEach(c=>list.append(h("div",{class:"cmt"},av(c.author),h("div",{class:"b"},h("div",{class:"h"},h("b",{text:nameOf(c.author)}),h("span",null,fmtTime(c.at))),h("p",{text:c.text}))))); };
  const post=async()=>{ const txt=ta.value.trim(); if(!txt) return;
    const ok=await write(()=>collRef().add({author:S.me,text:txt,at:Date.now()}));
    if(ok){ ta.value=""; if(onPosted) onPosted(txt); } };
  ta.addEventListener("keydown",e=>{ if(e.key==="Enter"&&(e.metaKey||e.ctrlKey)) post(); });
  let unsub=null;
  if(S.db){ unsub=collRef().orderBy("at").onSnapshot(s=>{ comments=s.docs.map(d=>d.data()); draw();
    const ids=comments.map(c=>c.author).filter(Boolean);
    if(S.user && ids.length) S.user.profiles(ids).then(ps=>{ for(const [k,p] of Object.entries(ps)) S.names[k]={name:p.name,avatarUrl:p.avatarUrl}; draw(); }); },()=>{}); }
  draw();
  const el=h("div",{class:"sec"},h("h4",null,"Комментарии"),list,
    S.readOnly? null : h("div",{style:"display:flex;flex-direction:column;gap:8px"},ta,h("div",{class:"row-actions"},h("span",{class:"muted",style:"font-size:12px;margin-right:auto"},"Ctrl + Enter"),h("button",{class:"btn primary sm",onclick:post},"Отправить"))));
  return {el, unsub, draw};
}

/* ---------------- hub flow (block scheme) ---------------- */
function taskLevels(tasks){
  const byId=Object.fromEntries(tasks.map(t=>[t.id,t])); const lvl={}; const seen=new Set();
  const L=t=>{ if(lvl[t.id]!=null) return lvl[t.id]; if(seen.has(t.id)) return 0; seen.add(t.id);
    const ds=(t.dependsOn||[]).filter(d=>byId[d]&&d!==t.id); const v=ds.length? 1+Math.max(...ds.map(d=>L(byId[d]))) : 0;
    seen.delete(t.id); lvl[t.id]=v; return v; };
  tasks.forEach(L); return lvl;
}
function descendants(tasks, id){
  const out=new Set([id]); let grew=true;
  while(grew){ grew=false; for(const t of tasks){ if(!out.has(t.id) && (t.dependsOn||[]).some(d=>out.has(d))){ out.add(t.id); grew=true; } } }
  return out;
}
function hubFlow(hb, tasks){
  if(!tasks.length) return h("div",{class:"empty"},"Задач пока нет: схема появится, когда добавите первую.");
  const lvl=taskLevels(tasks); const byId=Object.fromEntries(tasks.map(t=>[t.id,t]));
  const order=Object.fromEntries(TASK_ST.map((s,i)=>[s.id,i]));
  const cols=[]; tasks.forEach(t=>{ (cols[lvl[t.id]]=cols[lvl[t.id]]||[]).push(t); });
  cols.forEach(c=>c.sort((a,b)=>(order[a.status]??0)-(order[b.status]??0)||(a.deadline||"9").localeCompare(b.deadline||"9")));
  const W=200,H=104,GX=64,GY=16,P=16,RW=190,RH=124;
  const maxRows=Math.max(...cols.map(c=>c.length));
  const height=Math.max(RH, maxRows*H+(maxRows-1)*GY)+P*2;
  const width=P+RW+GX+cols.length*(W+GX)-GX+P;
  const pos={};
  cols.forEach((c,i)=>{ const x=P+RW+GX+i*(W+GX); const y0=(height-(c.length*H+(c.length-1)*GY))/2; c.forEach((t,j)=>pos[t.id]={x,y:y0+j*(H+GY)}); });
  const root={x:P,y:(height-RH)/2};
  const NS="http://www.w3.org/2000/svg";
  const svg=document.createElementNS(NS,"svg"); svg.setAttribute("width",width); svg.setAttribute("height",height); svg.setAttribute("class","flow-svg"); svg.setAttribute("aria-hidden","true");
  const defs=document.createElementNS(NS,"defs");
  ["line","ok"].forEach(k=>{ const m=document.createElementNS(NS,"marker"); m.setAttribute("id","arw-"+k); m.setAttribute("viewBox","0 0 8 8"); m.setAttribute("refX","7"); m.setAttribute("refY","4"); m.setAttribute("markerWidth","7"); m.setAttribute("markerHeight","7"); m.setAttribute("orient","auto");
    const p=document.createElementNS(NS,"path"); p.setAttribute("d","M0,0 L8,4 L0,8 z"); p.setAttribute("class","arw-"+k); m.append(p); defs.append(m); });
  svg.append(defs);
  const edge=(x1,y1,x2,y2,done)=>{ const p=document.createElementNS(NS,"path"); const dx=Math.max(24,(x2-x1)/2);
    p.setAttribute("d",`M${x1},${y1} C${x1+dx},${y1} ${x2-dx},${y2} ${x2-2},${y2}`); p.setAttribute("class","edge"+(done?" done":"")); p.setAttribute("marker-end",`url(#arw-${done?"ok":"line"})`); svg.append(p); };
  const colBottom=i=>{ const c=cols[i]; const y0=(height-(c.length*H+(c.length-1)*GY))/2; return y0+c.length*H+(c.length-1)*GY; };
  let lanes=0, fullH=height;
  const longEdge=(x1,y1,x2,y2,from,to,done)=>{ let b=0; for(let i=from+1;i<to;i++) b=Math.max(b,colBottom(i));
    const lane=b+14+lanes*8; lanes++; fullH=Math.max(fullH,lane+P);
    const p=document.createElementNS(NS,"path");
    p.setAttribute("d",`M${x1},${y1} C${x1+28},${y1} ${x1+28},${lane} ${x1+56},${lane} L${x2-56},${lane} C${x2-28},${lane} ${x2-28},${y2} ${x2-2},${y2}`);
    p.setAttribute("class","edge"+(done?" done":"")); p.setAttribute("marker-end",`url(#arw-${done?"ok":"line"})`); svg.append(p); };
  tasks.forEach(t=>{ const to=pos[t.id]; const ds=(t.dependsOn||[]).filter(d=>byId[d]&&d!==t.id);
    if(!ds.length) edge(root.x+RW,root.y+RH/2,to.x,to.y+H/2,false);
    ds.forEach(d=>{ const fr=pos[d]; const done=byId[d].status==="done";
      if(lvl[t.id]-lvl[d]>1) longEdge(fr.x+W,fr.y+H/2,to.x,to.y+H/2,lvl[d],lvl[t.id],done);
      else edge(fr.x+W,fr.y+H/2,to.x,to.y+H/2,done); }); });
  svg.setAttribute("height",fullH);
  const wrap=h("div",{class:"flow",style:`width:${width}px;height:${fullH}px`}); wrap.append(svg);
  const p=progress(tasks);
  wrap.append(h("div",{class:"fnode root "+(hb.priority||"P3"),style:`left:${root.x}px;top:${root.y}px;width:${RW}px;height:${RH}px`},
    h("div",{style:"display:flex;gap:6px;align-items:center"},h("span",{class:"prio "+(hb.priority||"P3")},hb.priority||"P3"),h("span",{class:"num muted",style:"font-size:11.5px"},"до "+fmtDate(hb.deadline))),
    h("div",{class:"ft"},hb.title||"Хаб"), progBar(p), h("div",{class:"num muted",style:"font-size:11.5px"},p.pct+"% · "+p.done+"/"+p.total)));
  tasks.forEach(t=>{ const q=pos[t.id]; const st=TASK_ST.find(s=>s.id===t.status)||TASK_ST[0];
    const now=t.status==="in_progress"||t.status==="need_data";
    wrap.append(h("button",{class:"fnode"+(now?" now":"")+(t.status==="done"?" done":"")+(t.status==="rejected"?" rej":""),style:`left:${q.x}px;top:${q.y}px;width:${W}px;height:${H}px;--st:${st.dot}`,onclick:()=>openTask(t.id)},
      h("div",{class:"ft"},t.title||"Без названия"),
      h("div",{class:"fm"},h("span",{class:"pill "+(st.cls||"")},st.label),h("span",{class:"spacer"}),avs(t.assignees)),
      h("div",{class:"fm"},h("span",{class:"num due"+(isLate(t.deadline,t.status==="done"||t.status==="rejected")?" late":"")},fmtDate(t.deadline)), now? h("span",{class:"nowtag"},"сейчас"):null)));
  });
  return h("div",{style:"display:flex;flex-direction:column;gap:10px"},
    h("div",{class:"flow-scroll"},wrap),
    h("div",{class:"muted",style:"font-size:12px"},"Слева направо идёт порядок работ. Задачи в одной колонке делаются параллельно, стрелки показывают, что после чего. Задача с несколькими входящими стрелками объединяет результаты. Связи задаются в карточке задачи, поле «Начинается после»."));
}

/* ---------------- hub drawer ---------------- */
function openHub(id){
  if(!id){ return newHubForm(); }
  openDrawer("Хаб", body=>{
    const hb=()=>S.hubs.find(x=>x.id===id);
    const ref=()=>S.db.doc("hubs/"+id);
    const x=hb(); if(!x){ body.append(h("div",{class:"empty"},"Хаб удалён")); return; }
    const admin=isAdmin() && !S.readOnly;
    const title=bindSave(h("input",{class:"title-in",value:x.title||"",disabled:!admin,"aria-label":"Название хаба"}),ref,"title",{log:"Переименован хаб",logTarget:()=>title.value});
    const prio=bindSave(h("select",{class:"i",disabled:!admin},["P1","P2","P3"].map(p=>h("option",{value:p,selected:x.priority===p},p+(p==="P1"?" · критичный":p==="P2"?" · важный":" · фоновый")))),ref,"priority");
    const dl=bindSave(h("input",{class:"i",type:"date",value:x.deadline||"",disabled:!admin}),ref,"deadline");
    const mon=bindSave(h("input",{class:"i",type:"month",value:x.month||S.month,disabled:!admin}),ref,"month");
    const goal=bindSave(h("textarea",{class:"i",disabled:!admin,placeholder:"Зачем этот хаб и что считаем успехом"},x.goal||""),ref,"goal");
    const res=bindSave(h("textarea",{class:"i",disabled:!admin,placeholder:"Итоги: цифры, выводы, что берём дальше"},x.result||""),ref,"result");
    const state=bindSave(h("select",{class:"i",disabled:!admin},h("option",{value:"active",selected:x.state!=="closed"},"Активен"),h("option",{value:"closed",selected:x.state==="closed"},"Закрыт")),ref,"state",{log:"Изменено состояние хаба",logTarget:()=>title.value});
    const owner=field("Ответственный за хаб", picker(x.owner?[x.owner]:[], s=>write(()=>ref().update({owner:s[0]||null})),{single:true,disabled:!admin}));
    const tabBtn=(k,label)=>h("button",{"aria-pressed":S.hubTab===k?"true":"false",onclick:()=>{ S.hubTab=k; tabs.querySelectorAll("button").forEach(b=>b.setAttribute("aria-pressed",b.dataset.k===k?"true":"false")); document.getElementById("drawer").classList.toggle("wide",k==="flow"); update(); },"data-k":k},label);
    const tabs=h("div",{class:"seg",role:"group","aria-label":"Вид задач"},tabBtn("list","Список"),tabBtn("flow","Схема"));
    const tasksBody=h("div",{style:"display:flex;flex-direction:column;gap:8px"});
    body.append(title,
      h("div",{class:"sec"}, h("div",{class:"grid3"},field("Приоритет",prio),field("Дедлайн",dl),field("Месяц",mon)), field("Цель хаба",goal), owner),
      h("div",{class:"sec"}, h("h4",null,"Задачи хаба",h("span",{class:"spacer"}),tabs, admin? h("button",{class:"btn sm primary",onclick:()=>newTaskForm(id)},"+ Задача"):null), tasksBody),
      h("div",{class:"sec"}, h("h4",null,"Итог хаба"), h("div",{class:"grid2"},field("Состояние",state)), res),
      admin? h("div",{class:"row-actions"},h("button",{class:"btn danger",onclick:()=>confirmBox("Удалить хаб и все его задачи?","Удалить",async()=>{
        for(const t of hubTasks(id)) await S.db.doc("tasks/"+t.id).delete().catch(()=>{});
        await write(()=>ref().delete(),"Хаб удалён"); logAction("Удалён хаб", x.title); closeDrawer(); })},"Удалить хаб")):null);
    let sig=null;
    const update=()=>{
      const cur=hb(); if(!cur){ closeDrawer(); return; }
      const ts=hubTasks(id);
      const ns=JSON.stringify([S.hubTab,cur.title,cur.priority,cur.deadline,ts.map(t=>[t.id,t.title,t.status,t.deadline,t.assignees,t.dependsOn]),Object.keys(S.names).length]);
      if(ns===sig) return; sig=ns;
      tasksBody.textContent="";
      if(S.hubTab==="flow"){ tasksBody.append(hubFlow(cur, ts)); return; }
      const p=progress(ts);
      tasksBody.append(progBar(p), h("div",{class:"num muted",style:"font-size:12px"},`${p.pct}% · готово ${p.done} из ${p.total}`));
      if(!ts.length){ tasksBody.append(h("div",{class:"empty"},"Задач пока нет. Добавьте первую: например, сплит-тест персонажа.")); return; }
      const lvl=taskLevels(ts); const order=Object.fromEntries(TASK_ST.map((s,i)=>[s.id,i]));
      [...ts].sort((a,b)=>lvl[a.id]-lvl[b.id]||(order[a.status]??0)-(order[b.status]??0)).forEach(t=>{
        const deps=(t.dependsOn||[]).map(d=>ts.find(z=>z.id===d)).filter(Boolean);
        tasksBody.append(h("div",{class:"task-row",role:"button",tabindex:"0",onclick:()=>openTask(t.id),onkeydown:e=>{if(e.key==="Enter")openTask(t.id);}},
          h("span",null,h("span",{class:"tt"},t.title||"Без названия"), deps.length? h("div",{class:"muted",style:"font-size:11.5px"},"после: "+deps.map(d=>d.title).join(", ")):null),
          avs(t.assignees), h("span",{class:"num due"+(isLate(t.deadline,t.status==="done"||t.status==="rejected")?" late":"")},fmtDate(t.deadline)), pill(TASK_ST,t.status)));
      });
    };
    document.getElementById("drawer").classList.toggle("wide",S.hubTab==="flow");
    update();
    return {update};
  });
}
function newHubForm(){
  openDrawer("Новый хаб", body=>{
    const title=h("input",{class:"i",placeholder:"Например: Масштабирование проклы / ленда VSL16"});
    const prio=h("select",{class:"i"},h("option",{value:"P1"},"P1 · критичный"),h("option",{value:"P2",selected:true},"P2 · важный"),h("option",{value:"P3"},"P3 · фоновый"));
    const [y,m]=S.month.split("-").map(Number); const last=new Date(y,m,0).getDate();
    const dl=h("input",{class:"i",type:"date",value:`${S.month}-${String(last).padStart(2,"0")}`});
    const goal=h("textarea",{class:"i",placeholder:"Зачем этот хаб и что считаем успехом"});
    let owner=[S.me].filter(Boolean);
    body.append(h("div",{class:"sec"},
      field("Название",title), h("div",{class:"grid2"},field("Приоритет",prio),field("Дедлайн",dl)),
      field("Цель хаба",goal), field("Ответственный", picker(owner,s=>owner=s,{single:true})),
      h("div",{class:"muted",style:"font-size:12px"},"Хаб попадёт в "+monthLabel(S.month).toLowerCase()+". Задачи добавите следующим шагом.")),
      h("div",{class:"row-actions"},h("button",{class:"btn",onclick:closeDrawer},"Отмена"),
        h("button",{class:"btn primary",onclick:async()=>{
          if(!title.value.trim()){ title.focus(); toast("Назовите хаб"); return; }
          const ref=S.db && S.db.collection("hubs").doc();
          const ok=await write(()=>ref.set({title:title.value.trim(),priority:prio.value,deadline:dl.value,goal:goal.value.trim(),month:S.month,owner:owner[0]||null,state:"active",createdBy:S.me,createdAt:Date.now()}),"Хаб создан");
          if(ok){ logAction("Создан хаб",title.value.trim()); openHub(ref.id); }
        }},"Создать хаб")));
    setTimeout(()=>title.focus(),50);
  });
}

/* ---------------- task drawer ---------------- */
function depsPicker(hubId, selfId, selected, onChange, disabled){
  const ts=hubTasks(hubId);
  const banned=selfId? descendants(ts, selfId) : new Set();
  const opts=ts.filter(t=>!banned.has(t.id));
  let sel=new Set(selected||[]);
  if(!opts.length) return h("div",{class:"muted",style:"font-size:13px"},"Других задач в хабе пока нет. Без связей задача стартует сразу, параллельно с остальными.");
  return h("div",{class:"deps"}, opts.map(t=>h("label",{class:"dep"},
    h("input",{type:"checkbox",checked:sel.has(t.id),disabled,onchange:e=>{ e.target.checked? sel.add(t.id) : sel.delete(t.id); onChange([...sel]); }}),
    h("span",{text:t.title||"Без названия"}), pill(TASK_ST,t.status))));
}
function newTaskForm(hubId){
  const hb=S.hubs.find(x=>x.id===hubId);
  openDrawer("Новая задача", body=>{
    const title=h("input",{class:"i",placeholder:"Например: Сплит-тест персонажа"});
    const desc=h("textarea",{class:"i",placeholder:"Что нужно сделать, порядок действий, что нужно для старта"});
    const exp=h("textarea",{class:"i",placeholder:"Ожидаемый результат и как поймём, что получилось"});
    const dl=h("input",{class:"i",type:"date",value:hb&&hb.deadline||""});
    let people=[], deps=[];
    body.append(h("div",{class:"muted"},"Хаб: ",h("b",{text:hb?hb.title:"—"})),
      h("div",{class:"sec"}, field("Задача",title), field("Описание",desc), field("Ожидаемый результат",exp),
        h("div",{class:"grid2"}, field("Срок",dl)), field("Исполнители", picker(people,s=>people=s))),
      h("div",{class:"sec"}, h("h4",null,"Начинается после"), depsPicker(hubId,null,[],s=>deps=s,false)),
      h("div",{class:"row-actions"},h("button",{class:"btn",onclick:()=>openHub(hubId)},"Назад к хабу"),
        h("button",{class:"btn primary",onclick:async()=>{
          if(!title.value.trim()){ title.focus(); toast("Назовите задачу"); return; }
          const ok=await write(()=>S.db.collection("tasks").add({hubId,title:title.value.trim(),description:desc.value.trim(),expected:exp.value.trim(),deadline:dl.value,assignees:people,dependsOn:deps,status:"planned",commentCount:0,createdBy:S.me,createdAt:Date.now(),updatedAt:Date.now()}),"Задача добавлена");
          if(ok){ logAction("Создана задача",title.value.trim()); openHub(hubId); }
        }},"Создать задачу")));
    setTimeout(()=>title.focus(),50);
  });
}
function openTask(id){
  openDrawer("Задача", (body, head)=>{
    const t0=S.tasks.find(x=>x.id===id); if(!t0){ body.append(h("div",{class:"empty"},"Задача удалена")); return; }
    const ref=()=>S.db.doc("tasks/"+id);
    const admin=isAdmin() && !S.readOnly; const touch=canTouchTask(t0);
    const hb=S.hubs.find(x=>x.id===t0.hubId);
    if(hb) head.insertBefore(h("button",{class:"btn sm",onclick:()=>openHub(hb.id)},"← "+hb.title), head.children[1]);
    const title=bindSave(h("input",{class:"title-in",value:t0.title||"",disabled:!admin,"aria-label":"Название задачи"}),ref,"title");
    const st=bindSave(h("select",{class:"i",disabled:!touch},TASK_ST.map(s=>h("option",{value:s.id,selected:t0.status===s.id},s.label))),ref,"status",{log:"Изменён статус задачи",logTarget:()=>title.value});
    const dl=bindSave(h("input",{class:"i",type:"date",value:t0.deadline||"",disabled:!admin}),ref,"deadline");
    const desc=bindSave(h("textarea",{class:"i",disabled:!admin,rows:4},t0.description||""),ref,"description");
    const exp=bindSave(h("textarea",{class:"i",disabled:!admin},t0.expected||""),ref,"expected");
    const res=bindSave(h("textarea",{class:"i",disabled:!touch,placeholder:"Что получилось: цифры, ссылки, вывод"},t0.result||""),ref,"result",{log:"Обновлён итог задачи",logTarget:()=>title.value});
    const cs=commentsSection(()=>ref().collection("comments"), txt=>{ const t=S.tasks.find(x=>x.id===id); write(()=>ref().update({commentCount:(Number(t&&t.commentCount)||0)+1})); logAction("Комментарий к задаче",title.value); });
    body.append(title,
      h("div",{class:"sec"}, h("div",{class:"grid2"},field("Статус",st),field("Срок",dl)),
        field("Исполнители", picker(t0.assignees||[], s=>{ write(()=>ref().update({assignees:s})); logAction("Изменены исполнители",title.value); },{disabled:!admin})),
        h("div",{class:"muted",style:"font-size:12px"},"Поставил(а): ",person(t0.createdBy)," · ",fmtTime(t0.createdAt))),
      h("div",{class:"sec"}, field("Описание",desc), field("Ожидаемый результат",exp)),
      hb? h("div",{class:"sec"}, h("h4",null,"Начинается после"), depsPicker(hb.id,id,t0.dependsOn||[],s=>{ write(()=>ref().update({dependsOn:s})); logAction("Изменены связи задачи",title.value); },!admin)) : null,
      h("div",{class:"sec"}, h("h4",null,"Итог"), res),
      cs.el,
      admin? h("div",{class:"row-actions"},h("button",{class:"btn danger",onclick:()=>confirmBox("Удалить задачу?","Удалить",async()=>{
        for(const o of S.tasks.filter(z=>(z.dependsOn||[]).includes(id))) await S.db.doc("tasks/"+o.id).update({dependsOn:(o.dependsOn||[]).filter(d=>d!==id)}).catch(()=>{});
        await write(()=>ref().delete(),"Задача удалена"); logAction("Удалена задача",t0.title); hb?openHub(hb.id):closeDrawer(); })},"Удалить задачу")):null);
    return {unsub:cs.unsub, update(){ const t=S.tasks.find(x=>x.id===id); if(!t){ closeDrawer(); return; } if(document.activeElement!==st) st.value=t.status||"planned"; cs.draw(); }};
  });
}

/* ================= 02 TEST BOARD ================= */
function mountTests(){
  const ban=h("div"), body=h("div"), stats=h("div",{class:"stats"});
  const fb=(id,label)=>h("button",{"aria-pressed":S.testFilter===id?"true":"false",onclick:()=>{S.testFilter=id; mount();}},label);
  const el=h("section",{class:"view"},
    h("div",{class:"view-head"},
      h("div",null,h("h1",null,"Тестовая доска"),h("div",{class:"sub"},"Операционные тесты и задачи между байерами и руководителем")),
      h("div",{class:"spacer"}),
      h("div",{class:"seg"}, fb("all","Все"), fb("mine","Мои"), fb("set","Поставил я")),
      canWriteAny()? h("button",{class:"btn primary",onclick:()=>newTestForm()},"+ Тест"):null),
    ban, stats, body);
  return {el, update(){
    ban.textContent=""; const b=banner(); if(b) ban.append(b);
    let items=S.tests;
    if(S.testFilter==="mine") items=items.filter(t=>(t.assignees||[]).includes(S.me));
    if(S.testFilter==="set") items=items.filter(t=>t.reviewer===S.me || t.createdBy===S.me);
    const active=items.filter(t=>t.column!=="done" && t.column!=="backlog");
    const limit=active.reduce((s,t)=>s+(Number(t.budgetLimit)||0),0);
    const late=items.filter(t=>isLate(t.deadline,t.column==="done")).length;
    stats.textContent="";
    stats.append(stat("В работе", active.length), stat("Сейчас в тесте", items.filter(t=>t.column==="testing").length),
      stat("Лимиты активных тестов", money(limit)),
      stat("Просрочено", late, late?"var(--crit)":null));
    body.textContent="";
    body.append(kanban(TEST_COL, items, t=>t.column||"backlog", testCard, canTouchTest, (t,c)=>{
      if(!canTouchTest(t)){ toast("Двигать тест могут постановщик, исполнители и администраторы"); return; }
      write(()=>S.db.doc("tests/"+t.id).update({column:c,updatedAt:Date.now()}));
      logAction("Тест → "+TEST_COL.find(x=>x.id===c).label, t.title);
    }));
  }};
}
function testCard(t){
  return h("div",{class:"card",onclick:()=>openTest(t.id)},
    h("div",{class:"t"},t.title||"Без названия"),
    h("div",{class:"meta"}, Number(t.budgetLimit)? h("span",{class:"num"},"лимит "+money(t.budgetLimit)):null, t.deadline? h("span",{class:"num due"+(isLate(t.deadline,t.column==="done")?" late":"")},fmtDate(t.deadline)):null,
      t.commentCount? h("span",{title:"Комментарии"},"💬 "+t.commentCount):null,
      h("span",{class:"spacer"}), avs(t.assignees)));
}
function newTestForm(prefill){
  openDrawer("Новый тест", body=>{
    const title=h("input",{class:"i",placeholder:"Например: Тест новых БМов с агентства X",value:prefill&&prefill.title||""});
    const brief=h("textarea",{class:"i",rows:5,placeholder:"Бриф: что проверяем, как, на каком объёме, критерии успеха и остановки"},prefill&&prefill.brief||"");
    const lim=h("input",{class:"i num",type:"number",min:"0",step:"10",placeholder:"0"});
    const dl=h("input",{class:"i",type:"date"});
    const col=h("select",{class:"i"},TEST_COL.slice(0,3).map(c=>h("option",{value:c.id},c.label)));
    let people=[], reviewer=[S.me].filter(Boolean);
    body.append(h("div",{class:"sec"}, field("Тест",title), field("Бриф",brief),
      h("div",{class:"grid3"},field("Лимит бюджета, $",lim),field("Срок",dl),field("Колонка",col)),
      h("div",{class:"grid2"},field("Постановщик / проверяющий",picker(reviewer,s=>reviewer=s,{single:true})),field("Исполнители",picker(people,s=>people=s)))),
      h("div",{class:"row-actions"},h("button",{class:"btn",onclick:closeDrawer},"Отмена"),
        h("button",{class:"btn primary",onclick:async()=>{
          if(!title.value.trim()){ title.focus(); toast("Назовите тест"); return; }
          const ref=S.db && S.db.collection("tests").doc();
          const ok=await write(()=>ref.set({title:title.value.trim(),brief:brief.value.trim(),budgetLimit:Number(lim.value)||0,deadline:dl.value,column:col.value,reviewer:reviewer[0]||S.me,assignees:people,links:[],commentCount:0,result:"",createdBy:S.me,createdAt:Date.now(),updatedAt:Date.now()}),"Тест создан");
          if(ok){ logAction("Создан тест",title.value.trim()); if(prefill&&prefill.ideaId) write(()=>S.db.doc("ideas/"+prefill.ideaId).update({status:"taken"})); openTest(ref.id); }
        }},"Создать тест")));
    setTimeout(()=>title.focus(),50);
  });
}
function openTest(id){
  openDrawer("Тест", body=>{
    const t0=S.tests.find(x=>x.id===id); if(!t0){ body.append(h("div",{class:"empty"},"Тест удалён")); return; }
    const ref=()=>S.db.doc("tests/"+id);
    const touch=canTouchTest(t0); const owner=(isAdmin()||t0.createdBy===S.me||t0.reviewer===S.me)&&!S.readOnly;
    const title=bindSave(h("input",{class:"title-in",value:t0.title||"",disabled:!owner,"aria-label":"Название теста"}),ref,"title");
    const col=bindSave(h("select",{class:"i",disabled:!touch},TEST_COL.map(c=>h("option",{value:c.id,selected:t0.column===c.id},c.label))),ref,"column",{log:"Тест перемещён",logTarget:()=>title.value});
    const dl=bindSave(h("input",{class:"i",type:"date",value:t0.deadline||"",disabled:!touch}),ref,"deadline");
    const brief=bindSave(h("textarea",{class:"i",rows:5,disabled:!owner,placeholder:"Что проверяем, как, на каком объёме, критерии успеха и остановки"},t0.brief||""),ref,"brief");
    const lim=bindSave(h("input",{class:"i num",type:"number",min:"0",value:t0.budgetLimit||0,disabled:!owner}),ref,"budgetLimit",{num:true,log:"Изменён лимит бюджета",logTarget:()=>title.value});
    const res=bindSave(h("textarea",{class:"i",rows:4,disabled:!touch,placeholder:"Вывод теста: потрачено, цифры, что сработало, что берём дальше"},t0.result||""),ref,"result",{log:"Обновлён итог теста",logTarget:()=>title.value});
    const linksEl=h("div",{class:"links"});
    const lurl=h("input",{class:"i",placeholder:"https://… (креатив, ленд, таблица, папка)"}); const llab=h("input",{class:"i",placeholder:"Подпись"});
    const cs=commentsSection(()=>ref().collection("comments"), ()=>{ const t=S.tests.find(x=>x.id===id); write(()=>ref().update({commentCount:(Number(t&&t.commentCount)||0)+1})); logAction("Комментарий к тесту",title.value); });
    body.append(title,
      h("div",{class:"sec"},h("div",{class:"grid2"},field("Колонка",col),field("Срок",dl)),
        h("div",{class:"grid2"},field("Постановщик / проверяющий",picker(t0.reviewer?[t0.reviewer]:[],s=>write(()=>ref().update({reviewer:s[0]||null})),{single:true,disabled:!owner})),
          field("Исполнители",picker(t0.assignees||[],s=>{ write(()=>ref().update({assignees:s})); logAction("Изменены исполнители теста",title.value); },{disabled:!owner})))),
      h("div",{class:"sec"},h("h4",null,"Требования теста"),field("Бриф",brief),h("div",{class:"grid2"},field("Лимит бюджета, $",lim))),
      h("div",{class:"sec"},h("h4",null,"Материалы"),linksEl,
        touch? h("div",{class:"link-row"},llab,lurl,h("button",{class:"btn",onclick:()=>{
          const u=lurl.value.trim(); if(!/^https?:\/\//i.test(u)){ toast("Ссылка должна начинаться с http"); return; }
          const t=S.tests.find(x=>x.id===id); const links=[...(t.links||[]),{url:u,label:llab.value.trim()}];
          write(()=>ref().update({links})); lurl.value=""; llab.value=""; logAction("Добавлен материал к тесту",title.value);
        }},"Добавить")):null),
      h("div",{class:"sec"},h("h4",null,"Итог теста"),res),
      cs.el,
      owner? h("div",{class:"row-actions"},h("button",{class:"btn danger",onclick:()=>confirmBox("Удалить тест?","Удалить",async()=>{ await write(()=>ref().delete(),"Тест удалён"); logAction("Удалён тест",t0.title); closeDrawer(); })},"Удалить тест")):null);
    const update=()=>{
      const t=S.tests.find(x=>x.id===id); if(!t){ closeDrawer(); return; }
      if(document.activeElement!==col) col.value=t.column||"backlog";
      linksEl.textContent="";
      if(!(t.links||[]).length) linksEl.append(h("div",{class:"muted",style:"font-size:13px"},"Ссылок пока нет."));
      (t.links||[]).forEach((l,i)=>linksEl.append(h("div",{class:"link-row"},h("a",{href:l.url,target:"_blank",rel:"noopener"},l.label||l.url),
        touch? h("button",{class:"btn ghost sm","aria-label":"Убрать ссылку",onclick:()=>{ const links=(t.links||[]).filter((_,j)=>j!==i); write(()=>ref().update({links})); }},"×"):null)));
      cs.draw();
    };
    update();
    return {update, unsub:cs.unsub};
  });
}
// stop comment listener when drawer closes or switches
const _openDrawer=openDrawer;
openDrawer=function(kind,build){ if(S.drawer && S.drawer.unsub){ try{S.drawer.unsub();}catch(_){} } return _openDrawer(kind,build); };
const _closeDrawer=closeDrawer;
closeDrawer=function(){ if(S.drawer && S.drawer.unsub){ try{S.drawer.unsub();}catch(_){} } _closeDrawer(); };

/* ================= 03 IDEAS ================= */
function mountIdeas(){
  const ban=h("div"), feed=h("div",{class:"feed"});
  const ta=h("textarea",{placeholder:"Пришла идея на созвоне или на перекуре? Запишите, пока не потерялась…","aria-label":"Новая идея"});
  const toCall=h("input",{type:"checkbox",id:"idea-call"});
  const send=async()=>{
    const v=ta.value.trim(); if(!v) return;
    const ok=await write(()=>S.db.collection("ideas").add({text:v,author:S.me,at:Date.now(),status:toCall.checked?"call":"new"}),"Идея записана");
    if(ok){ ta.value=""; toCall.checked=false; logAction("Записана идея",v); }
  };
  ta.addEventListener("keydown",e=>{ if(e.key==="Enter" && (e.metaKey||e.ctrlKey)) send(); });
  const fb=(id,label)=>h("button",{"aria-pressed":S.ideaFilter===id?"true":"false",onclick:()=>{S.ideaFilter=id; mount();}},label);
  const el=h("section",{class:"view",style:"max-width:860px"},
    h("div",{class:"view-head"},h("div",null,h("h1",null,"Идеи"),h("div",{class:"sub"},"Лента мыслей команды. Отмеченные «обсудить» попадают в повестку созвона"))),
    ban,
    !canWriteAny()? null : h("div",{class:"composer"},ta,h("div",{style:"display:flex;align-items:center;gap:10px;flex-wrap:wrap"},
      h("label",{for:"idea-call",style:"display:flex;gap:6px;align-items:center;font-size:13px;color:var(--ink-2)"},toCall,"Обсудить на ближайшем созвоне"),
      h("span",{class:"spacer"}),h("span",{class:"muted",style:"font-size:12px"},"Ctrl + Enter"),h("button",{class:"btn primary",onclick:send},"Записать"))),
    h("div",{class:"seg"}, fb("all","Все"), ...IDEA_ST.map(s=>fb(s.id,s.label))),
    feed);
  return {el, update(){
    ban.textContent=""; const b=banner(); if(b) ban.append(b);
    let items=[...S.ideas].sort((a,b)=>(b.at||0)-(a.at||0));
    if(S.ideaFilter!=="all") items=items.filter(i=>(i.status||"new")===S.ideaFilter);
    feed.textContent="";
    if(!items.length) feed.append(h("div",{class:"empty"},"Здесь пока пусто."));
    for(const i of items){
      const mine=i.author===S.me; const can=!S.readOnly && (mine||isAdmin());
      const sel=h("select",{class:"i",style:"width:auto;padding:3px 8px;font-size:12px",disabled:S.readOnly||myRole()==="viewer","aria-label":"Статус идеи",onchange:e=>write(()=>S.db.doc("ideas/"+i.id).update({status:e.target.value}))},
        IDEA_ST.map(s=>h("option",{value:s.id,selected:(i.status||"new")===s.id},s.label)));
      feed.append(h("article",{class:"idea"},
        h("p",{text:i.text}),
        h("div",{class:"foot"},person(i.author),h("span",null,fmtTime(i.at)),h("span",{class:"spacer"}),pill(IDEA_ST,i.status||"new"),sel,
          canWriteAny()? h("button",{class:"btn sm",onclick:()=>newTestForm({title:i.text.split("\n")[0].slice(0,80),brief:i.text,ideaId:i.id})},"→ В тест"):null,
          can? h("button",{class:"btn ghost sm danger","aria-label":"Удалить идею",onclick:()=>confirmBox("Удалить идею?","Удалить",()=>write(()=>S.db.doc("ideas/"+i.id).delete(),"Удалено"))},"Удалить"):null)));
    }
  }};
}

/* ================= 04 CALLS ================= */
function mountCalls(){
  const ban=h("div"), list=h("div",{class:"call-list"}), detail=h("div",{style:"display:flex;flex-direction:column;gap:14px"}), agenda=h("div");
  const el=h("section",{class:"view"},
    h("div",{class:"view-head"},h("div",null,h("h1",null,"Созвоны"),h("div",{class:"sub"},"Понедельник и четверг: запись, транскрипт и бриф с планами")),
      h("div",{class:"spacer"}), canWriteAny()? h("button",{class:"btn primary",onclick:()=>newCallForm()},"+ Созвон"):null),
    ban, h("div",{class:"calls"},h("div",{style:"display:flex;flex-direction:column;gap:12px"},agenda,list),detail));
  let shown=null;
  return {el, update(){
    ban.textContent=""; const b=banner(); if(b) ban.append(b);
    const calls=[...S.calls].sort((a,b)=>(b.date||"").localeCompare(a.date||"") || (b.createdAt||0)-(a.createdAt||0));
    if(!S.callSel || !calls.find(c=>c.id===S.callSel)) S.callSel=calls[0]&&calls[0].id;
    const ag=S.ideas.filter(i=>i.status==="call");
    agenda.textContent="";
    agenda.append(h("div",{class:"sec"},h("h4",null,"Повестка следующего созвона",h("span",{class:"badge"},ag.length)),
      ag.length? h("ul",{style:"margin:0;padding-left:18px;display:flex;flex-direction:column;gap:4px;font-size:13px"},ag.slice(0,8).map(i=>h("li",{text:i.text.split("\n")[0].slice(0,120)})))
        : h("div",{class:"muted",style:"font-size:13px"},"Отметьте идеи «Обсудить на созвоне», и они появятся здесь.")));
    list.textContent="";
    if(!calls.length) list.append(h("div",{class:"empty"},"Созвонов пока нет."));
    calls.forEach(c=>list.append(h("button",{class:"call-item","aria-current":c.id===S.callSel?"true":"false",onclick:()=>{S.callSel=c.id; shown=null; mounted.update();}},
      h("span",{class:"d"},fmtDate(c.date)+" · "+(c.kind||"")),h("b",null,c.title||"Созвон"),
      h("span",{style:"display:flex;gap:6px;flex-wrap:wrap"}, c.brief? h("span",{class:"pill ok"},"бриф готов") : h("span",{class:"pill"},"без брифа"),
        (c.audioPath||c.recordingLink)? h("span",{class:"pill acc"},"запись"):null, (c.transcribeStatus==="queued"||c.transcribeStatus==="running")? h("span",{class:"pill warn"},"расшифровка…"):null))));
    const c=calls.find(x=>x.id===S.callSel);
    const sig=c? JSON.stringify([c.id,c.brief,c.title,c.date,c.kind,c.audioPath,c.recordingLink,(c.transcript||"").length,c.transcribeStatus,c.transcribeError,c.briefStatus,S.readOnly,S.ai.brief,S.ai.transcribe]) : "none";
    if(sig===shown) return; shown=sig;
    detail.textContent="";
    if(!c){ detail.append(h("div",{class:"empty"},"Выберите созвон или добавьте новый.")); return; }
    detail.append(renderCall(c));
  }};
}
async function api(path, body){
  const r=await fetch(path,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
  const j=await r.json().catch(()=>({}));
  if(!r.ok) throw new Error(j.error||("ошибка "+r.status));
  return j;
}
function startTranscribe(callId){ api("/api/transcribe",{callId}).catch(e=>toast("Расшифровка: "+e.message)); }
async function uploadRecording(callId, file, title){
  if(file.size>50*1024*1024){ toast("Файл больше 50 МБ. Сожмите запись или загрузите ссылку."); return false; }
  const path=`calls/${callId}/${Date.now()}-${file.name.replace(/[^\w.\-]+/g,"_")}`;
  toast("Загружаю запись…");
  const { error } = await sb.storage.from("recordings").upload(path,file,{contentType:file.type||"application/octet-stream"});
  if(error){ toast("Не удалось загрузить запись: "+error.message); return false; }
  if(!S.ai.transcribe){
    const ok=await write(()=>S.db.doc("calls/"+callId).update({audioPath:path,audioType:file.type||""}),"Запись сохранена. Автоматическая расшифровка не подключена: вставьте транскрипт вручную.");
    if(ok) logAction("Загружена запись созвона",title);
    return ok;
  }
  const ok=await write(()=>S.db.doc("calls/"+callId).update({audioPath:path,audioType:file.type||"",transcribeStatus:"queued",transcribeError:null}),"Запись загружена, начинаю расшифровку");
  if(ok){ logAction("Загружена запись созвона",title); startTranscribe(callId); }
  return ok;
}
function renderBrief(br){
  const wrap=h("div",{class:"brief",style:"display:flex;flex-direction:column;gap:12px"});
  if(br.summary) wrap.append(h("p",{style:"margin:0;font-size:14.5px"},br.summary));
  const lst=(t,arr)=> (arr&&arr.length)? h("div",null,h("div",{style:"font-weight:600;margin-bottom:6px"},t),h("ul",null,arr.map(x=>h("li",{text:String(x)})))) : null;
  wrap.append(lst("Что обсуждали",br.discussed), lst("О чём договорились",br.decisions));
  if(br.plans && br.plans.length) wrap.append(h("div",null,h("div",{style:"font-weight:600;margin-bottom:4px"},"Планы"),
    br.plans.map(p=>h("div",{class:"plan"},h("span",{text:p.what||""}),h("span",{class:"muted",text:p.who||""}),h("span",{class:"num muted",text:p.due||""})))));
  if(br.nextCheckin) wrap.append(h("div",{class:"pill acc",style:"align-self:flex-start;font-size:12.5px;padding:4px 10px"},"Следующий чек-ин: "+br.nextCheckin));
  return wrap;
}
function manualBrief(c){
  const box=h("details",{open:!c.brief},h("summary",{style:"cursor:pointer;font-size:13px;color:var(--accent)"},c.brief?"Пересобрать бриф вручную":"Собрать бриф вручную"));
  const steps=h("div",{style:"display:flex;flex-direction:column;gap:10px;margin-top:10px"});
  if(!c.transcript){ steps.append(h("div",{class:"muted",style:"font-size:13px"},"Сначала добавьте транскрипт созвона ниже, в блоке «Транскрипт».")); box.append(steps); return box; }
  const copyBtn=h("button",{class:"btn sm",onclick:async()=>{
    try{ await navigator.clipboard.writeText(buildBriefPrompt(c,c.transcript)); copyBtn.textContent="Скопировано ✓"; setTimeout(()=>copyBtn.textContent="1. Скопировать запрос",2500); }
    catch(_){ toast("Браузер не дал скопировать. Разрешите доступ к буферу обмена и попробуйте ещё раз."); }
  }},"1. Скопировать запрос");
  const ta=h("textarea",{class:"i",rows:5,placeholder:"3. Вставьте сюда ответ ассистента целиком"});
  const save=h("button",{class:"btn primary sm",onclick:async()=>{
    const txt=ta.value.trim(); if(!txt){ ta.focus(); return; }
    const brief=parseBriefReply(txt) || {summary:txt.slice(0,4000),discussed:[],decisions:[],plans:[],nextCheckin:""};
    const ok=await write(()=>S.db.doc("calls/"+c.id).update({brief,briefAt:Date.now(),briefStatus:"done"}),"Бриф сохранён");
    if(ok) logAction("Бриф созвона добавлен вручную",c.title);
  }},"4. Сохранить бриф");
  steps.append(
    h("div",{class:"muted",style:"font-size:13px"},"Автоматический бриф пока не подключён. Соберите его через любой чат-ассистент: скопируйте запрос (в нём уже есть инструкция и транскрипт), вставьте в ассистента, а его ответ вставьте сюда."),
    h("div",{style:"display:flex;gap:8px;align-items:center;flex-wrap:wrap"},copyBtn,h("span",{class:"muted",style:"font-size:12px"},"2. Вставьте запрос в ассистента и отправьте")),
    ta, h("div",{class:"row-actions"},save));
  box.append(steps);
  return box;
}
function renderCall(c){
  const ref=()=>S.db.doc("calls/"+c.id);
  const can=!S.readOnly && (isAdmin()||c.createdBy===S.me);
  const writer=!S.readOnly;
  const out=h("div",{style:"display:flex;flex-direction:column;gap:14px"});
  out.append(h("div",{class:"view-head"},h("div",null,h("h2",{style:"font-family:var(--f-display);font-size:18px"},c.title||"Созвон"),
    h("div",{class:"sub"},fmtDate(c.date)+" · "+(c.kind||"")+" · добавил(а) ",person(c.createdBy))),h("div",{class:"spacer"}),
    can? h("button",{class:"btn danger sm",onclick:()=>confirmBox("Удалить созвон?","Удалить",async()=>{
      if(c.audioPath) await sb.storage.from("recordings").remove([c.audioPath]).catch(()=>{});
      write(()=>ref().delete(),"Созвон удалён"); logAction("Удалён созвон",c.title); })},"Удалить"):null));
  // status of automation
  const ts=c.transcribeStatus;
  if(ts==="queued"||ts==="running") out.append(h("div",{class:"banner",style:"background:var(--accent-soft);color:var(--ink-2)"},"Расшифровываю запись. Обычно это 1–3 минуты, страницу можно закрыть. Бриф соберётся сам после расшифровки."));
  if(ts==="error") out.append(h("div",{class:"banner",style:"background:var(--crit-soft);color:var(--crit);display:flex;gap:10px;align-items:center;flex-wrap:wrap"},
    h("span",{style:"flex:1"},"Расшифровка не удалась: "+(c.transcribeError||"неизвестная ошибка")), writer? h("button",{class:"btn sm",onclick:()=>{ write(()=>ref().update({transcribeStatus:"queued",transcribeError:null})); startTranscribe(c.id); }},"Повторить"):null));
  if(c.briefStatus==="running") out.append(h("div",{class:"banner",style:"background:var(--accent-soft);color:var(--ink-2)"},"Собираю бриф по транскрипту…"));
  // brief
  const briefSec=h("div",{class:"sec"},h("h4",null,"Бриф созвона"));
  if(c.brief) briefSec.append(renderBrief(c.brief));
  else briefSec.append(h("div",{class:"muted",style:"font-size:13px"}, S.ai.brief? "Брифа пока нет. Он соберётся сам после расшифровки записи, или нажмите «Собрать бриф», если транскрипт уже есть." : "Брифа пока нет."));
  if(writer && S.ai.brief){
    const status=h("div",{class:"muted",style:"font-size:13px"});
    const btn=h("button",{class:"btn primary sm",disabled:!c.transcript,onclick:async()=>{
      btn.disabled=true; status.textContent="Модель читает транскрипт… обычно 20–60 секунд.";
      try{ await api("/api/brief",{callId:c.id}); status.textContent=""; logAction("Собран бриф созвона",c.title); }
      catch(e){ status.textContent="Не получилось собрать бриф: "+e.message; }
      finally{ btn.disabled=!c.transcript; }
    }}, c.brief?"Пересобрать бриф":"Собрать бриф");
    briefSec.querySelector("h4").append(h("span",{class:"spacer"}),btn);
    briefSec.append(status);
  } else if(writer){
    briefSec.append(manualBrief(c));
  }
  // recording
  const rec=h("div",{class:"sec"},h("h4",null,"Запись"));
  if(c.audioPath){
    const media=(c.audioType||"").startsWith("video")? h("video",{controls:true,preload:"metadata"}) : h("audio",{controls:true,preload:"metadata"});
    sb.storage.from("recordings").createSignedUrl(c.audioPath,3600).then(({data})=>{ if(data) media.src=data.signedUrl; });
    rec.append(media);
  }
  if(c.recordingLink) rec.append(h("a",{href:c.recordingLink,target:"_blank",rel:"noopener",style:"color:var(--accent)"},"Открыть запись по ссылке"));
  if(!c.audioPath && !c.recordingLink) rec.append(h("div",{class:"muted",style:"font-size:13px"},"Записи нет."));
  if(writer) rec.append(uploadRow(c));
  // transcript
  const trSec=h("div",{class:"sec"},h("h4",null,"Транскрипт"));
  if(c.transcript) trSec.append(h("div",{class:"transcript",text:c.transcript}));
  else trSec.append(h("div",{class:"muted",style:"font-size:13px"},"Транскрипта пока нет."));
  if(writer){
    const ta=h("textarea",{class:"i",rows:4,placeholder:"Вставьте транскрипт целиком"});
    const file=h("input",{type:"file",accept:".txt,.md,.srt,.vtt,text/*",style:"font-size:12px"});
    file.addEventListener("change",async()=>{ const f=file.files[0]; if(f){ ta.value=await f.text(); } });
    trSec.append(h("details",null,h("summary",{style:"cursor:pointer;font-size:13px;color:var(--accent)"},c.transcript?"Заменить транскрипт вручную":"Вставить транскрипт вручную"),
      h("div",{style:"display:flex;flex-direction:column;gap:8px;margin-top:8px"},ta,h("div",{style:"display:flex;gap:8px;align-items:center;flex-wrap:wrap"},file,h("span",{class:"spacer"}),
        h("button",{class:"btn primary sm",onclick:()=>saveTranscript(c,ta.value)},"Сохранить транскрипт")))));
  }
  out.append(briefSec, rec, trSec);
  return out;
}
async function saveTranscript(c, text){
  text=(text||"").trim(); if(!text){ toast("Транскрипт пустой"); return false; }
  const ok=await write(()=>S.db.doc("calls/"+c.id).update({transcript:text,transcribeStatus:"done",transcribeError:null}),"Транскрипт сохранён");
  if(ok) logAction("Добавлен транскрипт",c.title);
  return ok;
}
function uploadRow(c){
  const ref=()=>S.db.doc("calls/"+c.id);
  const link=h("input",{class:"i",placeholder:"или ссылка на запись (Google Drive, Zoom, Telegram)",value:c.recordingLink||""});
  const file=h("input",{type:"file",accept:"audio/*,video/*",style:"font-size:12px"});
  file.addEventListener("change",()=>{ const f=file.files[0]; if(f) uploadRecording(c.id,f,c.title); });
  return h("div",{style:"display:flex;flex-direction:column;gap:8px"},
    h("label",{class:"f"},(c.audioPath?"Заменить запись":"Загрузить запись")+(S.ai.transcribe?" (до 50 МБ, расшифруется автоматически)":" (до 50 МБ)"),file),
    h("div",{class:"link-row"},link,h("button",{class:"btn sm",onclick:()=>{ const u=link.value.trim(); if(u && !/^https?:\/\//i.test(u)){ toast("Ссылка должна начинаться с http"); return; } write(()=>ref().update({recordingLink:u}),"Ссылка сохранена"); }},"Сохранить")));
}
function newCallForm(){
  openDrawer("Новый созвон", body=>{
    const d=new Date(); const dow=d.getDay();
    const date=h("input",{class:"i",type:"date",value:today()});
    const kind=h("select",{class:"i"},["Понедельник","Четверг","Внеплановый"].map(k=>h("option",{value:k,selected:(dow===1&&k==="Понедельник")||(dow===4&&k==="Четверг")||(dow!==1&&dow!==4&&k==="Внеплановый")},k)));
    const title=h("input",{class:"i",placeholder:"Например: Планёрка, старт VSL16"});
    const audio=h("input",{type:"file",accept:"audio/*,video/*",style:"font-size:12px"});
    const tr=h("textarea",{class:"i",rows:6,placeholder:"Или вставьте готовый транскрипт"});
    const file=h("input",{type:"file",accept:".txt,.md,.srt,.vtt,text/*",style:"font-size:12px"});
    file.addEventListener("change",async()=>{ const f=file.files[0]; if(f) tr.value=await f.text(); });
    const go_=h("button",{class:"btn primary",onclick:async()=>{
      go_.disabled=true;
      const ref=S.db.collection("calls").doc();
      const t=title.value.trim()||("Созвон, "+kind.value.toLowerCase());
      const ok=await write(()=>ref.set({date:date.value,kind:kind.value,title:t,transcript:"",createdBy:S.me,createdAt:Date.now()}),"Созвон добавлен");
      if(!ok){ go_.disabled=false; return; }
      logAction("Добавлен созвон",t);
      S.callSel=ref.id; closeDrawer(); if(S.view!=="calls") go("calls"); else refresh();
      const f=audio.files[0];
      if(f) await uploadRecording(ref.id,f,t);
      else if(tr.value.trim()){ if(await saveTranscript({id:ref.id,title:t},tr.value) && S.ai.brief) api("/api/brief",{callId:ref.id}).catch(e=>toast("Бриф: "+e.message)); }
    }},"Добавить");
    body.append(h("div",{class:"sec"},h("div",{class:"grid2"},field("Дата",date),field("Тип",kind)),field("Название",title),
      field("Запись созвона: аудио или видео до 50 МБ",audio),
      h("div",{class:"muted",style:"font-size:12px"},S.ai.transcribe? "Запись расшифруется автоматически, после этого соберётся бриф." : "Запись сохранится на доске. Автоматическая расшифровка пока не подключена, транскрипт добавьте ниже."),
      field("Транскрипт, если он уже есть",tr),h("div",{style:"display:flex;gap:8px;align-items:center"},h("span",{class:"muted",style:"font-size:12px"},"или файлом .txt:"),file)),
      h("div",{class:"row-actions"},h("button",{class:"btn",onclick:closeDrawer},"Отмена"),go_));
  });
}

/* ================= 05 ADMIN ================= */
async function setProfile(id, patch, okMsg, logText){
  const { error } = await sb.from("profiles").update(patch).eq("id", id);
  if(error){ toast("Не сохранилось: "+error.message); return; }
  toast(okMsg); logAction(logText, nameOf(id)); loadProfiles();
}
function roleSelect(value, onChange, disabled){
  return h("select",{class:"i",style:"width:auto","aria-label":"Роль",disabled,onchange:e=>onChange(e.target.value)},ROLES.map(r=>h("option",{value:r.id,selected:value===r.id},r.label)));
}
function mountAdmin(){
  const ban=h("div"), reqs=h("div"), people=h("div"), matrix=h("div"), logs=h("div"), reqHead=h("h4",null,"Заявки на вход");
  const el=h("section",{class:"view"},
    h("div",{class:"view-head"},h("div",null,h("h1",null,"Доступы и логи"),h("div",{class:"sub"},"Заявки на вход, роли команды, что видит каждая роль, журнал действий"))),
    ban,
    h("div",{class:"sec"},reqHead,reqs),
    h("div",{class:"sec"},h("h4",null,"Команда"),people),
    h("div",{class:"sec"},h("h4",null,"Что видит каждая роль"),matrix),
    h("div",{class:"sec"},h("h4",null,"Журнал действий",h("span",{class:"spacer"}),h("button",{class:"btn sm",onclick:loadLogs},"Обновить")),logs));
  loadLogs();
  return {el, update(){
    ban.textContent=""; const b=banner(); if(b) ban.append(b);
    // requests
    const pending=S.profiles.filter(p=>p.status==="pending");
    reqHead.textContent="Заявки на вход "; reqHead.append(h("span",{class:"badge"},pending.length));
    reqs.textContent="";
    if(!pending.length) reqs.append(h("div",{class:"muted",style:"font-size:13px"},"Новых заявок нет. Человек появится здесь после первого входа через Slack или почту."));
    pending.forEach(p=>{
      let role="buyer";
      reqs.append(h("div",{class:"req"},
        h("div",null,person(p.id),h("div",{class:"muted",style:"font-size:12px",text:(p.email||"")+" · "+fmtTime(Date.parse(p.created_at))})),
        roleSelect(role,v=>role=v,false),
        h("button",{class:"btn primary sm",onclick:()=>setProfile(p.id,{status:"approved",role,approved_at:new Date().toISOString(),approved_by:S.me},"Доступ открыт","Одобрена заявка ("+ROLES.find(r=>r.id===role).label+")")},"Одобрить"),
        h("button",{class:"btn ghost sm danger",onclick:()=>confirmBox("Отклонить заявку "+(p.email||"")+"?","Отклонить",()=>setProfile(p.id,{status:"blocked"},"Заявка отклонена","Отклонена заявка"))},"Отклонить")));
    });
    // team
    people.textContent="";
    const team=S.profiles.filter(p=>p.status!=="pending");
    people.append(h("div",{class:"tbl-wrap"},h("table",{style:"min-width:620px"},
      h("thead",null,h("tr",null,h("th",null,"Сотрудник"),h("th",null,"Почта"),h("th",null,"Роль"),h("th",null,"Доступ"),h("th",null,""))),
      h("tbody",null,team.map(p=>{
        const self=p.id===S.me, blocked=p.status==="blocked";
        return h("tr",null,h("td",null,person(p.id)),h("td",{class:"muted",text:p.email||""}),
          h("td",null,roleSelect(p.role,v=>setProfile(p.id,{role:v},"Роль изменена","Изменена роль → "+ROLES.find(r=>r.id===v).label),self||blocked)),
          h("td",null,blocked? h("span",{class:"pill crit"},"Закрыт") : h("span",{class:"pill ok"},"Открыт")),
          h("td",null,self? h("span",{class:"muted",style:"font-size:12px"},"это вы") :
            blocked? h("button",{class:"btn sm",onclick:()=>setProfile(p.id,{status:"approved"},"Доступ возвращён","Возвращён доступ")},"Вернуть доступ")
                   : h("button",{class:"btn ghost sm danger",onclick:()=>confirmBox("Закрыть доступ для "+(p.email||"сотрудника")+"?","Закрыть",()=>setProfile(p.id,{status:"blocked"},"Доступ закрыт","Закрыт доступ"))},"Закрыть доступ")));
      })))));
    // matrix
    matrix.textContent="";
    const cur={buyer:blocksFor("buyer"),viewer:blocksFor("viewer")};
    const checkCell=(b,r)=>h("td",null,h("input",{type:"checkbox","aria-label":b.label+" для роли "+r,checked:cur[r].includes(b.id),onchange:e=>{
      const next={buyer:[...cur.buyer],viewer:[...cur.viewer]};
      next[r]= e.target.checked? [...new Set([...next[r],b.id])] : next[r].filter(x=>x!==b.id);
      write(()=>S.db.doc("settings/access").set({blocks:next}),"Видимость обновлена"); logAction("Изменена видимость блоков", r+": "+b.label);
    }}));
    const rows=BLOCKS.filter(b=>b.id!=="admin").map(b=>h("tr",null,h("td",null,b.label),h("td",null,"✓"),checkCell(b,"buyer"),checkCell(b,"viewer")));
    rows.push(h("tr",null,h("td",null,"Доступы и логи"),h("td",null,"✓"),h("td",{class:"muted"},"—"),h("td",{class:"muted"},"—")));
    matrix.append(
      h("div",{class:"tbl-wrap"},h("table",{class:"matrix",style:"min-width:480px"},
        h("thead",null,h("tr",null,h("th",null,"Блок"),h("th",null,"Администратор"),h("th",null,"Медиабайер"),h("th",null,"Наблюдатель"))),
        h("tbody",null,rows))),
      h("div",{class:"muted",style:"font-size:12px"},"Медиабайер двигает свои задачи и тесты, создаёт тесты и идеи. Наблюдатель только смотрит. Администратор одобряет людей, создаёт хабы и задачи, правит всё. Права проверяются и на сервере, а не только в интерфейсе."));
    // logs
    logs.textContent="";
    if(!S.logs.length){ logs.append(h("div",{class:"muted",style:"font-size:13px"},"Действий пока нет.")); return; }
    logs.append(h("div",{class:"tbl-wrap",style:"max-height:460px;overflow:auto"},h("table",{style:"min-width:560px"},
      h("thead",null,h("tr",null,h("th",null,"Когда"),h("th",null,"Кто"),h("th",null,"Действие"),h("th",null,"Объект"))),
      h("tbody",null,S.logs.map(l=>h("tr",null,h("td",{class:"num muted",style:"white-space:nowrap"},fmtTime(l.at)),h("td",null,person(l.actor)),h("td",null,l.action),h("td",{class:"muted",text:l.target||""})))))));
  }};
}

/* ---------------- boot ---------------- */
async function loadProfiles(){
  const { data, error } = await sb.from("profiles").select("*").order("created_at");
  if(error) return;
  S.profiles=data||[];
  S.members={};
  S.profiles.forEach(p=>{
    S.names[p.id]={name:p.name||p.email||"", avatarUrl:p.avatar_url||initialsAvatar(p.name||p.email,p.id)};
    if(p.status==="approved") S.members[p.id]={role:p.role, at:Date.parse(p.approved_at||p.created_at)};
  });
  const mine=S.profiles.find(p=>p.id===S.me);
  if(mine && mine.status!=="approved"){ location.reload(); return; }
  if(mine && mine.role!==S.meRole){ S.meRole=mine.role; }
  applyRole();
  renderMe(); mount();
}
async function loadLogs(){
  if(!isAdmin()) return;
  const { data } = await sb.from("logs").select("*").order("at",{ascending:false}).limit(300);
  S.logs=(data||[]).map(l=>({actor:l.actor,action:l.action,target:l.target,at:Date.parse(l.at)}));
  refresh();
}
function applyRole(){
  const r=myRole();
  S.isOwner = S.canEdit = r==="admin";
  S.canWrite = r!=="viewer";
  S.readOnly = r==="viewer";
}
(function init(){
  const hsh=location.hash.slice(1); if(BLOCKS.some(b=>b.id===hsh)) S.view=hsh;
  S.db=createStore(sb);
  S.me=me.id; S.meRole=me.role;
  S.names[me.id]={name:me.name||me.email||"", avatarUrl:me.avatar_url||initialsAvatar(me.name||me.email,me.id)};
  S.user={
    search: async q=>{ q=(q||"").toLowerCase();
      return S.profiles.filter(p=>p.status==="approved" && (!q || (p.name||"").toLowerCase().includes(q) || (p.email||"").toLowerCase().includes(q)))
        .slice(0,8).map(p=>({id:p.id,name:p.name||p.email||"",avatarUrl:(S.names[p.id]||{}).avatarUrl})); },
    profiles: async ids=>Object.fromEntries([].concat(ids).map(id=>[id,{id,name:(S.names[id]||{}).name||"",avatarUrl:(S.names[id]||{}).avatarUrl||initialsAvatar("?",id)}])),
  };
  applyRole();
  mount(); renderMe();
  fetch("/api/config").then(r=>r.json()).then(c=>{ S.ai={brief:!!c.brief,transcribe:!!c.transcribe}; mount(); }).catch(()=>{});
  subAll();
  loadProfiles();
  sb.channel("profiles-watch").on("postgres_changes",{event:"*",schema:"public",table:"profiles"},()=>loadProfiles()).subscribe();
})();

}
