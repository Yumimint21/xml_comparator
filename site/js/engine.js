const CONTROL_NAME_HINTS = new Set([
  'enabled','enable','disabled','disable','active','inactive','status','condition','conditions',
  'operator','operation','logic','logical','expression','expr','rule','rules','formula','predicate',
  'filter','threshold','limit','minimum','maximum','min','max','range','priority','weight','score',
  'order','sequence','mode','type','action','behavior','behaviour','state','flag','required','optional',
  'compare','comparator','relation','join','match','policy'
]);

const EXPLICIT_IDENTITY_HINTS = new Set(['id','uuid','guid','key','code','name','ref','reference','identifier']);
const BOOL_RE = /^(?:true|false|yes|no|on|off|enabled|disabled)$/i;
const INT_RE = /^[+-]?\d+$/;
const FLOAT_RE = /^[+-]?(?:\d+\.\d*|\d*\.\d+|\d+)(?:[eE][+-]?\d+)?$/;
const LOGIC_WORD_RE = /\b(?:AND|OR|NOT|XOR|IN|LIKE|BETWEEN|EXISTS|TRUE|FALSE|ENABLED|DISABLED)\b/gi;
const COMPARATOR_RE = /(?:==|!=|>=|<=|&&|\|\||>|<|=)/g;

export function normalizeWs(v='') { return String(v ?? '').replace(/\s+/g,' ').trim(); }
export function localName(name='') {
  const s = String(name);
  const brace = s.lastIndexOf('}');
  if (brace >= 0) return s.slice(brace + 1);
  const colon = s.indexOf(':');
  return colon >= 0 ? s.slice(colon + 1) : s;
}
function nameParts(name='') { return new Set(localName(name).toLowerCase().split(/[^a-z0-9]+/).filter(Boolean)); }
export function isControlName(name='') { for (const p of nameParts(name)) if (CONTROL_NAME_HINTS.has(p)) return true; return false; }
function isExplicitIdentityName(name='') { for (const p of nameParts(name)) if (EXPLICIT_IDENTITY_HINTS.has(p)) return true; return false; }

function valueType(raw='') {
  const s = normalizeWs(raw);
  if (!s) return 'empty';
  if (BOOL_RE.test(s)) return 'boolean_like';
  if (INT_RE.test(s)) return 'integer';
  if (FLOAT_RE.test(s)) return 'number';
  if (/^\d{4}-\d{2}-\d{2}(?:[Tt ]\d{2}:\d{2})?/.test(s)) return 'date_like';
  if (/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s)) return 'email';
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) return 'url';
  if (/^(?:\d{1,3}\.){3}\d{1,3}$/.test(s)) return 'ipv4';
  const words = s.match(LOGIC_WORD_RE) || [];
  const comps = s.match(COMPARATOR_RE) || [];
  if (words.length || comps.length) return 'expression_like';
  return 'string';
}

function logicSignature(raw='') {
  const s = normalizeWs(raw);
  const words = (s.match(LOGIC_WORD_RE) || []).map(x => x.toUpperCase());
  const comps = s.match(COMPARATOR_RE) || [];
  const cats = new Set();
  if (words.some(x => ['AND','OR','NOT','XOR'].includes(x))) cats.add('logical_connector');
  if (words.some(x => ['TRUE','FALSE','ENABLED','DISABLED'].includes(x))) cats.add('boolean_control');
  if (words.some(x => ['IN','LIKE','BETWEEN','EXISTS'].includes(x))) cats.add('membership_or_predicate');
  if (comps.length) cats.add('comparison_operator');
  return { categories:[...cats].sort(), wordCount:words.length, comparatorCount:comps.length };
}

function logicChange(name, oldValue, newValue) {
  const a = normalizeWs(oldValue), b = normalizeWs(newValue);
  const oldT = valueType(a), newT = valueType(b);
  const control = isControlName(name);
  const as = logicSignature(a), bs = logicSignature(b);
  if (JSON.stringify(as) !== JSON.stringify(bs) && (as.categories.length || bs.categories.length)) {
    return {possible:true, reason:'logical_expression_signature_changed', severity:'high'};
  }
  if (oldT === 'boolean_like' && newT === 'boolean_like' && a.toLowerCase() !== b.toLowerCase()) {
    return {possible:true, reason:control ? 'boolean_control_changed' : 'boolean_like_value_changed', severity:control ? 'high' : 'medium'};
  }
  if (control && a !== b) {
    const parts = nameParts(name);
    const high = ['operator','operation','logic','logical','condition','expression','expr','formula','predicate','comparator','compare','relation','join'].some(x => parts.has(x));
    return {possible:true, reason:high ? 'control_logic_value_changed' : 'control_attribute_or_value_changed', severity:high ? 'high' : 'medium'};
  }
  if (oldT !== newT) return {possible:false, reason:'value_type_changed', severity:'medium'};
  return {possible:false, reason:'value_changed', severity:'low'};
}

function hash32(str, seed=0x811c9dc5) {
  let h = seed >>> 0;
  for (let i=0;i<str.length;i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}
function stableHash(parts) {
  const s = parts.join('\x1f');
  const a = hash32(s, 0x811c9dc5).toString(16).padStart(8,'0');
  const b = hash32(s, 0x9e3779b9).toString(16).padStart(8,'0');
  return a+b;
}

function attrsObject(el) {
  const out = {};
  for (const a of el.attributes || []) { if (a.name === 'xmlns' || a.name.startsWith('xmlns:')) continue; out[a.name] = a.value; }
  return out;
}

function directText(el) {
  let s = '';
  for (const n of el.childNodes) if (n.nodeType === Node.TEXT_NODE || n.nodeType === Node.CDATA_SECTION_NODE) s += n.nodeValue || '';
  return normalizeWs(s);
}

function escapeXmlText(s='') { return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }
function escapeXmlAttr(s='') { return escapeXmlText(s).replace(/"/g,'&quot;'); }

function buildNode(el, parent=null, depth=0, siblingIndex=0, sameTagIndex=1, idCounter={v:0}, prefix='N') {
  const node = {
    id:`${prefix}:${++idCounter.v}`, el, tag:el.tagName, parent, depth, siblingIndex, sameTagIndex,
    attrs:attrsObject(el), text:directText(el), children:[], contentHash:'', shapeHash:'', subtreeSize:1, subtreeDepth:1
  };
  const counts = new Map();
  const kids = [...el.children];
  kids.forEach((childEl, idx) => {
    const c = (counts.get(childEl.tagName) || 0) + 1; counts.set(childEl.tagName,c);
    node.children.push(buildNode(childEl, node, depth+1, idx, c, idCounter, prefix));
  });
  node.subtreeSize = 1 + node.children.reduce((a,c)=>a+c.subtreeSize,0);
  node.subtreeDepth = node.children.length ? 1 + Math.max(...node.children.map(c=>c.subtreeDepth)) : 1;
  const attrParts = Object.entries(node.attrs).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>`${k}=${normalizeWs(v)}`);
  node.contentHash = stableHash(['TAG',node.tag,'TEXT',node.text,'ATTRS',...attrParts,'CHILDREN',...node.children.map(c=>c.contentHash)]);
  node.shapeHash = stableHash(['TAG',node.tag,'ATTRNAMES',...Object.keys(node.attrs).sort(),'TEXTTYPE',valueType(node.text),'CHILDTAGS',...node.children.map(c=>c.tag)]);
  return node;
}

export function parseXmlString(xmlText, prefix='N') {
  const head = xmlText.slice(0, 1024*1024).toUpperCase();
  if (head.includes('<!DOCTYPE') || head.includes('<!ENTITY')) {
    throw new Error('Se detectó DOCTYPE/ENTITY. Por seguridad, esta edición web no procesa ese XML.');
  }
  const parser = new DOMParser();
  const doc = parser.parseFromString(xmlText, 'application/xml');
  const err = doc.querySelector('parsererror');
  if (err) throw new Error('No se pudo interpretar el XML: ' + normalizeWs(err.textContent).slice(0,300));
  if (!doc.documentElement) throw new Error('El archivo XML no contiene un elemento raíz.');
  const root = buildNode(doc.documentElement, null, 0, 0, 1, {v:0}, prefix);
  const nodes = new Map(); const searchRows = [];
  walk(root).forEach(n => {
    nodes.set(n.id,n);
    const hintPairs = Object.entries(n.attrs).filter(([k,v])=>isExplicitIdentityName(k) && normalizeWs(v)).slice(0,2);
    const hint = hintPairs.map(([k,v])=>`@${localName(k)}=${normalizeWs(v)}`).join(' · ');
    const path = rawPath(n);
    const search = `${localName(n.tag)} ${path} ${Object.entries(n.attrs).map(([k,v])=>`${localName(k)} ${v}`).join(' ')} ${n.text}`.toLowerCase();
    searchRows.push({id:n.id,tag:localName(n.tag),path,depth:n.depth,children:n.children.length,attrs:Object.keys(n.attrs).length,hint,search});
  });
  return {doc, root, nodes, searchRows, nodeCount:root.subtreeSize, maxDepth:root.subtreeDepth-1};
}

function walk(root) { const out=[]; const stack=[root]; while(stack.length){const n=stack.pop();out.push(n);for(let i=n.children.length-1;i>=0;i--)stack.push(n.children[i]);} return out; }
export function rawPath(node) { const parts=[]; for(let n=node;n;n=n.parent) parts.push(`${localName(n.tag)}[${n.sameTagIndex}]`); return '/' + parts.reverse().join('/'); }

function inferKeyStats(rootA, rootB) {
  const explicit = new Set();
  function perDoc(root) {
    const byTag = new Map();
    for (const n of walk(root)) {
      if (!byTag.has(n.tag)) byTag.set(n.tag,[]); byTag.get(n.tag).push(n);
      Object.keys(n.attrs).forEach(a=>{ if (isExplicitIdentityName(a)) explicit.add(a); });
    }
    const result = new Map();
    for (const [tag,nodes] of byTag) {
      const vals = new Map();
      for (const n of nodes) for (const [k,v] of Object.entries(n.attrs)) {
        const nv=normalizeWs(v); if(!nv)continue; if(!vals.has(k))vals.set(k,[]); vals.get(k).push(nv);
      }
      const stats = new Map();
      for (const [attr, arr] of vals) stats.set(attr,{coverage:arr.length/Math.max(1,nodes.length), uniqueness:(new Set(arr)).size/Math.max(1,arr.length), count:arr.length});
      result.set(tag,stats);
    }
    return result;
  }
  const sa=perDoc(rootA), sb=perDoc(rootB), inferred=new Map();
  const tags=new Set([...sa.keys(),...sb.keys()]);
  for(const tag of tags){
    const attrs=new Set([...(sa.get(tag)?.keys()||[]),...(sb.get(tag)?.keys()||[])]);
    for(const attr of attrs){
      const ss=[sa.get(tag)?.get(attr),sb.get(tag)?.get(attr)].filter(Boolean);
      if(!ss.length || Math.max(...ss.map(x=>x.count))<2)continue;
      if(ss.every(x=>x.coverage>=0.50 && x.uniqueness>=0.90)){ if(!inferred.has(tag))inferred.set(tag,new Set()); inferred.get(tag).add(attr); }
    }
  }
  return {explicit,inferred};
}

function identityPairs(n, keys) {
  const out=[];
  for(const [k,v] of Object.entries(n.attrs)){
    const nv=normalizeWs(v); if(!nv)continue;
    if(keys.explicit.has(k))out.push(['explicit',k,nv]); else if(keys.inferred.get(n.tag)?.has(k))out.push(['inferred',k,nv]);
  }
  return out;
}
function uniqueIdentityMap(children, keys, kind) {
  const occ=new Map();
  children.forEach((n,idx)=>identityPairs(n,keys).forEach(([k,a,v])=>{if(k!==kind)return;const key=`${n.tag}\u0001${a}\u0001${v}`;if(!occ.has(key))occ.set(key,[]);occ.get(key).push(idx);}));
  const out=new Map(); for(const [k,v] of occ)if(v.length===1)out.set(k,v[0]); return out;
}
function jaccard(a,b){const A=new Set(a),B=new Set(b);if(!A.size&&!B.size)return 1;let inter=0;for(const x of A)if(B.has(x))inter++;return inter/Math.max(1,new Set([...A,...B]).size);}
function childCounter(n){const m=new Map();n.children.forEach(c=>m.set(c.tag,(m.get(c.tag)||0)+1));return m;}
function counterSimilarity(a,b){const keys=new Set([...a.keys(),...b.keys()]);if(!keys.size)return 1;let i=0,u=0;for(const k of keys){i+=Math.min(a.get(k)||0,b.get(k)||0);u+=Math.max(a.get(k)||0,b.get(k)||0);}return i/Math.max(1,u);}
function textSimilarity(a,b){if(a===b)return 1;if(!a||!b)return 0; a=a.slice(0,1000);b=b.slice(0,1000); const grams=s=>{const m=new Map();if(s.length<2){m.set(s,1);return m;}for(let i=0;i<s.length-1;i++){const g=s.slice(i,i+2);m.set(g,(m.get(g)||0)+1);}return m};const A=grams(a),B=grams(b);let inter=0,tot=0;for(const v of A.values())tot+=v;for(const v of B.values())tot+=v;for(const [k,v] of A)inter+=Math.min(v,B.get(k)||0);return (2*inter)/Math.max(1,tot);}
function nodeSimilarity(a,b,keys){
  if(a.tag!==b.tag)return 0;if(a.contentHash===b.contentHash)return 1;
  const ap=identityPairs(a,keys),bp=identityPairs(b,keys),am=new Map(ap.map(([k,a,v])=>[`${k}\u0001${a}`,v])),bm=new Map(bp.map(([k,a,v])=>[`${k}\u0001${a}`,v]));
  let explicit=false,inferred=false;for(const [k,v] of am){if(!bm.has(k)||bm.get(k)!==v)continue;if(k.startsWith('explicit\u0001'))explicit=true;if(k.startsWith('inferred\u0001'))inferred=true;}
  const aKeys=Object.keys(a.attrs),bKeys=Object.keys(b.attrs),attrNames=jaccard(aKeys,bKeys),common=aKeys.filter(k=>Object.hasOwn(b.attrs,k));
  const exactValues=common.length?common.filter(k=>normalizeWs(a.attrs[k])===normalizeWs(b.attrs[k])).length/common.length:(!aKeys.length&&!bKeys.length?1:0);
  const typeValues=common.length?common.filter(k=>valueType(a.attrs[k])===valueType(b.attrs[k])).length/common.length:exactValues;
  const childSim=counterSimilarity(childCounter(a),childCounter(b));
  const sizeSim=1-Math.abs(a.subtreeSize-b.subtreeSize)/Math.max(a.subtreeSize,b.subtreeSize,1);
  const shape=a.shapeHash===b.shapeHash?1:0, txt=textSimilarity(a.text,b.text);
  let score=.15*attrNames+.25*exactValues+.05*typeValues+.20*childSim+.10*sizeSim+.10*shape+.15*txt;
  if(explicit)score=Math.max(score,.94);else if(inferred)score=Math.max(score,.90);return Math.min(1,score);
}
function lowerBound(arr, value){let lo=0,hi=arr.length;while(lo<hi){const m=(lo+hi)>>1;if(arr[m]<value)lo=m+1;else hi=m;}return lo;}
function nearest(pool,target,limit){if(pool.length<=limit)return pool.slice();const k=lowerBound(pool,target), lo=Math.max(0,k-limit),hi=Math.min(pool.length,k+limit);return pool.slice(lo,hi).sort((a,b)=>Math.abs(a-target)-Math.abs(b-target)).slice(0,limit);}
function coarseKey(n){return JSON.stringify([n.tag,Object.keys(n.attrs).sort(),[...childCounter(n).entries()].sort(),valueType(n.text)]);}
function matchChildren(aChildren,bChildren,keys,fuzzyThreshold=.64){
  const ua=new Set(aChildren.map((_,i)=>i)),ub=new Set(bChildren.map((_,i)=>i)),matches=[];
  const claim=(ai,bi,method,confidence)=>{if(!ua.has(ai)||!ub.has(bi)||aChildren[ai].tag!==bChildren[bi].tag)return false;matches.push({ai,bi,method,confidence});ua.delete(ai);ub.delete(bi);return true;};
  let ma=uniqueIdentityMap(aChildren,keys,'explicit'),mb=uniqueIdentityMap(bChildren,keys,'explicit');for(const k of [...ma.keys()].filter(k=>mb.has(k)).sort())claim(ma.get(k),mb.get(k),'explicit_identity',.99);
  const ha=new Map(),hb=new Map();for(const i of ua){const n=aChildren[i],k=`${n.tag}\u0001${n.contentHash}`;if(!ha.has(k))ha.set(k,[]);ha.get(k).push(i);}for(const j of ub){const n=bChildren[j],k=`${n.tag}\u0001${n.contentHash}`;if(!hb.has(k))hb.set(k,[]);hb.get(k).push(j);}
  for(const k of ha.keys()){if(!hb.has(k))continue;const la=ha.get(k).slice().sort((a,b)=>a-b),lb=hb.get(k).slice().sort((a,b)=>a-b);const count=Math.min(la.length,lb.length);for(let z=0;z<count;z++)claim(la[z],lb[z],'exact_subtree',1);}
  const uaSorted=[...ua].sort((a,b)=>a-b),ubSorted=[...ub].sort((a,b)=>a-b);ma=uniqueIdentityMap(uaSorted.map(i=>aChildren[i]),keys,'inferred');mb=uniqueIdentityMap(ubSorted.map(i=>bChildren[i]),keys,'inferred');for(const k of ma.keys())if(mb.has(k))claim(uaSorted[ma.get(k)],ubSorted[mb.get(k)],'inferred_identity',.95);
  const pairs=[];const product=ua.size*ub.size;
  if(product<=180000){for(const i of ua)for(const j of ub)if(aChildren[i].tag===bChildren[j].tag)pairs.push([i,j]);}
  else{
    const blocks=new Map(),byTag=new Map();for(const j of ub){const n=bChildren[j],ck=coarseKey(n);if(!blocks.has(ck))blocks.set(ck,[]);blocks.get(ck).push(j);if(!byTag.has(n.tag))byTag.set(n.tag,[]);byTag.get(n.tag).push(j);}for(const i of ua){const n=aChildren[i],target=Math.round(i*(bChildren.length-1)/Math.max(1,aChildren.length-1));const block=blocks.get(coarseKey(n))||[];for(const j of (block.length<=40?block:nearest(block,target,24)))pairs.push([i,j]);for(const j of nearest(byTag.get(n.tag)||[],target,12))pairs.push([i,j]);}}
  const uniq=new Set(),cands=[];for(const [i,j] of pairs){const kk=`${i}:${j}`;if(uniq.has(kk)||!ua.has(i)||!ub.has(j))continue;uniq.add(kk);const sim=nodeSimilarity(aChildren[i],bChildren[j],keys);if(sim>=fuzzyThreshold){const pos=1-Math.abs(i-j)/Math.max(aChildren.length,bChildren.length,1);cands.push([sim,pos,i,j]);}}
  cands.sort((x,y)=>y[0]-x[0]||y[1]-x[1]);for(const [sim,_p,i,j] of cands)if(ua.has(i)&&ub.has(j))claim(i,j,'fuzzy',Math.round(sim*10000)/10000);
  matches.sort((x,y)=>x.ai-y.ai);return {matches,removed:[...ua].sort((a,b)=>a-b),added:[...ub].sort((a,b)=>a-b)};
}
function lisPositions(values){if(!values.length)return new Set();const tails=[],tailsIdx=[],prev=Array(values.length).fill(-1);for(let i=0;i<values.length;i++){const k=lowerBound(tails,values[i]);if(k===tails.length){tails.push(values[i]);tailsIdx.push(i);}else{tails[k]=values[i];tailsIdx[k]=i;}if(k>0)prev[i]=tailsIdx[k-1];}let cur=tailsIdx[tailsIdx.length-1];const out=new Set();while(cur>=0){out.add(cur);cur=prev[cur];}return out;}
function subtreeHasControlSignal(node,limit=300){const stack=[node];let seen=0;while(stack.length&&seen<limit){const n=stack.pop();seen++;if(isControlName(n.tag)||logicSignature(n.text).categories.length)return true;for(const [k,v] of Object.entries(n.attrs))if(isControlName(k)||logicSignature(v).categories.length)return true;stack.push(...n.children);}return false;}

function compareNodeValues(a,b,state){
  const pOld=rawPath(a),pNew=rawPath(b),ak=new Set(Object.keys(a.attrs)),bk=new Set(Object.keys(b.attrs));
  for(const k of [...ak].filter(x=>!bk.has(x)).sort()){const logic=isControlName(k);state.add({type:'attribute_removed',pathOld:pOld,pathNew:pNew,severity:'medium',possibleLogic:logic,reason:logic?'control_attribute_removed':'attribute_removed',data:{attribute:localName(k),old:a.attrs[k]},oldNode:a,newNode:b});}
  for(const k of [...bk].filter(x=>!ak.has(x)).sort()){const logic=isControlName(k);state.add({type:'attribute_added',pathOld:pOld,pathNew:pNew,severity:'medium',possibleLogic:logic,reason:logic?'control_attribute_added':'attribute_added',data:{attribute:localName(k),new:b.attrs[k]},oldNode:a,newNode:b});}
  for(const k of [...ak].filter(x=>bk.has(x)).sort()){const old=normalizeWs(a.attrs[k]),neu=normalizeWs(b.attrs[k]);if(old===neu)continue;const lc=logicChange(k,old,neu);state.add({type:'attribute_modified',pathOld:pOld,pathNew:pNew,severity:lc.severity,possibleLogic:lc.possible,reason:lc.reason,data:{attribute:localName(k),old,new:neu},oldNode:a,newNode:b});}
  if(a.text!==b.text){const lc=logicChange(a.tag,a.text,b.text);state.add({type:'text_modified',pathOld:pOld,pathNew:pNew,severity:lc.severity,possibleLogic:lc.possible,reason:lc.reason,data:{old:a.text,new:b.text},oldNode:a,newNode:b});}
}
function createDiffState(){return {changes:[],addedNodesTotal:0,removedNodesTotal:0,matchedNodes:0,matchMethods:new Map(),add(c){c.id=this.changes.length;this.changes.push(c);if(c.type==='node_added'&&c.newNode)this.addedNodesTotal+=c.newNode.subtreeSize;if(c.type==='node_removed'&&c.oldNode)this.removedNodesTotal+=c.oldNode.subtreeSize;}};}
function compareNodes(a,b,keys,state,fuzzy=.64){
  state.matchedNodes++;compareNodeValues(a,b,state);const mm=matchChildren(a.children,b.children,keys,fuzzy);for(const m of mm.matches)state.matchMethods.set(m.method,(state.matchMethods.get(m.method)||0)+1);
  const stable=lisPositions(mm.matches.map(m=>m.bi));for(let idx=0;idx<mm.matches.length;idx++){if(stable.has(idx))continue;const m=mm.matches[idx],on=a.children[m.ai],nn=b.children[m.bi];state.add({type:'node_moved',pathOld:rawPath(on),pathNew:rawPath(nn),severity:'medium',possibleLogic:true,reason:'relative_sibling_order_changed',data:{old_position:m.ai+1,new_position:m.bi+1,match_method:m.method,match_confidence:m.confidence},oldNode:on,newNode:nn});}
  for(const i of mm.removed){const n=a.children[i],control=subtreeHasControlSignal(n);state.add({type:'node_removed',pathOld:rawPath(n),pathNew:null,severity:'medium',possibleLogic:control,reason:control?'control_or_rule_subtree_removed':'node_or_subtree_removed',data:{subtree_node_count:n.subtreeSize,subtree_depth:n.subtreeDepth},oldNode:n,newNode:null});}
  for(const j of mm.added){const n=b.children[j],control=subtreeHasControlSignal(n);state.add({type:'node_added',pathOld:null,pathNew:rawPath(n),severity:'medium',possibleLogic:control,reason:control?'control_or_rule_subtree_added':'node_or_subtree_added',data:{subtree_node_count:n.subtreeSize,subtree_depth:n.subtreeDepth},oldNode:null,newNode:n});}
  for(const m of mm.matches)compareNodes(a.children[m.ai],b.children[m.bi],keys,state,fuzzy);
}

function changeCategory(c){if(c.type==='node_added')return'added';if(c.type==='node_removed')return'removed';if(c.type==='node_moved')return'moved';return'modified';}
const LABELS={node_added:'Agregado',node_removed:'Eliminado',node_moved:'Reordenado',attribute_added:'Atributo agregado',attribute_removed:'Atributo eliminado',attribute_modified:'Modificado',text_modified:'Texto modificado'};
const REASONS={
  node_or_subtree_added:'Subárbol agregado',node_or_subtree_removed:'Subárbol eliminado',control_or_rule_subtree_added:'Bloque de control/regla agregado',control_or_rule_subtree_removed:'Bloque de control/regla eliminado',relative_sibling_order_changed:'Orden relativo modificado',attribute_added:'Atributo agregado',attribute_removed:'Atributo eliminado',control_attribute_added:'Atributo de control agregado',control_attribute_removed:'Atributo de control eliminado',value_changed:'Valor modificado',value_type_changed:'Tipo de valor modificado',boolean_like_value_changed:'Valor booleano modificado',boolean_control_changed:'Control booleano modificado',control_logic_value_changed:'Valor lógico de control modificado',control_attribute_or_value_changed:'Valor de control modificado',logical_expression_signature_changed:'Expresión lógica modificada'
};

function openLine(n){const attrs=Object.entries(n.attrs).map(([k,v])=>` ${k}="${escapeXmlAttr(v)}"`).join('');if(!n.children.length&&!n.text)return `<${n.tag}${attrs} />`;return `<${n.tag}${attrs}>${n.text&&!n.children.length?escapeXmlText(n.text):''}`;}
function closeLine(n){return `</${n.tag}>`;}
function pushSubtreeLines(n,out,base,statusMap,defaultStatus='neutral',limit=3500,highlightAll=false){if(out.length>=limit)return;const st=highlightAll?defaultStatus:(statusMap?.get(n.id)||defaultStatus);out.push({depth:base,text:openLine(n),status:st});for(const c of n.children)pushSubtreeLines(c,out,base+1,statusMap,defaultStatus,limit,highlightAll);if((n.children.length||n.text)&&out.length<limit)out.push({depth:base,text:closeLine(n),status:st==='added'||st==='removed'?st:'neutral'});}
function ancestorChain(node,levels=5){const arr=[];for(let n=node.parent;n&&arr.length<levels;n=n.parent)arr.push(n);return arr.reverse();}
function contextTreeLines(node,highlight='neutral',ancestors=5,highlightSubtree=false){if(!node)return[];const out=[],chain=ancestorChain(node,ancestors);let depth=0;for(const a of chain)out.push({depth:depth++,text:openLine(a),status:'neutral'});pushSubtreeLines(node,out,depth,null,highlight,3500,highlightSubtree);for(let i=chain.length-1;i>=0;i--)out.push({depth:i,text:closeLine(chain[i]),status:'neutral'});return out;}

function diffStatusMaps(a,b,keys,fuzzy=.64){
  const sa=new Map(),sb=new Map();
  function markSub(n,map,status){for(const x of walk(n))map.set(x.id,status);}
  function rec(x,y){
    let modified=x.tag!==y.tag||x.text!==y.text||JSON.stringify(x.attrs)!==JSON.stringify(y.attrs);if(modified){sa.set(x.id,'modified');sb.set(y.id,'modified');}
    const mm=matchChildren(x.children,y.children,keys,fuzzy);for(const i of mm.removed)markSub(x.children[i],sa,'removed');for(const j of mm.added)markSub(y.children[j],sb,'added');for(const m of mm.matches)rec(x.children[m.ai],y.children[m.bi]);
  }
  if(a.tag!==b.tag){markSub(a,sa,'removed');markSub(b,sb,'added');}else rec(a,b);return[sa,sb];
}
function xyTreeLines(a,b,keys,fuzzy=.64){const [sa,sb]=diffStatusMaps(a,b,keys,fuzzy);const ca=ancestorChain(a,4),cb=ancestorChain(b,4),la=[],lb=[];let d=0;for(const n of ca)la.push({depth:d++,text:openLine(n),status:'neutral'});d=0;for(const n of cb)lb.push({depth:d++,text:openLine(n),status:'neutral'});pushSubtreeLines(a,la,ca.length,sa,'neutral',3500,false);pushSubtreeLines(b,lb,cb.length,sb,'neutral',3500,false);for(let i=ca.length-1;i>=0;i--)la.push({depth:i,text:closeLine(ca[i]),status:'neutral'});for(let i=cb.length-1;i>=0;i--)lb.push({depth:i,text:closeLine(cb[i]),status:'neutral'});return[la,lb];}

function attrsComparison(a,b){const keys=new Set([...Object.keys(a.attrs),...Object.keys(b.attrs)]),out=[];for(const k of [...keys].sort()){const av=Object.hasOwn(a.attrs,k)?a.attrs[k]:undefined,bv=Object.hasOwn(b.attrs,k)?b.attrs[k]:undefined;let status='same';if(av===undefined)status='added';else if(bv===undefined)status='removed';else if(normalizeWs(av)!==normalizeWs(bv))status='modified';out.push({name:localName(k),status,old:av,new:bv});}return out;}
function directLogicFindings(a,b){const out=[];for(const row of attrsComparison(a,b)){if(row.status==='same')continue;const lc=logicChange(row.name,row.old??'',row.new??'');if(lc.possible)out.push({scope:'@'+row.name,reason:lc.reason,severity:lc.severity});}if(a.text!==b.text){const lc=logicChange(a.tag,a.text,b.text);if(lc.possible)out.push({scope:localName(a.tag),reason:lc.reason,severity:lc.severity});}return out;}

export class ComparatorEngine {
  constructor(){this.docs={};this.keys=null;this.diff=null;this.fuzzyThreshold=.64;}
  load(side,name,xmlText){const doc=parseXmlString(xmlText,side);doc.name=name;this.docs[side]=doc;if(this.docs.A&&this.docs.B)this.recompare();else{this.diff=null;this.keys=null;}return this.state();}
  recompare(){this.keys=inferKeyStats(this.docs.A.root,this.docs.B.root);this.diff=createDiffState();compareNodes(this.docs.A.root,this.docs.B.root,this.keys,this.diff,this.fuzzyThreshold);return this.state();}
  state(){const docs={};for(const side of ['A','B'])if(this.docs[side]){const d=this.docs[side];docs[side]={name:d.name,node_count:d.nodeCount,max_depth:d.maxDepth};}return{docs,ready:!!this.diff,summary:this.diff?this.summary():null};}
  summary(){const counts={};for(const c of this.diff.changes)counts[c.type]=(counts[c.type]||0)+1;const modifiedNodes=new Set();for(const c of this.diff.changes)if(['attribute_added','attribute_removed','attribute_modified','text_modified'].includes(c.type))modifiedNodes.add((c.newNode||c.oldNode)?.id);const directLogic=this.diff.changes.filter(c=>c.possibleLogic&&c.type!=='node_moved').length;return{added_subtree_events:counts.node_added||0,removed_subtree_events:counts.node_removed||0,added_nodes_inside_subtrees:this.diff.addedNodesTotal,removed_nodes_inside_subtrees:this.diff.removedNodesTotal,modified_element_count:modifiedNodes.size,moved_element_count:counts.node_moved||0,direct_logic_change_count:directLogic,total_change_records:this.diff.changes.length};}
  changes({categories=['added','removed','modified','moved'],query='',logicOnly=false,severity='',offset=0,limit=80}={}){if(!this.diff)return{items:[],total:0};const cats=new Set(categories),q=query.toLowerCase().trim(),all=[];for(const c of this.diff.changes){const cat=changeCategory(c);if(!cats.has(cat)||logicOnly&&!c.possibleLogic||severity&&c.severity!==severity)continue;if(q){const hay=[c.type,c.reason,c.pathOld,c.pathNew,c.data?.attribute,c.data?.old,c.data?.new].filter(Boolean).join(' ').toLowerCase();if(!hay.includes(q))continue;}all.push(c);}return{total:all.length,items:all.slice(offset,offset+limit).map(c=>this.listItem(c))};}
  listItem(c){const n=c.newNode||c.oldNode;return{id:c.id,category:changeCategory(c),label:LABELS[c.type]||c.type,reason_label:REASONS[c.reason]||c.reason,severity:c.severity,possible_logic:c.possibleLogic,node_label:n?`<${localName(n.tag)}>`:'XML',attribute:c.data?.attribute,subtree_node_count:c.data?.subtree_node_count,path_old:c.pathOld,path_new:c.pathNew};}
  detail(id){const c=this.diff?.changes[id];if(!c)throw new Error('Cambio no encontrado.');const cat=changeCategory(c);return{...this.listItem(c),data:c.data,old_tree:c.type==='node_added'?[]:contextTreeLines(c.oldNode,cat==='removed'?'removed':cat==='moved'?'moved':'modified',5,c.type==='node_removed'),new_tree:c.type==='node_removed'?[]:contextTreeLines(c.newNode,cat==='added'?'added':cat==='moved'?'moved':'modified',5,c.type==='node_added')};}
  search(side,q='',limit=80){const d=this.docs[side];if(!d)return[];q=q.toLowerCase().trim();return d.searchRows.filter(r=>!q||r.search.includes(q)).slice(0,limit).map(({search,...rest})=>rest);}
  manualCompare(aId,bId,deep=true){if(!this.keys)throw new Error('Carga ambos archivos primero.');const a=this.docs.A.nodes.get(aId),b=this.docs.B.nodes.get(bId);if(!a||!b)throw new Error('Nodo X o Y no encontrado.');const [ta,tb]=xyTreeLines(a,b,this.keys,this.fuzzyThreshold);const result={similarity:nodeSimilarity(a,b,this.keys),attributes:attrsComparison(a,b),logic_findings:directLogicFindings(a,b),structure:{a:{children:a.children.length,subtree_nodes:a.subtreeSize,depth:a.subtreeDepth},b:{children:b.children.length,subtree_nodes:b.subtreeSize,depth:b.subtreeDepth}},tree_a:ta,tree_b:tb};if(deep){const st=createDiffState();if(a.tag===b.tag)compareNodes(a,b,this.keys,st,this.fuzzyThreshold);else{st.add({type:'node_removed',pathOld:rawPath(a),pathNew:null,severity:'medium',possibleLogic:subtreeHasControlSignal(a),reason:'node_or_subtree_removed',data:{subtree_node_count:a.subtreeSize},oldNode:a});st.add({type:'node_added',pathOld:null,pathNew:rawPath(b),severity:'medium',possibleLogic:subtreeHasControlSignal(b),reason:'node_or_subtree_added',data:{subtree_node_count:b.subtreeSize},newNode:b});}const tmp=this.diff;this.diff=st;result.deep_summary=this.summary();this.diff=tmp;}return result;}
}
