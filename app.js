'use strict';

const API_BASE = window.AROEIRA_API_URL || 'https://aroeira-gfitness-sync.onrender.com';
const CACHE_KEY = 'aroeiraGfitness.cache.v3';
const TOKEN_KEY = 'aroeiraGfitness.session';
const PENDING_KEY = 'aroeiraGfitness.pending';
const USERNAME = 'admin';

let state = { students: [], history: [], lastUpdate: null };
let activeStudentId = null;
let activeProfileTab = 'info';
let revenueChart = null;
let confirmHandler = null;
let toastTimer = null;
let syncBusy = false;
let overdueFilter = 'all';

const $ = id => document.getElementById(id);
const qs = (sel, root = document) => root.querySelector(sel);
const qsa = (sel, root = document) => [...root.querySelectorAll(sel)];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>'"]/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));
}
function money(value) {
  const n = Number(value) || 0;
  return n.toLocaleString('pt-BR', { style:'currency', currency:'BRL' });
}
function dateObj(iso) { const d = new Date(`${iso}T00:00:00`); return Number.isNaN(d.getTime()) ? null : d; }
function formatDate(iso) { const d = dateObj(iso); return d ? d.toLocaleDateString('pt-BR') : '—'; }
function todayISO() { return new Date().toISOString().slice(0,10); }
function monthKey(iso) { return String(iso || '').slice(0,7); }
function monthLabel(iso) { const d=dateObj(iso); return d ? d.toLocaleDateString('pt-BR',{month:'long',year:'numeric'}).toUpperCase() : 'SEM DATA'; }
function daysUntil(iso) { const d=dateObj(iso); const t=dateObj(todayISO()); return d ? Math.round((d-t)/86400000) : null; }
function addDays(iso, amount) { const d=dateObj(iso); if(!d)return ''; d.setDate(d.getDate()+amount); return d.toISOString().slice(0,10); }
function addMonthsPreserveDay(iso, amount=1) { const d=dateObj(iso); if(!d)return ''; const day=d.getDate(); d.setDate(1); d.setMonth(d.getMonth()+amount); const last=new Date(d.getFullYear(),d.getMonth()+1,0).getDate(); d.setDate(Math.min(day,last)); return d.toISOString().slice(0,10); }
function parseMoney(v) { let raw=String(v??'').replace(/R\$\s?/gi,'').trim(); if(raw.includes(',')) raw=raw.replace(/\./g,'').replace(',','.'); const n=Number(raw); return Number.isFinite(n)?Number(n.toFixed(2)):0; }
function normalizePlan(v) { const s=String(v??'').trim(); if(!s)return ''; if(/CR.*DITO\s*15\s*DIAS/i.test(s))return 'CRÉDITO 15 DIAS'; return s.replace(/\s+/g,' ').toUpperCase(); }
function normalizeStudent(s) { return {...s, name:String(s?.name??'').trim().toUpperCase(), plan:normalizePlan(s?.plan), value:parseMoney(s?.value), email:String(s?.email??'').trim(), phone:String(s?.phone??'').trim(), due:/^\d{4}-\d{2}-\d{2}$/.test(String(s?.due??''))?String(s.due):'', evaluations:Array.isArray(s?.evaluations)?s.evaluations:[], paymentHistory:Array.isArray(s?.paymentHistory)?s.paymentHistory:[], gymHistory:Array.isArray(s?.gymHistory)?s.gymHistory:[]}; }
function normalizeState(data) { state.students=Array.isArray(data?.students)?data.students.map(normalizeStudent):[]; state.history=Array.isArray(data?.history)?data.history:[]; state.lastUpdate=data?.lastUpdate||null; }
function statusFor(student) {
  const diff=daysUntil(student?.due);
  if(diff===null)return {label:'Sem data',tone:'gray'};
  if(diff>=0)return {label:'Em Dia',tone:'green'};
  if(diff>=-30)return {label:'Vencido',tone:'red'};
  return {label:'Atrasado',tone:'red'};
}
function displayStatus(student) { return statusFor(student); }
function latestPayment(student) {
  return [...(student?.paymentHistory||[])].filter(p=>p?.date).sort((a,b)=>String(b.date).localeCompare(String(a.date)))[0] || null;
}
function totalRevenue(period) {
  const now=todayISO(); const currentMonth=monthKey(now); const currentYear=now.slice(0,4);
  let total=0;
  for(const s of state.students) for(const p of (s.paymentHistory||[])) {
    if(!p.date)continue;
    if(period==='day' && p.date===now) total+=parseMoney(p.value);
    if(period==='month' && monthKey(p.date)===currentMonth) total+=parseMoney(p.value);
    if(period==='year' && String(p.date).slice(0,4)===currentYear) total+=parseMoney(p.value);
  }
  return total;
}
function paymentEntries() {
  const entries=[];
  for(const s of state.students) for(const p of (s.paymentHistory||[])) entries.push({student:s,payment:p});
  return entries.sort((a,b)=>String(b.payment.date||'').localeCompare(String(a.payment.date||'')));
}
function dueSoonStudents() { return state.students.map(s=>({s,d:daysUntil(s.due)})).filter(x=>x.d!==null && x.d>=0 && x.d<=7).sort((a,b)=>a.d-b.d); }
function toast(message,type='success') { const el=$('toast'); el.textContent=message; el.className=`toast show ${type}`; clearTimeout(toastTimer); toastTimer=setTimeout(()=>el.className='toast',3200); }
function setSyncStatus(text,tone='') { const el=$('syncBadge'); el.className=`sync-badge ${tone}`; el.innerHTML=`<span class="dot"></span><span>${escapeHtml(text)}</span>`; }
function saveCache(){ try{ localStorage.setItem(CACHE_KEY,JSON.stringify(state)); }catch{} }
function loadCache(){ try{ const data=JSON.parse(localStorage.getItem(CACHE_KEY)||'null'); if(data?.students){normalizeState(data); return true;} }catch{} return false; }
function token(){ return sessionStorage.getItem(TOKEN_KEY)||''; }
function setToken(t){ sessionStorage.setItem(TOKEN_KEY,t); }
function clearToken(){ sessionStorage.removeItem(TOKEN_KEY); }
async function request(path, options={}, timeout=12000){
  const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeout);
  const headers=new Headers(options.headers||{}); headers.set('Content-Type','application/json'); if(token())headers.set('Authorization',`Bearer ${token()}`);
  try{ const res=await fetch(`${API_BASE}${path}`,{...options,headers,signal:controller.signal,cache:'no-store'}); const data=await res.json().catch(()=>({})); if(!res.ok){const err=new Error(data.error||`HTTP ${res.status}`);err.status=res.status;throw err;} return data; } finally{clearTimeout(timer);}
}
async function login(username,password){
  const data=await request('/api/auth/login',{method:'POST',body:JSON.stringify({username,password})},10000); setToken(data.token); return data;
}
async function loadCloud(){ const data=await request('/api/sync',{method:'GET'},12000); normalizeState(data); saveCache(); return data; }
async function persistCloud(){
  const payload={students:state.students,history:state.history};
  try{ const result=await request('/api/sync',{method:'POST',body:JSON.stringify(payload)},15000); localStorage.removeItem(PENDING_KEY); state.lastUpdate=result.lastUpdate||new Date().toISOString(); saveCache(); setSyncStatus(`Sincronizado ${new Date(state.lastUpdate).toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`,'ok'); return true; }
  catch(error){ localStorage.setItem(PENDING_KEY,JSON.stringify(payload)); setSyncStatus('Alteração pendente de sincronização','warn'); toast('Alteração salva neste dispositivo, mas ainda não foi enviada à nuvem.','error'); return false; }
}
async function syncNow(showToast=true){
  if(syncBusy)return; syncBusy=true; setSyncStatus('Sincronizando...','warn');
  try{
    const pending=localStorage.getItem(PENDING_KEY);
    if(pending){ try{ const payload=JSON.parse(pending); const result=await request('/api/sync',{method:'POST',body:JSON.stringify(payload)},15000); localStorage.removeItem(PENDING_KEY); state.lastUpdate=result.lastUpdate||null; }catch(e){} }
    await loadCloud(); renderAll(); setSyncStatus(`Sincronizado ${new Date().toLocaleTimeString('pt-BR',{hour:'2-digit',minute:'2-digit'})}`,'ok'); if(showToast)toast('Dados sincronizados.');
  }catch(error){ if(error.status===401){logout(false); toast('Sessão expirada. Entre novamente.','error');} else { setSyncStatus('Servidor indisponível','error'); if(!loadCache())toast('Não foi possível carregar os dados.','error'); else {renderAll(); if(showToast)toast('Usando o último cache local disponível.','error');} } }
  finally{syncBusy=false;}
}
function showApp(){ $('loginScreen').classList.add('hidden'); $('appShell').classList.remove('hidden'); }
function showLogin(){ $('appShell').classList.add('hidden'); $('loginScreen').classList.remove('hidden'); $('pass').value=''; }
function logout(show=true){ clearToken(); showLogin(); if(show)toast('Sessão encerrada.'); }
function switchTab(tab){ qsa('.tab').forEach(x=>x.classList.toggle('active',x.id===`tab-${tab}`)); qsa('.nav-item[data-tab]').forEach(x=>x.classList.toggle('active',x.dataset.tab===tab)); const titles={dashboard:'Dashboard',students:'Alunos',history:'Histórico de pagamentos',backup:'Backup e configurações'}; $('pageTitle').textContent=titles[tab]||'Dashboard'; if(window.innerWidth<=760)$('sidebar').classList.remove('open'); if(tab==='dashboard')renderDashboard(); if(tab==='students')renderStudents(); if(tab==='history')renderHistory(); }
function badge(status){ return `<span class="badge ${status.tone}">${escapeHtml(status.label)}</span>`; }
function renderDashboard(){
  const total=state.students.length; const active=state.students.filter(s=>statusFor(s).label==='Em Dia').length; const soon=dueSoonStudents().length; const late=state.students.filter(s=>['Vencido','Atrasado'].includes(statusFor(s).label)).length;
  $('totalAlunos').textContent=total; $('activeCount').textContent=active; $('dueSoon').textContent=soon; $('vencidos').textContent=late;
  $('dayRevenue').querySelector('strong').textContent=money(totalRevenue('day')); $('monthRevenue').querySelector('strong').textContent=money(totalRevenue('month')); $('yearRevenue').querySelector('strong').textContent=money(totalRevenue('year'));
  const due=dueSoonStudents().slice(0,6); $('dueList').innerHTML=due.length?due.map(({s,d})=>`<div class="list-row"><div class="list-main"><strong>${escapeHtml(s.name)}</strong><small>${escapeHtml(s.plan||'Sem plano')} · vence ${formatDate(s.due)}</small></div>${badge({label:d===0?'Hoje':`${d} dia${d===1?'':'s'}`,tone:d<=2?'red':'orange'})}</div>`).join(''):`<div class="empty"><p>Nenhum vencimento nos próximos 7 dias.</p></div>`;
  const recent=paymentEntries().slice(0,6); $('recentPayments').innerHTML=recent.length?recent.map(({student,payment})=>`<div class="list-row"><div class="list-main"><strong>${escapeHtml(student.name)}</strong><small>${formatDate(payment.date)} · ${escapeHtml(payment.month||'Pagamento')}</small></div><strong class="history-value">${money(payment.value)}</strong></div>`).join(''):`<div class="empty"><p>Nenhum pagamento registrado.</p></div>`;
  renderChart($('chartPeriod').value);
}
function renderChart(period){
  const ctx=$('revenueChart'); if(!ctx||!window.Chart)return;
  const labels=[],values=[]; const now=new Date();
  if(period==='year'){
    for(let i=0;i<12;i++){const d=new Date(now.getFullYear(),i,1);const key=`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;labels.push(d.toLocaleDateString('pt-BR',{month:'short'}));values.push(paymentEntries().filter(x=>monthKey(x.payment.date)===key).reduce((a,x)=>a+parseMoney(x.payment.value),0));}
  }else{
    const y=now.getFullYear(),m=now.getMonth(); const days=new Date(y,m+1,0).getDate(); for(let i=1;i<=days;i++){const key=`${y}-${String(m+1).padStart(2,'0')}-${String(i).padStart(2,'0')}`;labels.push(String(i));values.push(paymentEntries().filter(x=>x.payment.date===key).reduce((a,x)=>a+parseMoney(x.payment.value),0));}
  }
  if(revenueChart)revenueChart.destroy(); revenueChart=new Chart(ctx,{type:period==='year'?'bar':'line',data:{labels,datasets:[{label:'Recebimentos',data:values,borderColor:'#f3c544',backgroundColor:period==='year'?'rgba(243,197,68,.55)':'rgba(243,197,68,.14)',fill:period!=='year',tension:.35,borderWidth:2,pointRadius:period==='year'?0:2,pointBackgroundColor:'#f3c544'}]},options:{responsive:true,maintainAspectRatio:false,plugins:{legend:{display:false},tooltip:{callbacks:{label:c=>` ${money(c.raw)}`}}},scales:{x:{grid:{display:false},ticks:{color:'#747985',font:{size:9},maxTicksLimit:period==='year'?12:10}},y:{grid:{color:'#22252b'},ticks:{color:'#747985',font:{size:9},callback:v=>`R$ ${Number(v).toLocaleString('pt-BR')}`}}}}});
}
function renderStudents(){
  const tbody=$('studentsTable'); const search=$('search').value.trim().toLowerCase(); const filter=$('filter').value; let rows=[...state.students];
  if(filter==='ProxVencimento')rows.sort((a,b)=>(daysUntil(a.due)??9999)-(daysUntil(b.due)??9999)); if(filter==='DistVencimento')rows.sort((a,b)=>(daysUntil(b.due)??-9999)-(daysUntil(a.due)??-9999));
  rows=rows.filter(s=>{const text=`${s.name} ${s.phone} ${s.email}`.toLowerCase(); if(search&&!text.includes(search))return false; const st=statusFor(s).label, disp=displayStatus(s).label; if(['Em Dia','Pendente','Vencido','Atrasado'].includes(filter)&&st!==filter)return false; if(filter==='Pago'&&disp!=='Pago')return false; return true;});
  $('studentCount').textContent=`${rows.length} aluno${rows.length===1?'':'s'}`; $('studentEmpty').classList.toggle('hidden',rows.length>0); tbody.innerHTML=rows.map(s=>`<tr><td><div class="student-name">${escapeHtml(s.name)}</div><span class="student-meta">${escapeHtml(s.phone||s.email||'Sem contato')}</span></td><td>${escapeHtml(s.plan||'Sem plano')}<span class="student-meta">${money(s.value)}</span></td><td>${formatDate(s.due)}</td><td>${badge(displayStatus(s))}</td><td><div class="row-actions"><button class="mini-btn gold" data-action="profile" data-id="${s.id}">Perfil</button><button class="mini-btn" data-action="edit" data-id="${s.id}">Editar</button><button class="mini-btn red" data-action="delete" data-id="${s.id}">Excluir</button></div></td></tr>`).join('');
}
function renderHistory(){
  const entries=paymentEntries(); const now=todayISO(); $('historyMonth').textContent=money(totalRevenue('month')); $('historyYear').textContent=money(totalRevenue('year')); $('historyCount').textContent=entries.length;
  $('historyEmpty').classList.toggle('hidden',entries.length>0); $('historyTable').innerHTML=entries.map(({student,payment})=>`<tr><td>${formatDate(payment.date)}</td><td><div class="student-name">${escapeHtml(student.name)}</div><span class="student-meta">${escapeHtml(student.plan||'Sem plano')}</span></td><td>${escapeHtml(payment.month||monthLabel(payment.date))}</td><td><strong class="history-value">${money(payment.value)}</strong></td><td><div class="row-actions"><button class="mini-btn" data-action="profile-payment" data-id="${student.id}">Abrir aluno</button></div></td></tr>`).join('');
}
function renderAll(){ renderDashboard(); renderStudents(); renderHistory(); populatePlans(); }
function populatePlans(){ const plans=[...new Set(state.students.map(s=>normalizePlan(s.plan)).filter(Boolean))].sort(); const select=$('plan'); const current=select.value; select.innerHTML='<option value="">Sem plano</option>'+plans.map(p=>`<option value="${escapeHtml(p)}">${escapeHtml(p)}</option>`).join(''); if(plans.includes(current))select.value=current; }
function openModal(id){ $(id).classList.remove('hidden'); document.body.style.overflow='hidden'; }
function closeModal(id){ $(id).classList.add('hidden'); if(!qsa('.overlay:not(.hidden)').length)document.body.style.overflow=''; }
function openStudentForm(student=null){ $('studentForm').reset(); $('studentId').value=student?.id||''; $('studentModalTitle').textContent=student?'Editar aluno':'Novo aluno'; populatePlans(); if(student){$('name').value=student.name||'';$('phone').value=student.phone||'';$('email').value=student.email||'';$('plan').value=normalizePlan(student.plan);$('value').value=String(student.value??'').replace('.',',');$('due').value=student.due||'';$('payment').value=student.payment||statusFor(student).label;} else {$('payment').value='Pendente';$('due').value=todayISO();} openModal('studentModal'); setTimeout(()=>$('name').focus(),50); }
function openProfile(id,tab='info'){ const s=state.students.find(x=>String(x.id)===String(id)); if(!s)return; activeStudentId=s.id;activeProfileTab=tab; renderProfile();openModal('profileModal'); }
function renderProfile(){
  const s=state.students.find(x=>String(x.id)===String(activeStudentId)); if(!s)return; const st=statusFor(s),disp=displayStatus(s),payments=[...(s.paymentHistory||[])].sort((a,b)=>String(b.date).localeCompare(String(a.date))),evals=[...(s.evaluations||[])].sort((a,b)=>String(b.date).localeCompare(String(a.date))),latest=latestPayment(s);
  let body='';
  if(activeProfileTab==='info')body=`<div class="profile-section"><h3>Dados do aluno</h3><div class="info-grid"><div class="info-item"><small>Telefone</small><strong>${escapeHtml(s.phone||'—')}</strong></div><div class="info-item"><small>E-mail</small><strong>${escapeHtml(s.email||'—')}</strong></div><div class="info-item"><small>Plano</small><strong>${escapeHtml(s.plan||'Sem plano')}</strong></div><div class="info-item"><small>Mensalidade</small><strong>${money(s.value)}</strong></div><div class="info-item"><small>Vencimento</small><strong>${formatDate(s.due)}</strong></div><div class="info-item"><small>Último pagamento</small><strong>${latest?formatDate(latest.date):'—'}</strong></div></div></div><div class="profile-section"><h3>Situação</h3><p class="muted" style="font-size:11px;line-height:1.6;margin:0">Status operacional: <b style="color:#fff">${escapeHtml(disp.label)}</b>. Regra de vencimento: ${st.label==='Em Dia'?'mais de 1 dia restante':st.label==='Pendente'?'vence amanhã':st.label==='Vencido'?'vencido há até 29 dias':st.label==='Atrasado'?'vencido há 30 dias ou mais':'sem data de vencimento'}.</p></div>`;
  if(activeProfileTab==='payments')body=`<div class="profile-section"><div style="display:flex;justify-content:space-between;align-items:center;gap:10px"><h3 style="margin:0">Histórico de pagamentos</h3><button class="secondary-btn" data-profile-action="pix">Gerar Pix</button></div><div style="margin-top:12px">${payments.length?payments.map((p,i)=>`<div class="history-item"><div><strong>${escapeHtml(p.month||monthLabel(p.date))}</strong><small>${formatDate(p.date)}</small></div><div style="display:flex;align-items:center;gap:10px"><span class="history-value">${money(p.value)}</span><button class="mini-btn red" data-profile-action="delete-payment" data-index="${i}">Excluir</button></div></div>`).join(''):'<div class="empty"><p>Nenhum pagamento registrado.</p></div>'}</div></div><div id="pixArea"></div>`;
  if(activeProfileTab==='eval')body=`<div class="profile-section"><h3>Nova avaliação física</h3><form id="evalForm"><div class="eval-grid">${evalField('ev_date','Data','date',todayISO())}${evalField('ev_peso','Peso (kg)','number')}${evalField('ev_busto','Busto','number')}${evalField('ev_cintura','Cintura','number')}${evalField('ev_barriga','Barriga','number')}${evalField('ev_quadril','Quadril','number')}${evalField('ev_perna','Perna','number')}${evalField('ev_braco','Braço','number')}${evalField('ev_imc','IMC','number')}${evalField('ev_gordura','% Gordura','number')}${evalField('ev_massa','Massa magra','number')}${evalField('ev_visceral','Gordura visceral','number')}${evalField('ev_basal','Metabolismo basal','number')}${evalField('ev_idade','Idade metabólica','number')}</div><div class="modal-actions"><button class="primary-btn" type="submit">Salvar avaliação</button></div></form></div><div class="profile-section"><h3>Histórico de avaliações</h3>${evals.length?evals.map((e,i)=>`<div class="history-item"><div><strong>${formatDate(e.date)}</strong><small>Peso ${escapeHtml(e.peso||'—')} kg · Gordura ${escapeHtml(e.gordura||'—')}%</small></div><button class="mini-btn red" data-profile-action="delete-eval" data-index="${i}">Excluir</button></div>`).join(''):'<div class="empty"><p>Nenhuma avaliação registrada.</p></div>'}</div>`;
  $('profileContent').innerHTML=`<div class="profile-hero"><div><div class="eyebrow">PERFIL DO ALUNO</div><div class="profile-name">${escapeHtml(s.name)}</div><div class="profile-sub">${escapeHtml(s.phone||'Sem telefone')} · ${escapeHtml(s.email||'Sem e-mail')}</div></div><div class="profile-actions"><button class="secondary-btn" data-profile-action="edit">Editar</button><button class="primary-btn" data-profile-action="whatsapp">WhatsApp</button></div></div><div class="profile-kpis"><div class="profile-kpi"><small>STATUS</small><strong>${badge(disp)}</strong></div><div class="profile-kpi"><small>PLANO</small><strong>${escapeHtml(s.plan||'Sem plano')}</strong></div><div class="profile-kpi"><small>VENCIMENTO</small><strong>${formatDate(s.due)}</strong></div><div class="profile-kpi"><small>MENSALIDADE</small><strong>${money(s.value)}</strong></div></div><div class="profile-tabs"><button class="profile-tab ${activeProfileTab==='info'?'active':''}" data-profile-tab="info">INFORMAÇÕES</button><button class="profile-tab ${activeProfileTab==='payments'?'active':''}" data-profile-tab="payments">PAGAMENTOS</button><button class="profile-tab ${activeProfileTab==='eval'?'active':''}" data-profile-tab="eval">AVALIAÇÃO FÍSICA</button></div>${body}`;
}
function evalField(id,label,type,value=''){return `<label>${escapeHtml(label)}<input id="${id}" type="${type}" step="0.1" ${value?`value="${value}"`:''}></label>`;}
function openConfirm(title,message,handler){$('confirmTitle').textContent=title;$('confirmMessage').textContent=message;confirmHandler=handler;openModal('confirmModal');}
function saveStudentFromForm(e){ e.preventDefault(); const id=$('studentId').value; const payload={name:$('name').value.trim().toUpperCase(),phone:$('phone').value.trim(),email:$('email').value.trim(),plan:normalizePlan($('plan').value),value:parseMoney($('value').value),due:$('due').value,payment:$('payment').value}; if(!payload.name||!payload.due){toast('Preencha nome e vencimento.','error');return;} if(id){const s=state.students.find(x=>String(x.id)===String(id)); if(!s)return; const preserved={evaluations:Array.isArray(s.evaluations)?s.evaluations:[],paymentHistory:Array.isArray(s.paymentHistory)?s.paymentHistory:[],gymHistory:Array.isArray(s.gymHistory)?s.gymHistory:[]}; Object.assign(s,payload,preserved); } else {payload.id=nextId();payload.evaluations=[];payload.paymentHistory=[];payload.gymHistory=[];state.students.push(payload);} saveAndRefresh(id?`Aluno ${payload.name} atualizado.`:`Aluno ${payload.name} cadastrado.`); closeModal('studentModal');}
function nextId(){return state.students.reduce((max,s)=>Math.max(max,Number(s.id)||0),0)+1;}
async function saveAndRefresh(message){ saveCache();renderAll();toast(message);await persistCloud(); }
function editStudent(id){const s=state.students.find(x=>String(x.id)===String(id));if(s)openStudentForm(s);}
function deleteStudent(id){const s=state.students.find(x=>String(x.id)===String(id));if(!s)return;openConfirm('Excluir aluno?',`O aluno ${s.name} e todo o histórico dele serão removidos. Essa ação não pode ser desfeita.`,async()=>{state.students=state.students.filter(x=>String(x.id)!==String(id));await saveAndRefresh('Aluno excluído.');});}
function confirmPayment(){const s=state.students.find(x=>String(x.id)===String(activeStudentId));if(!s)return;const amount=s.value;openConfirm('Confirmar pagamento?',`Registrar ${money(amount)} para ${s.name} e avançar o vencimento em um mês?`,async()=>{const paidAt=todayISO();if(!s.paymentHistory)s.paymentHistory=[];s.paymentHistory.push({month:monthLabel(paidAt),value:amount,date:paidAt});s.payment='Pago';s.due=addMonthsPreserveDay(s.due||paidAt,1);await saveAndRefresh('Pagamento confirmado. Próximo vencimento atualizado.');renderProfile();});}
function deletePayment(index){const s=state.students.find(x=>String(x.id)===String(activeStudentId));if(!s||!s.paymentHistory)return;const payments=[...s.paymentHistory].sort((a,b)=>String(b.date).localeCompare(String(a.date)));const target=payments[index];if(!target)return;const realIndex=s.paymentHistory.indexOf(target);openConfirm('Excluir pagamento?',`Remover ${money(target.value)} de ${s.name}?`,async()=>{s.paymentHistory.splice(realIndex,1);if(!s.paymentHistory)s.paymentHistory=[];if(!s.paymentHistory.length&&s.payment==='Pago')s.payment='Pendente';await saveAndRefresh('Pagamento excluído.');renderProfile();});}
function addEvaluation(e){e.preventDefault();const s=state.students.find(x=>String(x.id)===String(activeStudentId));if(!s)return;const date=$('ev_date').value;if(!date){toast('Informe a data da avaliação.','error');return;}const ev={id:Date.now(),date};['peso','busto','cintura','barriga','quadril','perna','braco','imc','gordura','massa','visceral','basal','idade'].forEach(k=>ev[k]=$(('ev_'+k))?.value||'');if(!s.evaluations)s.evaluations=[];s.evaluations.unshift(ev);saveAndRefresh('Avaliação salva.');renderProfile();}
function deleteEvaluation(index){const s=state.students.find(x=>String(x.id)===String(activeStudentId));if(!s||!s.evaluations)return;const evals=[...s.evaluations].sort((a,b)=>String(b.date).localeCompare(String(a.date)));const target=evals[index];const real=s.evaluations.indexOf(target);openConfirm('Excluir avaliação?',`Excluir a avaliação de ${formatDate(target.date)}?`,async()=>{s.evaluations.splice(real,1);await saveAndRefresh('Avaliação excluída.');renderProfile();});}
function whatsapp(id){const s=state.students.find(x=>String(x.id)===String(id));if(!s?.phone){toast('Este aluno não possui telefone.','error');return;}const digits=s.phone.replace(/\D/g,'');const text=encodeURIComponent(`Olá, ${s.name.split(' ')[0]}! Aqui é da Aroeira G Fitness.`);window.open(`https://wa.me/55${digits}?text=${text}`,'_blank','noopener');}
function generatePix(){const s=state.students.find(x=>String(x.id)===String(activeStudentId));if(!s)return;const key='24382911000199',name='GILVA SANTOS ALMEIDA',city='PE DE SERRA',value=Number(s.value||0).toFixed(2);const payload=pixPayload(key,name,city,value,'MENSALIDADE');const area=$('pixArea');area.innerHTML=`<div class="profile-section" style="text-align:center"><h3>PIX copia e cola</h3><div id="qrcode" style="display:grid;place-items:center;background:#fff;padding:14px;border-radius:12px;width:max-content;margin:0 auto 12px"></div><textarea id="pixText" readonly style="width:100%;min-height:76px;background:#08090b;border:1px solid var(--border);color:#ddd;border-radius:10px;padding:10px;font-size:10px">${escapeHtml(payload)}</textarea><button class="secondary-btn" id="copyPixBtn" style="margin-top:10px">Copiar código</button><button class="primary-btn" id="confirmPaymentBtn" style="margin-top:10px;width:100%">Confirmar recebimento</button></div>`;if(window.QRCode)new QRCode($('qrcode'),{text:payload,width:170,height:170,colorDark:'#000',colorLight:'#fff'});}

function overdueStudents(){ return state.students.filter(s=>['Vencido','Atrasado'].includes(statusFor(s).label)).sort((a,b)=>{const rank={Vencido:0,Atrasado:1};const byStatus=rank[statusFor(a).label]-rank[statusFor(b).label];return byStatus||String(a.due||'').localeCompare(String(b.due||''));}); }
function reminderMessage(student){
  const status=statusFor(student).label;
  if(status==='Vencido'){
    const pix=pixPayload('24382911000199','GILVA SANTOS ALMEIDA','PE DE SERRA',Number(student.value||0).toFixed(2),'MENSALIDADE');
    return `*MENSAGEM AUTOMÁTICA*\n\nOlá! Seu vencimento de matrícula é dia ${formatDate(student.due)}. Não perca o ritmo, continue focado(a) nos seus objetivos 💪\n\nSegue o código cópia e cola.\n${pix}\nPara pagamento em cartão, digitar "cartão".\n\nDigite *"Não"* para não receber mais este lembrete.`;
  }
  return `Olá, tudo bem? 😊\n\nFaz um tempinho que não te vemos por aqui, e sentimos sua falta!\nNão perca o ritmo, volte hoje mesmo e aproveite 10% de desconto na mensalidade.\n\n📅 Promoção válida até ${formatDate(addDays(todayISO(),3))}.`;
}
function openReminder(studentId){
  const s=state.students.find(x=>String(x.id)===String(studentId)); if(!s?.phone)return;
  const digits=String(s.phone).replace(/\D/g,''); if(!digits){toast('Este aluno não possui telefone válido.','error');return;}
  window.open(`https://wa.me/55${digits}?text=${encodeURIComponent(reminderMessage(s))}`,'_blank','noopener');
}
function renderOverdueModal(){
  const all=overdueStudents();
  const list=overdueFilter==='all'?all:all.filter(s=>statusFor(s).label.toLowerCase()===overdueFilter);
  qsa('[data-reminder-filter]').forEach(b=>b.classList.toggle('active',b.dataset.reminderFilter===overdueFilter));
  $('overdueList').innerHTML=list.length?list.map(s=>{const st=statusFor(s); return `<div class="overdue-row"><div class="list-main"><strong>${escapeHtml(s.name)}</strong><small>${badge(st)} · venceu em ${formatDate(s.due)}</small></div><button class="secondary-btn" data-reminder-id="${s.id}" ${s.phone?'':'disabled'}>WhatsApp</button></div>`;}).join(''):'<div class="empty"><p>Nenhum aluno vencido ou atrasado.</p></div>';
  openModal('overdueModal');
}
function pixPayload(key,name,city,value,desc){const f=(id,val)=>id+String(val.length).padStart(2,'0')+val;const gui='br.gov.bcb.pix';let merchant=f('00',gui)+f('01',key)+f('02',desc.slice(0,25));let p=f('00','01')+f('26',merchant)+f('52','0000')+f('53','986')+f('54',value)+f('58','BR')+f('59',name.slice(0,25))+f('60',city.slice(0,15))+f('62',f('05','***'));return p+'6304'+crc16(p);}
function crc16(str){let crc=0xffff;for(let i=0;i<str.length;i++){crc^=str.charCodeAt(i)<<8;for(let j=0;j<8;j++)crc=(crc&0x8000)?((crc<<1)^0x1021)&0xffff:(crc<<1)&0xffff;}return crc.toString(16).toUpperCase().padStart(4,'0');}
async function copyPix(){const el=$('pixText');if(!el)return;try{await navigator.clipboard.writeText(el.value);toast('Código Pix copiado.');}catch{el.select();document.execCommand('copy');toast('Código Pix copiado.');}}
function exportCsv(){const rows=[['Nome','Email','Telefone','Plano','Valor','Vencimento','Status']];state.students.forEach(s=>rows.push([s.name,s.email,s.phone,s.plan,s.value,s.due,displayStatus(s).label]));const csv='\uFEFF'+rows.map(r=>r.map(v=>`"${String(v??'').replace(/"/g,'""')}"`).join(';')).join('\n');downloadBlob(csv,'AROEIRA_ALUNOS.csv','text/csv;charset=utf-8');}
function backupJson(){downloadBlob(JSON.stringify({students:state.students,history:state.history,lastUpdate:state.lastUpdate},null,2),'AROEIRA_BACKUP.json','application/json');}
function downloadBlob(content,name,type){const blob=new Blob([content],{type});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download=name;document.body.appendChild(a);a.click();a.remove();setTimeout(()=>URL.revokeObjectURL(url),500);}
async function importBackup(file){if(!file)return;try{const data=JSON.parse(await file.text());if(!Array.isArray(data.students))throw new Error('O arquivo não possui uma lista de alunos.');openConfirm('Importar backup?',`O backup contém ${data.students.length} alunos. Os dados atuais serão substituídos.`,async()=>{normalizeState(data);saveCache();renderAll();const ok=await persistCloud();$('importStatus').textContent=ok?'Backup importado e sincronizado.':'Backup importado localmente; sincronização pendente.';});}catch(error){$('importStatus').textContent='Erro: '+error.message;toast(error.message,'error');}}
async function changePassword(){const current=prompt('Digite a senha atual:');if(current===null)return;const next=prompt('Digite a nova senha (mínimo 6 caracteres):');if(next===null)return;if(next.length<6){toast('A nova senha precisa ter pelo menos 6 caracteres.','error');return;}try{await request('/api/auth/change-password',{method:'POST',body:JSON.stringify({currentPassword:current,newPassword:next})},10000);toast('Senha alterada com sucesso.');}catch(error){toast(error.status===401?'Senha atual inválida.':'Não foi possível alterar a senha.','error');}}

$('loginForm').addEventListener('submit',async e=>{e.preventDefault();$('loginError').classList.add('hidden');try{await login($('user').value.trim(),$('pass').value);showApp();if(!loadCache())setSyncStatus('Carregando dados...','warn');await syncNow(false);if(!state.students.length && !loadCache())toast('A conta está sem dados cadastrados.','error');renderAll();}catch(error){$('loginError').textContent=error.status===401?'Usuário ou senha inválidos.':'Não foi possível conectar ao servidor.';$('loginError').classList.remove('hidden');}});
$('logoutBtn').addEventListener('click',()=>logout());
$('kpiLate').addEventListener('click',()=>{overdueFilter='all';renderOverdueModal();});
qsa('[data-reminder-filter]').forEach(b=>b.addEventListener('click',()=>{overdueFilter=b.dataset.reminderFilter;renderOverdueModal();}));
$('overdueList').addEventListener('click',e=>{const b=e.target.closest('[data-reminder-id]');if(b)openReminder(b.dataset.reminderId);});
$('syncBtn').addEventListener('click',()=>syncNow(true));
$('menuBtn').addEventListener('click',()=>$('sidebar').classList.toggle('open'));
qsa('.nav-item[data-tab]').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.tab)));
qsa('[data-tab-link]').forEach(btn=>btn.addEventListener('click',()=>switchTab(btn.dataset.tabLink)));
$('newStudent').addEventListener('click',()=>openStudentForm());$('newStudentDash').addEventListener('click',()=>openStudentForm());
$('studentForm').addEventListener('submit',saveStudentFromForm);$('search').addEventListener('input',renderStudents);$('filter').addEventListener('change',renderStudents);$('chartPeriod').addEventListener('change',()=>renderChart($('chartPeriod').value));$('viewDue').addEventListener('click',()=>{$('filter').value='ProxVencimento';switchTab('students');renderStudents();});
$('exportCsvBtn').addEventListener('click',exportCsv);$('backupCsvBtn').addEventListener('click',exportCsv);$('backupBtn').addEventListener('click',backupJson);$('changePasswordBtn').addEventListener('click',changePassword);$('importFile').addEventListener('change',e=>importBackup(e.target.files[0]));
$('confirmAction').addEventListener('click',async()=>{const handler=confirmHandler;confirmHandler=null;closeModal('confirmModal');if(handler)await handler();});
qsa('[data-close]').forEach(btn=>btn.addEventListener('click',()=>closeModal(btn.dataset.close)));
qsa('.overlay').forEach(o=>o.addEventListener('click',e=>{if(e.target===o)closeModal(o.id)}));
$('studentsTable').addEventListener('click',e=>{const b=e.target.closest('[data-action]');if(!b)return;const id=b.dataset.id;const a=b.dataset.action;if(a==='profile'||a==='profile-payment')openProfile(id,a==='profile-payment'?'payments':'info');if(a==='edit')editStudent(id);if(a==='delete')deleteStudent(id);});
$('historyTable').addEventListener('click',e=>{const b=e.target.closest('[data-action="profile-payment"]');if(b)openProfile(b.dataset.id,'payments');});
$('profileContent').addEventListener('click',e=>{const tab=e.target.closest('[data-profile-tab]');if(tab){activeProfileTab=tab.dataset.profileTab;renderProfile();return;}const b=e.target.closest('[data-profile-action]');if(!b)return;const a=b.dataset.profileAction;if(a==='edit'){closeModal('profileModal');editStudent(activeStudentId);}if(a==='whatsapp')whatsapp(activeStudentId);if(a==='pix')generatePix();if(a==='delete-payment')deletePayment(Number(b.dataset.index));if(a==='delete-eval')deleteEvaluation(Number(b.dataset.index));});
$('profileContent').addEventListener('submit',e=>{if(e.target.id==='evalForm')addEvaluation(e)});
$('profileContent').addEventListener('click',e=>{if(e.target.id==='copyPixBtn')copyPix();if(e.target.id==='confirmPaymentBtn')confirmPayment();});

function boot(){
  loadCache();
  if(token()){
    showApp();renderAll();setSyncStatus('Verificando sessão...','warn');syncNow(false);
  } else {showLogin();}
  window.addEventListener('online',()=>{if(token())syncNow(false)});
  document.addEventListener('visibilitychange',()=>{if(!document.hidden&&token())syncNow(false)});
}
boot();
