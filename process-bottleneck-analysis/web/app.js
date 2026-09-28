'use strict';
const $ = id => document.getElementById(id);
const num = v => v == null ? '자료 없음' : v.toLocaleString('ko-KR', {maximumFractionDigits: 2});
const day = v => `${num(v)}일`;
let data;
let caseRequest = 0;
const labels = {'Create Purchase Order Item':'구매 항목 생성','Record Goods Receipt':'입고 기록','Record Invoice Receipt':'송장 접수 기록','Clear Invoice':'지급 기록','Vendor creates invoice':'공급업체 송장 생성','Remove Payment Block':'지급 보류 해제','Change Price':'가격 변경'};
const title = activity => labels[activity] || activity;
function node(tag, text, cls) { const e = document.createElement(tag); if(text !== undefined) e.textContent = text; if(cls)e.className=cls; return e; }
async function fetchJSON(url) { const response = await fetch(url); const value = await response.json(); if(!response.ok)throw new Error(value.error || '데이터 요청 실패'); return value; }
function error(e) { $('error').hidden=false; $('error').textContent=`불러오지 못했습니다: ${e.message}`; }
function renderEdges() {
  const filter=$('filter').value.trim().toLowerCase();
  const found=data.edges.filter(e => `${e.source} ${e.target} ${title(e.source)} ${title(e.target)}`.toLowerCase().includes(filter));
  $('edges').replaceChildren();
  for(const edge of found.slice(0,20)) {
    const row=node('tr'); const route=node('td', `${title(edge.source)} → ${title(edge.target)}`, 'route');
    route.append(node('small',`${edge.source} → ${edge.target}`)); row.append(route,node('td',num(edge.case_count)),node('td',day(edge.median_days)),node('td',num(edge.total_case_days)));
    const cell=node('td');const button=node('button','사례 보기');button.addEventListener('click',()=>selectEdge(edge));cell.append(button);row.append(cell);$('edges').append(row);
  }
  $('table-info').textContent=`일치하는 ${num(found.length)}개 구간 중 최대 20개 표시 · 동일 사례에서 구간이 반복될 수 있습니다.`;
}
async function selectCase(id,button) {
  const request = ++caseRequest;
  $('error').hidden=true;
  $('error').textContent='';
  $('case-title').textContent=`사례 ${id} 불러오는 중…`;
  $('timeline').replaceChildren();
  document.querySelectorAll('.case-buttons button').forEach(b=>b.classList.remove('active'));
  button.classList.add('active');
  try {
    const c=await fetchJSON(`/api/case?id=${encodeURIComponent(id)}`);
    // An earlier request must not overwrite a later selection.
    if(request !== caseRequest)return;
    $('case-title').textContent=`사례 ${c.case_id} · ${c.event_count}개 이벤트`;
    $('timeline').replaceChildren();
    document.querySelectorAll('.case-buttons button').forEach(b=>b.classList.remove('active'));button.classList.add('active');
    for(const e of c.events) {
      const li=node('li',title(e.activity));li.append(node('time',e.utc.replace('T',' ').replace('+00:00',' UTC')),node('span',`직전 이벤트 이후 ${day(e.elapsed_days)}`,'gap'));$('timeline').append(li);
    }
  }catch(e){
    if(request !== caseRequest)return;
    $('case-title').textContent=`사례 ${id}를 불러오지 못했습니다. 다시 선택해 주세요.`;
    error(e);
  }
}
function selectEdge(edge) {
  ++caseRequest;
  $('case-title').textContent='';
  $('edge-title').textContent=`${title(edge.source)} → ${title(edge.target)} · 경과시간이 긴 근거 사례 최대 5건`;
  $('evidence-buttons').replaceChildren();$('timeline').replaceChildren();
  for(const ref of edge.evidence) {
    const b=node('button',`${ref.case_id} · ${day(ref.elapsed_days)}`);
    b.addEventListener('click',()=>{$('case-title').dataset.requested=ref.case_id;selectCase(ref.case_id,b);});$('evidence-buttons').append(b);
  }
  const first=$('evidence-buttons').firstElementChild;if(first)first.click();
}
function renderScenario() {
  const s=data.scenarios[Number($('reduction').value)];
  if(!s){$('scenario-effect').textContent='충분한 사례 수를 가진 개선 후보가 없습니다.';return;}
  $('before').textContent=day(s.baseline.median_days);$('after').textContent=day(s.counterfactual.median_days);
  $('scenario-effect').textContent=`선택 구간이 있는 ${num(s.affected_cases)}건에 가정 적용 · 전체 코호트 중앙값 차이 ${day(s.median_reduction_days)}`;
}
async function init() {
  try {
    data=await fetchJSON('/api/summary');
    $('category').textContent=data.category;
    $('scope').textContent=`전체 ${num(data.source_cases)}개 항목 / ${num(data.source_events)}개 이벤트에서 해당 유형 ${num(data.category_cases)}건을 분리했습니다.`;
    $('cases').textContent=`${num(data.eligible_cases)}건`;$('median').textContent=day(data.cycle.median_days);$('p90').textContent=day(data.cycle.p90_days);$('change').textContent=`${num(data.price_change_rate*100)}%`;
    const variant=data.top_variants[0];
    $('variant-count').textContent=`총 ${num(data.variant_count)}개 경로 · 대표 경로 ${num(variant.cases)}건`;
    variant.activities.forEach((a,i)=>{if(i)$('flow').append(node('span','→','flow-arrow'));const n=node('div',title(a),'step');n.title=a;$('flow').append(n);});
    renderEdges();$('filter').addEventListener('input',renderEdges);
    if(data.edges.length)selectEdge(data.edges[0]);
    if(data.scenario_target)$('scenario-target').textContent=`${title(data.scenario_target.source)} → ${title(data.scenario_target.target)} · 30개 이상 사례에서 나타난 구간 중 누적 경과시간 최대`;
    renderScenario();$('reduction').addEventListener('change',renderScenario);
    $('excluded').textContent=`해당 유형 ${num(data.category_cases)}건 중 ${num(data.excluded_cases)}건 제외. 아래 조건은 한 사례에 여러 개 적용될 수 있어 합계가 제외 사례 수보다 클 수 있습니다.`;
    Object.entries(data.exclusion_groups_nonexclusive).sort((a,b)=>b[1]-a[1]).forEach(([reason,n])=>{const row=node('tr');row.append(node('td',reason),node('td',num(n)));$('exclusions').append(row);});
    data.limits.forEach(l=>$('limits').append(node('li',l)));
    $('hash').textContent=`원본 SHA-256: ${data.source_sha256}`;$('generated').textContent=`분석 시각: ${data.created_utc}`;
    const verification=await fetchJSON('/api/verification');
    const current=Date.parse(verification.created_utc)>=Date.parse(data.created_utc);
    $('verification').textContent=verification.passed&&current?`독립 검증 통과 · ${Object.keys(verification.checks).length}개 검사 / 근거 전이 ${num(verification.evidence_pairs_checked)}개 대조`:'검증 결과가 실패했거나 분석보다 오래되었습니다. 보고서를 확인하세요.';
  }catch(e){error(e);}
}
init();
