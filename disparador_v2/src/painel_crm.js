/* painel_crm.js — telas de CRM do painel: Clínica, Preços, Promoções, Calendário, Mensagens.
 * Usa $, post, dh, txt, esc, agendarPrevia, atualizarMensagem do painel.html. Sem innerHTML com dados do usuário. */
'use strict';
let CRM = null, anoCRM = new Date().getFullYear();
const brl = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

function el(tag, props, ...filhos) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (k === 'class') e.className = v; else if (k === 'text') e.textContent = v;
    else if (k.startsWith('on')) e[k] = v; else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const f of filhos.flat()) if (f != null) e.append(f.nodeType ? f : document.createTextNode(String(f)));
  return e;
}
function campo(rotulo, input, dica) { return el('label', { class: 'sm', style: 'display:block;margin:6px 0' }, rotulo + ' ', input, dica ? el('div', { class: 'sm', text: dica }) : null); }
function inp(valor, props = {}) { const i = el('input', { type: 'text', size: 28, ...props }); i.value = valor == null ? '' : valor; return i; }
function sel(opcoes, valor, props = {}) { const s = el('select', props); for (const [v, t] of opcoes) s.append(el('option', { value: v, text: t })); s.value = valor == null ? '' : valor; return s; }
function aviso(texto, nivel = 'info') { return el('div', { class: 'acao ' + nivel }, el('span', { text: texto })); }
async function msgSalvo(el_, r) { el_.textContent = r.erro ? '❌ ' + r.erro : '✅ Salvo'; el_.className = 'sm ' + (r.erro ? 'e' : 'on'); setTimeout(() => { el_.textContent = ''; }, 4000); }

const AVISO_CFO = 'Atenção (CFO/CRO): o Código de Ética Odontológica restringe divulgar preços, descontos, serviços gratuitos e condições de pagamento em publicidade. O sistema deixa você usar, mas pede confirmação. Em caso de dúvida, consulte o seu CRO.';

async function carregarCRM() {
  try { CRM = await (await fetch('/api/crm?ano=' + anoCRM, { cache: 'no-store' })).json(); } catch { return; }
  preencherNovaCampanha();
}
window.carregarCRM = carregarCRM;

// ── Nova campanha: modelo / unidade / promoção ───────────────────────────────
function preencherNovaCampanha() {
  if (!CRM) return;
  const m = $('#cmod'), u = $('#cuni'), p = $('#cpro'), c = $('#cprc');
  const manter = [m.value, u.value, p.value, c.value];
  m.textContent = ''; m.append(el('option', { value: '', text: '— começar do zero —' }));
  const cats = {}; for (const x of CRM.modelos) (cats[x.categoria] = cats[x.categoria] || []).push(x);
  for (const [cat, lista] of Object.entries(cats)) { const g = el('optgroup', { label: cat }); for (const x of lista) g.append(el('option', { value: x.id, text: x.nome })); m.append(g); }
  u.textContent = ''; u.append(el('option', { value: 'auto', text: 'Automática (pela cidade/DDD do contato)' }));
  for (const x of CRM.clinica.unidades) u.append(el('option', { value: x.id, text: `${x.cidade}/${x.uf}` }));
  p.textContent = ''; p.append(el('option', { value: '', text: 'nenhuma' }));
  for (const x of CRM.promocoes.itens) p.append(el('option', { value: x.id, text: x.titulo }));
  c.textContent = ''; c.append(el('option', { value: '', text: 'nenhum' }));
  for (const x of CRM.precos.procedimentos) c.append(el('option', { value: x.id, text: x.nome }));
  m.value = manter[0]; u.value = manter[1] || 'auto'; p.value = manter[2]; c.value = manter[3];
}
window.ctxCampanha = () => ({ unidadeId: $('#cuni').value || 'auto', promocaoId: $('#cpro').value, procedimentoId: $('#cprc').value });
window.mostrarAvisos = r => {
  const box = $('#cavisos'); box.textContent = '';
  for (const a of r.avisos || []) box.append(aviso(a, 'media'));
  const cf = $('#ccfobox');
  cf.style.display = r.exigeConfirmacaoCFO ? '' : 'none';
  if (r.exigeConfirmacaoCFO) $('#ccfotxt').textContent = ` Esta mensagem ${r.motivosCFO.join('; ')}. ${AVISO_CFO}`;
  else $('#ccfo').checked = false;
};
document.addEventListener('change', ev => {
  const id = ev.target && ev.target.id;
  if (id === 'cmod') {
    const mod = CRM && CRM.modelos.find(x => x.id === ev.target.value);
    if (mod) { $('#cmsg').value = mod.texto; if (!$('#cnome').value) $('#cnome').value = mod.nome; atualizarMensagem(); }
    agendarPrevia();
  } else if (['cuni', 'cpro', 'cprc'].includes(id)) agendarPrevia();
});

// ── Clínica ──────────────────────────────────────────────────────────────────
function telaClinica() {
  const c = CRM.clinica, box = $('#cli-box'); box.textContent = '';
  const f = { nome: inp(c.nome), assinatura: inp(c.assinatura), instagram: inp(c.instagram, { placeholder: '@seuperfil ou link' }), sair: inp(c.sair, { size: 50 }),
    ant: inp(c.antecedenciaDias, { type: 'number', size: 4, style: 'width:70px' }), hora: inp(c.horaPadrao, { type: 'time' }) };
  const un = el('div');
  const unidades = c.unidades.map(u => ({ ...u }));
  function desenharUnidades() {
    un.textContent = '';
    unidades.forEach((u, i) => {
      const ref = { cidade: inp(u.cidade, { size: 18 }), uf: inp(u.uf, { size: 2, maxlength: 2 }), endereco: inp(u.endereco, { size: 40 }), maps: inp(u.maps, { size: 40, placeholder: 'https://maps.app.goo.gl/…' }),
        avaliacao: inp(u.avaliacao, { size: 40, placeholder: 'link para avaliar no Google' }), ddds: inp((u.ddds || []).join(', '), { size: 12, placeholder: '46, 49' }) };
      u._ref = ref;
      un.append(el('div', { class: 'camp' },
        el('div', { class: 'row' }, campo('Cidade', ref.cidade), campo('UF', ref.uf), campo('DDDs que atende', ref.ddds, 'Contatos com estes DDDs recebem os dados desta unidade')),
        campo('Endereço', ref.endereco), campo('Link do Google Maps', ref.maps, 'No Google Maps: Compartilhar › Copiar link'),
        campo('Link para avaliação no Google', ref.avaliacao, 'No Google Meu Negócio: "Pedir avaliações" › copiar link'),
        el('button', { type: 'button', class: 'd', text: 'Remover unidade', onclick: () => { if (unidades.length > 1) { unidades.splice(i, 1); desenharUnidades(); } else alert('Mantenha ao menos uma unidade.'); } })));
    });
  }
  desenharUnidades();
  const st = el('span', { class: 'sm' });
  box.append(
    el('div', { class: 'card' }, el('h2', { text: 'Dados da clínica' }),
      campo('Nome da clínica', f.nome), campo('Assinatura das mensagens', f.assinatura, 'Ex.: Dra. Daiana Ferraz'), campo('Instagram', f.instagram, 'Pode digitar só @perfil'),
      campo('Texto para quem não quer receber', f.sair, 'Vai no rodapé das mensagens. Quem responder SAIR deve ir para a blacklist.'),
      el('div', { class: 'row' }, campo('Enviar promoções quantos dias antes da data', f.ant), campo('Horário padrão dos envios', f.hora))),
    el('div', { class: 'card' }, el('h2', { text: 'Unidades (cidades)' }), un,
      el('button', { type: 'button', text: '+ Adicionar unidade', onclick: () => { unidades.push({ cidade: '', uf: '', endereco: '', maps: '', avaliacao: '', ddds: [] }); desenharUnidades(); } })),
    el('div', { class: 'card' }, el('h2', { text: 'Meus números de WhatsApp (zaps)' }),
      el('p', { class: 'sm', style: 'margin-top:0', text: 'Para informar ou trocar o seu WhatsApp: aba Operação › Zaps › "Conectar (QR)" e leia o código com o celular daquele número. O número aparece sozinho depois de conectado.' }),
      el('button', { type: 'button', text: 'Ir para Operação', onclick: () => document.querySelector('#tabs button[data-t=op]').click() })),
    el('div', { class: 'row' }, el('button', { class: 'p', type: 'button', text: 'Salvar dados da clínica', onclick: async () => {
      const dados = { nome: f.nome.value, assinatura: f.assinatura.value, instagram: f.instagram.value, sair: f.sair.value, antecedenciaDias: f.ant.value, horaPadrao: f.hora.value,
        unidades: unidades.map(u => ({ id: u.id, cidade: u._ref.cidade.value, uf: u._ref.uf.value, endereco: u._ref.endereco.value, maps: u._ref.maps.value, avaliacao: u._ref.avaliacao.value, ddds: u._ref.ddds.value })) };
      const r = await post('/api/crm/salvar', { tipo: 'clinica', dados }); await msgSalvo(st, r); await carregarCRM(); telaClinica();
    } }), st));
}

// ── Preços ───────────────────────────────────────────────────────────────────
function telaPrecos() {
  const box = $('#pre-box'); box.textContent = '';
  const linhas = CRM.precos.procedimentos.map(p => ({ ...p })), tb = el('table', { class: 't' }), st = el('span', { class: 'sm' });
  function desenhar() {
    tb.textContent = '';
    const h = tb.insertRow(); for (const x of ['Procedimento', 'Categoria', 'Preço (R$)', '']) h.append(el('th', { text: x }));
    linhas.forEach((p, i) => {
      const tr = tb.insertRow();
      p._n = inp(p.nome, { size: 30 }); p._c = inp(p.categoria, { size: 20 }); p._p = inp(String(p.preco).replace('.', ','), { size: 9, inputmode: 'decimal' });
      tr.insertCell().append(p._n); tr.insertCell().append(p._c); tr.insertCell().append(p._p);
      tr.insertCell().append(el('button', { type: 'button', text: '✕', title: 'Remover', onclick: () => { linhas.splice(i, 1); desenhar(); } }));
    });
  }
  desenhar();
  box.append(el('div', { class: 'card' }, el('h2', { text: 'Tabela de preços' }),
    el('p', { class: 'sm', style: 'margin-top:0', text: 'Cadastre os procedimentos e os valores. As promoções calculam o preço com desconto a partir daqui. Preço 0 = ainda não informado. ' + AVISO_CFO }),
    tb, el('div', { class: 'row', style: 'margin-top:10px' },
      el('button', { type: 'button', text: '+ Adicionar procedimento', onclick: () => { linhas.push({ nome: '', categoria: '', preco: 0 }); desenhar(); } }),
      el('button', { class: 'p', type: 'button', text: 'Salvar tabela de preços', onclick: async () => {
        const dados = { procedimentos: linhas.map(p => ({ id: p.id, nome: p._n.value, categoria: p._c.value, preco: p._p.value })) };
        const r = await post('/api/crm/salvar', { tipo: 'precos', dados }); await msgSalvo(st, r); await carregarCRM(); telaPrecos();
      } }), st)));
}

// ── Promoções ────────────────────────────────────────────────────────────────
function opsPeriodos() { const o = [['', 'sem período']]; for (let a = anoCRM - 1; a <= anoCRM + 1; a++) for (let t = 1; t <= 4; t++) o.push([`${a}-T${t}`, `${t}º trimestre ${a}`]); return o; }
function telaPromocoes() {
  const box = $('#pro-box'); box.textContent = '';
  const promos = CRM.promocoes.itens.map(p => ({ ...p, itens: p.itens.map(i => ({ ...i })) })), lista = el('div'), st = el('span', { class: 'sm' });
  const procs = CRM.precos.procedimentos;
  function previaItem(i) {
    const p = procs.find(x => x.id === i.procId); if (!p) return '';
    const v = Number(String(i.valor).replace(',', '.')) || 0;
    const promo = i.tipo === 'valor' ? v : p.preco * (1 - v / 100);
    return p.preco > 0 ? `${brl(p.preco)} → ${brl(promo)}` : 'cadastre o preço na aba Preços';
  }
  function desenhar() {
    lista.textContent = '';
    promos.forEach((p, pi) => {
      p._t = inp(p.titulo, { size: 34, placeholder: 'ex.: Semana do Sorriso' }); p._per = sel(opsPeriodos(), p.periodo); p._val = inp(p.validadeAte, { type: 'date' }); p._cond = inp(p.condicoes, { size: 50, placeholder: 'ex.: Válido para novos pacientes' });
      const its = el('div');
      p.itens.forEach((i, ii) => {
        const prev = el('span', { class: 'sm', text: previaItem(i) });
        const s = sel(procs.map(x => [x.id, x.nome]), i.procId), t = sel([['percent', '% de desconto'], ['valor', 'preço promocional (R$)']], i.tipo), v = inp(String(i.valor).replace('.', ','), { size: 7, inputmode: 'decimal' });
        const upd = () => { i.procId = s.value; i.tipo = t.value; i.valor = v.value; prev.textContent = previaItem(i); };
        s.onchange = t.onchange = upd; v.oninput = upd;
        its.append(el('div', { class: 'row', style: 'margin:4px 0' }, s, t, v, prev, el('button', { type: 'button', text: '✕', onclick: () => { p.itens.splice(ii, 1); desenhar(); } })));
      });
      lista.append(el('div', { class: 'camp' },
        el('div', { class: 'row' }, campo('Título', p._t), campo('Período', p._per), campo('Válido até', p._val)),
        campo('Condições (opcional)', p._cond), its,
        el('div', { class: 'row' }, el('button', { type: 'button', text: '+ Procedimento', onclick: () => { if (procs.length) { p.itens.push({ procId: procs[0].id, tipo: 'percent', valor: 10 }); desenhar(); } else alert('Cadastre procedimentos na aba Preços.'); } }),
          el('button', { type: 'button', class: 'd', text: 'Excluir promoção', onclick: () => { if (confirm('Excluir esta promoção?')) { promos.splice(pi, 1); desenhar(); } } }))));
    });
    if (!promos.length) lista.append(el('p', { class: 'sm', text: 'Nenhuma promoção cadastrada. Clique em "+ Nova promoção".' }));
  }
  desenhar();
  box.append(el('div', { class: 'card' }, el('h2', { text: 'Promoções por período' }),
    el('p', { class: 'sm', style: 'margin-top:0', text: 'Crie as promoções de cada trimestre (3 meses). Depois escolha a promoção em cada ação do Calendário ou na Nova campanha. ' + AVISO_CFO }),
    lista, el('div', { class: 'row' }, el('button', { type: 'button', text: '+ Nova promoção', onclick: () => { promos.push({ titulo: '', periodo: `${anoCRM}-T${Math.floor(new Date().getMonth() / 3) + 1}`, validadeAte: '', condicoes: '', itens: [] }); desenhar(); } }),
      el('button', { class: 'p', type: 'button', text: 'Salvar promoções', onclick: async () => {
        const dados = { itens: promos.map(p => ({ id: p.id, titulo: p._t.value, periodo: p._per.value, validadeAte: p._val.value, condicoes: p._cond.value, itens: p.itens })) };
        const r = await post('/api/crm/salvar', { tipo: 'promocoes', dados }); await msgSalvo(st, r); await carregarCRM(); telaPromocoes();
      } }), st)));
}

// ── Calendário (plano trimestral) ────────────────────────────────────────────
const stAcao = { sugerida: ['sugerida', 'w'], agendada: ['agendada', 'on'], enviando: ['enviando…', 'on'], enviada: ['enviada', 'on'], cancelada: ['cancelada', 'off'], erro: ['erro', 'e'] };
function telaCalendario() {
  const box = $('#cal-box'); box.textContent = '';
  const ano = sel([[anoCRM - 1, anoCRM - 1], [anoCRM, anoCRM], [anoCRM + 1, anoCRM + 1]], anoCRM);
  ano.onchange = async () => { anoCRM = Number(ano.value); await carregarCRM(); telaCalendario(); };
  box.append(el('div', { class: 'card' }, el('div', { class: 'row' }, el('h2', { style: 'margin:0', text: 'Calendário de campanhas' }), campo('Ano', ano)),
    el('p', { class: 'sm', text: 'Cada trimestre tem as datas comemorativas. "Montar plano" cria uma sugestão de envio para cada data (alguns dias antes). Escolha o modelo, a promoção e a unidade e clique em Aprovar: o envio é feito sozinho no dia e hora marcados, com o painel aberto. Quem já recebeu mensagem no mês não recebe outra (regra de proteção do número).' })));
  for (const tri of CRM.trimestres) {
    const acoes = CRM.plano.acoes.filter(a => a.periodo === tri.id).sort((a, b) => a.enviarEm.localeCompare(b.enviarEm));
    const card = el('div', { class: 'card' }, el('div', { class: 'row', style: 'justify-content:space-between' }, el('h2', { style: 'margin:0', text: tri.nome }),
      el('button', { type: 'button', text: acoes.length ? 'Atualizar plano' : 'Montar plano do trimestre', class: acoes.length ? '' : 'p', onclick: async () => { await post('/api/crm/gerar-plano', { ano: anoCRM, t: tri.t }); await carregarCRM(); telaCalendario(); } })));
    if (!acoes.length) card.append(el('p', { class: 'sm', text: 'Datas: ' + tri.datas.map(d => `${d.nome} (${d.dataEvento.split('-').reverse().slice(0, 2).join('/')})`).join(' · ') }));
    const meses = {}; for (const a of acoes) { const m = a.enviarEm.slice(0, 7); meses[m] = (meses[m] || 0) + 1; }
    if (Object.values(meses).some(n => n > 1)) card.append(aviso('Há mais de uma ação no mesmo mês. Como cada pessoa recebe no máximo 1 mensagem por mês, a segunda ação só alcança quem ainda não recebeu.', 'media'));
    for (const [idx, a] of acoes.entries()) {
      const proxima = acoes.slice(idx + 1).find(x => !['cancelada', 'enviada'].includes(x.status));
      const [rot, cl] = stAcao[a.status] || [a.status, ''];
      const bloqueada = ['agendada', 'enviando', 'enviada'].includes(a.status);
      const mod = sel(CRM.modelos.map(m => [m.id, `${m.categoria} · ${m.nome}`]), a.modeloId, { disabled: bloqueada });
      const pro = sel([['', 'sem promoção'], ...CRM.promocoes.itens.map(p => [p.id, p.titulo])], a.promocaoId, { disabled: bloqueada });
      const uni = sel([['auto', 'Automática (por DDD)'], ...CRM.clinica.unidades.map(u => [u.id, u.cidade])], a.unidadeId, { disabled: bloqueada });
      const quando = inp(a.enviarEm, { type: 'datetime-local', disabled: bloqueada });
      const cfo = el('input', { type: 'checkbox' });
      const salvar = patch => post('/api/crm/acao', { id: a.id, patch });
      mod.onchange = () => salvar({ modeloId: mod.value }); pro.onchange = () => salvar({ promocaoId: pro.value });
      uni.onchange = () => salvar({ unidadeId: uni.value }); quando.onchange = () => salvar({ enviarEm: quando.value });
      const e = (CRM.estimativas || {})[a.id];
      const botoes = el('div', { class: 'row', style: 'margin-top:6px' });
      if (!bloqueada && a.status !== 'cancelada') botoes.append(el('button', { class: 'p', type: 'button', text: 'Aprovar e agendar', onclick: async () => {
        const r = await post('/api/crm/acao/aprovar', { id: a.id, confirmoCFO: cfo.checked });
        if (r.erro) { alert(r.erro + (/CFO/.test(r.erro) ? '\n\nMarque "Conferi as regras do CFO/CRO" ao lado do botão.' : '')); return; }
        await carregarCRM(); telaCalendario();
      } }), el('label', { class: 'sm' }, cfo, ' Conferi as regras do CFO/CRO (necessário se usar preço/desconto)'));
      if (a.status === 'agendada' || a.status === 'sugerida') botoes.append(el('button', { type: 'button', class: 'd', text: a.status === 'agendada' ? 'Cancelar agendamento' : 'Descartar', onclick: async () => { await post('/api/crm/acao/cancelar', { id: a.id }); await carregarCRM(); telaCalendario(); } }));
      card.append(el('div', { class: 'camp' }, el('div', { class: 'row', style: 'justify-content:space-between' }, el('b', { text: `${a.nome} — ${a.dataEvento.split('-').reverse().join('/')}` }), el('span', { class: 'pill ' + cl, text: rot })),
        a.atrasada && a.status === 'sugerida' ? el('div', { class: 'sm w', text: 'Esta data já passou.' }) : null,
        e ? el('div', { class: 'sm', text: `📦 Público estimado: ${e.total} contato(s) → ${e.lotes} lote(s) diário(s) de até ${e.porLote} (${e.zapsAtivos} zaps × ${e.porZap}). Término em ~${e.lotes} dia(s) após o início.` }) : null,
        (e && proxima && e.lotes > 1 && new Date(a.enviarEm).getTime() + (e.lotes - 1) * 86400000 > new Date(proxima.enviarEm).getTime()) ? el('div', { class: 'sm w', text: `⚠️ Esta campanha vai durar mais que o intervalo até "${proxima.nome}". A próxima só começa quando esta terminar (um envio por vez).` }) : null,
        el('div', { class: 'row' }, campo('Enviar em', quando), campo('Modelo', mod), campo('Promoção', pro), campo('Unidade', uni)), botoes));
    }
    box.append(card);
  }
}

// ── Mensagens (biblioteca de modelos) ────────────────────────────────────────
let modeloSel = null;
function telaMensagens() {
  const box = $('#msg-box'); box.textContent = '';
  const modelos = CRM.modelos.map(m => ({ ...m })), st = el('span', { class: 'sm' });
  if (!modeloSel || !modelos.some(m => m.id === modeloSel)) modeloSel = modelos[0] && modelos[0].id;
  const lista = el('div'), editor = el('div');
  const cats = {}; for (const m of modelos) (cats[m.categoria] = cats[m.categoria] || []).push(m);
  for (const [cat, ms] of Object.entries(cats)) {
    lista.append(el('div', { class: 'sm', style: 'margin-top:8px;font-weight:600', text: cat }));
    for (const m of ms) lista.append(el('button', { type: 'button', class: 'chip' + (m.id === modeloSel ? ' sel' : ''), style: 'display:block;margin:3px 0;text-align:left;width:100%', text: m.nome, onclick: () => { modeloSel = m.id; telaMensagens(); } }));
  }
  const m = modelos.find(x => x.id === modeloSel);
  if (m) {
    const nome = inp(m.nome, { size: 36 }), cat = inp(m.categoria, { size: 22 }), ta = el('textarea', { rows: 14 }); ta.value = m.texto;
    const prev = el('div', { class: 'bolha' });
    const ex = { nome: 'Maria', nome_completo: 'Maria Silva', saudacao: 'Bom dia', data: new Date().toLocaleDateString('pt-BR'), clinica: CRM.clinica.nome, assinatura: CRM.clinica.assinatura, sair: CRM.clinica.sair, instagram: CRM.clinica.instagram,
      cidade: CRM.clinica.unidades[0].cidade, uf: CRM.clinica.unidades[0].uf, endereco: CRM.clinica.unidades[0].endereco || CRM.clinica.unidades[0].cidade, maps: CRM.clinica.unidades[0].maps, avaliacao: CRM.clinica.unidades[0].avaliacao,
      procedimento: 'Clareamento dental', promocao: '(promoção escolhida)', lista_promocoes: '🎁 (lista de promoções escolhida)', validade: '31/12', desconto: '20%', preco: 'R$ 0,00', preco_promo: 'R$ 0,00', abertura: '' };
    const atual = () => { prev.innerHTML = zapHtml(ta.value.replace(/\{([a-z_]+)\}/gi, (x, k) => (ex[k.toLowerCase()] !== undefined ? ex[k.toLowerCase()] : x))); };
    ta.oninput = atual; atual();
    const chips = el('div', { class: 'row', style: 'margin:6px 0' }, el('span', { class: 'sm', text: 'Inserir variável:' }));
    for (const v of CRM.variaveis) chips.append(el('button', { type: 'button', class: 'chip', text: `{${v}}`, onclick: () => { ta.setRangeText(`{${v}}`, ta.selectionStart, ta.selectionEnd, 'end'); ta.focus(); atual(); } }));
    editor.append(campo('Nome do modelo', nome), campo('Categoria', cat), chips, ta,
      el('div', { class: 'sm', text: 'Use *negrito*, _itálico_. Variáveis entre chaves são trocadas por contato. As que citam preço/desconto pedem confirmação do CFO/CRO.' }),
      el('div', { class: 'sm', style: 'margin:8px 0 4px', text: 'Prévia' }), el('div', { class: 'chat' }, prev),
      el('div', { class: 'row', style: 'margin-top:10px' },
        el('button', { class: 'p', type: 'button', text: 'Salvar alterações', onclick: async () => { m.nome = nome.value; m.categoria = cat.value; m.texto = ta.value; await gravarModelos(modelos, st); } }),
        el('button', { type: 'button', text: 'Duplicar', onclick: async () => { const novo = { id: `${m.id}-copia`, nome: `${nome.value} (cópia)`, categoria: cat.value, texto: ta.value, padrao: false }; modelos.push(novo); modeloSel = novo.id; await gravarModelos(modelos, st); } }),
        !m.padrao ? el('button', { type: 'button', class: 'd', text: 'Excluir', onclick: async () => { if (confirm('Excluir este modelo?')) { await gravarModelos(modelos.filter(x => x.id !== m.id), st); } } }) : null, st));
  }
  box.append(el('div', { class: 'card' }, el('div', { class: 'row', style: 'justify-content:space-between' }, el('h2', { style: 'margin:0', text: 'Biblioteca de mensagens' }),
    el('div', { class: 'row' }, el('button', { type: 'button', text: '+ Novo modelo', onclick: async () => { modelos.push({ id: `novo-${Date.now().toString(36)}`, nome: 'Novo modelo', categoria: 'Outros', texto: '{saudacao}, {nome}! 😊\n\n{assinatura}\n{sair}' }); modeloSel = modelos[modelos.length - 1].id; await gravarModelos(modelos, st); } }),
      el('button', { type: 'button', text: 'Restaurar modelos padrão', onclick: async () => { if (confirm('Restaurar os modelos padrão que foram apagados? Suas edições nos padrões serão substituídas.')) { await post('/api/crm/restaurar-modelos'); await carregarCRM(); telaMensagens(); } } }))),
    el('div', { class: 'two', style: 'grid-template-columns:260px 1fr;margin-top:10px' }, lista, editor)));
}
async function gravarModelos(modelos, st) {
  const r = await post('/api/crm/salvar', { tipo: 'modelos', dados: modelos.map(({ id, categoria, nome, texto, padrao }) => ({ id, categoria, nome, texto, padrao })) });
  await msgSalvo(st, r); await carregarCRM(); telaMensagens();
}

window.abrirAbaCRM = async aba => {
  await carregarCRM(); if (!CRM) return;
  ({ cli: telaClinica, pre: telaPrecos, pro: telaPromocoes, cal: telaCalendario, msg: telaMensagens })[aba]();
};
