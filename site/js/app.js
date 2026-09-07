import { ComparatorEngine } from './engine.js?rev=inline-20260907-2';

const engine = new ComparatorEngine();
console.info('XML Comparator UI build: inline-detail-20260907-2');
const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const state = {offset:0, selectedA:null, selectedB:null, expandedChangeId:null, categories:new Set(['added','removed','modified','moved'])};
const MAX_FILE = 100 * 1024 * 1024;

function esc(v=''){return String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));}
function setBusy(on,text='Analizando XML…'){const el=$('#busy');el.classList.toggle('show',on);$('#busyText').textContent=text;}
function showError(msg){const e=$('#error');e.textContent=msg;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),8000);}
function nextPaint(){return new Promise(r=>requestAnimationFrame(()=>setTimeout(r,20)));}

function updateThemeLabel(){const dark=document.documentElement.dataset.theme==='dark';$('#themeBtn').innerHTML=dark?'☀︎ <span>Claro</span>':'☾ <span>Oscuro</span>';}
function initTheme(){const saved=localStorage.getItem('xmlComparatorTheme');document.documentElement.dataset.theme=saved||'dark';updateThemeLabel();}
$('#themeBtn').addEventListener('click',()=>{const t=document.documentElement.dataset.theme==='dark'?'light':'dark';document.documentElement.dataset.theme=t;localStorage.setItem('xmlComparatorTheme',t);updateThemeLabel();});
initTheme();

function formatBytes(n){if(n<1024)return`${n} B`;if(n<1024**2)return`${(n/1024).toFixed(1)} KB`;return`${(n/1024**2).toFixed(1)} MB`;}
async function loadFile(side,file){
  if(!file)return;if(file.size>MAX_FILE){showError('El archivo supera el límite de 100 MB de esta edición web.');return;}
  if(!/\.xml$/i.test(file.name)) showError('Aviso: el archivo no termina en .xml; se intentará analizar de todos modos.');
  setBusy(true,`Leyendo Archivo ${side}…`);await nextPaint();
  try{
    const text=await file.text();
    setBusy(true,engine.docs[side==='A'?'B':'A']?`Comparando ${file.name}…`:`Analizando ${file.name}…`);await nextPaint();
    engine.load(side,file.name,text);
    renderState();
    state[`selected${side}`]=null;
    $('#xyResult').classList.remove('show');
  }catch(err){showError(err.message||String(err));}
  finally{setBusy(false);}
}

for(const side of ['A','B']){
  const input=$(`#file${side}`),drop=$(`#drop${side}`);
  input.addEventListener('change',()=>loadFile(side,input.files?.[0]));
  for(const ev of ['dragenter','dragover'])drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.add('drag');});
  for(const ev of ['dragleave','drop'])drop.addEventListener(ev,e=>{e.preventDefault();drop.classList.remove('drag');});
  drop.addEventListener('drop',e=>loadFile(side,e.dataTransfer.files?.[0]));
}

function renderState(){
  const s=engine.state();
  for(const side of ['A','B']){
    const d=s.docs[side];
    $(`#name${side}`).textContent=d?.name||`Selecciona el archivo ${side}`;
    $(`#info${side}`).textContent=d?`${d.node_count.toLocaleString()} nodos · ${d.max_depth} niveles`:'Arrastra un XML aquí o selecciónalo';
    $(`#status${side}`).textContent=d?'Archivo cargado':'Sin archivo';
    $(`#drop${side}`).classList.toggle('loaded',!!d);
  }
  $('#workspace').style.display=s.ready?'block':'none';
  if(s.ready){renderStats(s.summary);state.offset=0;renderChanges(true);searchNodes('A','');searchNodes('B','');}
}

function renderStats(s){
  $('#stats').innerHTML=`
    <div class="stat add"><strong>+${s.added_subtree_events.toLocaleString()}</strong><span>subárboles agregados · ${s.added_nodes_inside_subtrees.toLocaleString()} nodos</span></div>
    <div class="stat rem"><strong>−${s.removed_subtree_events.toLocaleString()}</strong><span>subárboles eliminados · ${s.removed_nodes_inside_subtrees.toLocaleString()} nodos</span></div>
    <div class="stat"><strong>${s.modified_element_count.toLocaleString()}</strong><span>elementos modificados</span></div>
    <div class="stat"><strong>${s.moved_element_count.toLocaleString()}</strong><span>reordenados</span></div>
    <div class="stat logic"><strong>${s.direct_logic_change_count.toLocaleString()}</strong><span>lógica directa</span></div>`;
}

function filterOptions(){return{categories:[...state.categories],query:$('#searchChanges').value,logicOnly:$('#logicOnly').checked,severity:$('#severity').value,offset:state.offset,limit:80};}
function renderChanges(reset=false){
  if(reset){state.offset=0;state.expandedChangeId=null;$('#changes').innerHTML='';}
  const d=engine.changes(filterOptions());
  if(reset&&!d.items.length)$('#changes').innerHTML='<div class="empty">No hay cambios con estos filtros.</div>';
  for(const x of d.items)$('#changes').insertAdjacentHTML('beforeend',changeRow(x));
  state.offset+=d.items.length;
  $('#more').style.display=state.offset<d.total?'block':'none';
  $('#more').textContent=`Mostrar más · ${state.offset.toLocaleString()} de ${d.total.toLocaleString()}`;
  $('#resultCount').textContent=`${d.total.toLocaleString()} resultados`;
}
function changeRow(x){
  const extra=(x.category==='added'||x.category==='removed')?`${(x.subtree_node_count||1).toLocaleString()} nodos`:x.attribute?`@${esc(x.attribute)}`:'';
  return `<article class="change-item category-${esc(x.category)}" data-change-id="${x.id}">
    <button class="change" data-id="${x.id}" type="button" aria-expanded="false">
      <span class="kind ${x.category}">${esc(x.label)}</span>
      <span class="reasonwrap"><b>${esc(x.reason_label)}</b><small>${esc(extra)}</small></span>
      <code class="node-name">${esc(x.node_label||'XML')}</code>
      <span class="change-actions">${x.possible_logic?'<span class="logic-dot">◆ lógica</span>':'<span></span>'}<span class="chevron" aria-hidden="true">⌄</span></span>
    </button>
    <div class="inline-detail" data-detail-for="${x.id}"></div>
  </article>`;
}
$('#changes').addEventListener('click',e=>{
  const close=e.target.closest('.inline-close');
  if(close){
    const item=close.closest('.change-item');
    if(item) closeInlineDetail(item);
    return;
  }
  const row=e.target.closest('.change');
  if(!row)return;
  const item=row.closest('.change-item');
  if(!item)return;
  const id=Number(row.dataset.id);
  if(item.classList.contains('expanded')){closeInlineDetail(item);return;}
  $$('#changes .change-item.expanded').forEach(closeInlineDetail);
  const target=item.querySelector('.inline-detail');
  target.innerHTML=detailHTML(engine.detail(id));
  item.classList.add('expanded');
  row.setAttribute('aria-expanded','true');
  state.expandedChangeId=id;
});
function closeInlineDetail(item){
  item.classList.remove('expanded');
  item.querySelector('.change')?.setAttribute('aria-expanded','false');
  const target=item.querySelector('.inline-detail');
  if(target)target.innerHTML='';
  if(state.expandedChangeId===Number(item.dataset.changeId))state.expandedChangeId=null;
}
$('#more').addEventListener('click',()=>renderChanges(false));

for(const chip of $$('.chip[data-category]'))chip.addEventListener('click',()=>{const c=chip.dataset.category;if(state.categories.has(c))state.categories.delete(c);else state.categories.add(c);chip.classList.toggle('active',state.categories.has(c));renderChanges(true);});
let searchTimer;$('#searchChanges').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>renderChanges(true),180);});
$('#logicOnly').addEventListener('change',()=>renderChanges(true));$('#severity').addEventListener('change',()=>renderChanges(true));

function treeHTML(lines,empty='No existe en este archivo'){
  if(!lines?.length)return`<div class="tree-placeholder">${esc(empty)}</div>`;
  return `<div class="xml-tree">${lines.map((l,i)=>`<div class="xml-line status-${esc(l.status||'neutral')}"><span class="line-no">${i+1}</span><span class="tree-indent" style="width:${Math.max(0,Number(l.depth)||0)*18}px"></span><span class="xml-code">${esc(l.text)}</span></div>`).join('')}</div>`;
}
function treePanel(title,lines,empty){return`<section class="tree-panel"><header class="tree-title"><span>${esc(title)}</span><span>${lines?.length?`${lines.length.toLocaleString()} líneas`:''}</span></header>${treeHTML(lines,empty)}</section>`;}
function detailHTML(d){
  const oldv=d.data?.old,newv=d.data?.new;
  let meta='';
  if(oldv!==undefined||newv!==undefined)meta=`<div class="meta-box"><small>Cambio puntual</small><code>${oldv!==undefined?esc(oldv):'—'} <span>→</span> ${newv!==undefined?esc(newv):'—'}</code></div>`;
  return `<div class="detail-head"><div><b>${esc(d.label)}</b><div class="detail-sub">${esc(d.reason_label)}${d.possible_logic?' · posible impacto lógico':''}</div></div><button class="close inline-close" type="button" aria-label="Cerrar detalle">×</button></div><div class="tree-grid">${treePanel('Archivo A · anterior',d.old_tree,'El elemento aún no existía')}${treePanel('Archivo B · nuevo',d.new_tree,'El elemento fue eliminado')}</div><div class="legend"><span><i class="lg-added"></i>agregado</span><span><i class="lg-removed"></i>eliminado</span><span><i class="lg-modified"></i>modificado</span><span><i class="lg-moved"></i>reordenado</span></div>${meta}`;
}

$$('.tab').forEach(tab=>tab.addEventListener('click',()=>{$$('.tab').forEach(t=>t.classList.toggle('active',t===tab));$$('.view').forEach(v=>v.classList.toggle('active',v.id===tab.dataset.view));}));

function searchNodes(side,q){
  const items=engine.search(side,q,80),box=$(`#nodes${side}`);
  box.innerHTML=items.map(n=>`<button class="node-result ${state[`selected${side}`]===n.id?'selected':''}" data-id="${esc(n.id)}"><b>&lt;${esc(n.tag)}&gt;</b><span class="nodepath">${esc(n.path)}</span><span class="hint">nivel ${n.depth} · ${n.children} hijos · ${n.attrs} atributos${n.hint?' · '+esc(n.hint):''}</span></button>`).join('')||'<div class="empty">Sin resultados</div>';
}
for(const side of ['A','B']){
  let t; $(`#search${side}`).addEventListener('input',e=>{clearTimeout(t);t=setTimeout(()=>searchNodes(side,e.target.value),120);});
  $(`#nodes${side}`).addEventListener('click',e=>{const n=e.target.closest('.node-result');if(!n)return;state[`selected${side}`]=n.dataset.id;$$(`#nodes${side} .node-result`).forEach(x=>x.classList.toggle('selected',x===n));$('#compareXY').disabled=!(state.selectedA&&state.selectedB);});
}
$('#compareXY').addEventListener('click',async()=>{
  if(!(state.selectedA&&state.selectedB))return;setBusy(true,'Comparando X ↔ Y…');await nextPaint();
  try{renderXY(engine.manualCompare(state.selectedA,state.selectedB,$('#deepXY').checked));}catch(e){showError(e.message);}finally{setBusy(false);}
});
function renderXY(d){
  const pct=(d.similarity*100).toFixed(1);
  const attrs=d.attributes.map(a=>`<tr><td><code>${esc(a.name)}</code></td><td class="status-${a.status}">${esc(a.status)}</td><td>${esc(a.old??'—')}</td><td>${esc(a.new??'—')}</td></tr>`).join('');
  const logic=d.logic_findings.length?`<div class="box"><small>Posible impacto lógico</small>${d.logic_findings.map(x=>`<div class="logic-finding">◆ ${esc(x.scope)} · ${esc(x.reason.replaceAll('_',' '))}</div>`).join('')}</div>`:'<div class="box"><small>Posible impacto lógico</small><div>Sin señales directas detectadas.</div></div>';
  let deep='';if(d.deep_summary){const s=d.deep_summary;deep=`<div class="section-title">Resumen del subárbol</div><div class="box"><b>${s.total_change_records.toLocaleString()}</b> cambios · +${s.added_subtree_events.toLocaleString()} / −${s.removed_subtree_events.toLocaleString()} · ${s.moved_element_count.toLocaleString()} reordenados · ${s.direct_logic_change_count.toLocaleString()} lógica directa</div>`;}
  $('#xyResult').innerHTML=`<div class="xy-summary"><div class="box"><small>Similitud estructural</small><div class="score">${pct}%</div></div><div class="box"><small>Estructura</small><div>A: ${d.structure.a.subtree_nodes.toLocaleString()} nodos · ${d.structure.a.children} hijos</div><div>B: ${d.structure.b.subtree_nodes.toLocaleString()} nodos · ${d.structure.b.children} hijos</div></div>${logic}</div><div class="section-title">Árbol XML comparado</div><div class="tree-grid">${treePanel('X · Archivo A',d.tree_a)}${treePanel('Y · Archivo B',d.tree_b)}</div><div class="legend"><span><i class="lg-added"></i>agregado</span><span><i class="lg-removed"></i>eliminado</span><span><i class="lg-modified"></i>modificado</span></div><div class="section-title">Atributos</div><div class="box table-scroll"><table class="attr-table"><thead><tr><th>Atributo</th><th>Estado</th><th>A</th><th>B</th></tr></thead><tbody>${attrs||'<tr><td colspan="4">Sin atributos</td></tr>'}</tbody></table></div>${deep}`;
  $('#xyResult').classList.add('show');$('#xyResult').scrollIntoView({behavior:'smooth',block:'start'});
}

renderState();
