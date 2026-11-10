'use strict';
/**
 * campanhas.js — criar campanhas pelo painel: mensagem (formato WhatsApp), público e agendamento.
 *
 *  • Contatos: dados/entrada/contacts.csv (exportação do Google) + destinatários das listas já geradas.
 *  • Público: filtro (DDD, busca), seleção manual ou números colados. Blacklist, "já recebeu no mês" e
 *    números inválidos são removidos automaticamente.
 *  • Mensagem: variáveis {nome}, {nome_completo}, {saudacao}, {data}, renderizadas por contato.
 *  • Saída: dados/listas/lista_<campanha>_<SEG>_<AAAAMMDD>.csv — o mesmo formato que o sender.js já lê.
 *  • Agendamentos: config/agendamentos.json (executados pelo painel; ver painel.js).
 */
const fs   = require('fs');
const path = require('path');
const { parse } = require('csv-parse/sync');
const crm = require('./crm');
const core = require('./zap_core');

const DIR        = path.join(__dirname, '..');
const ENTRADA    = path.join(DIR, 'dados', 'entrada');
const LISTAS     = path.join(DIR, 'dados', 'listas');
const SENT_LOG   = path.join(DIR, 'logs', 'sent_log.json');
const AGENDA     = path.join(DIR, 'config', 'agendamentos.json');
const MAX_MSG    = 4000;

const pad2 = n => String(n).padStart(2, '0');
const soDigitos = s => String(s || '').replace(/\D/g, '');
const mesLocal = (d = new Date()) => `${d.getFullYear()}${pad2(d.getMonth() + 1)}`;

// ── Telefones e nomes ────────────────────────────────────────────────────────
/** Devolve DDD+número (10 ou 11 dígitos, sem 55) ou null se não for um celular/fixo brasileiro plausível. */
function normalizarFone(bruto) {
  let d = soDigitos(bruto);
  if (d.startsWith('55') && (d.length === 12 || d.length === 13)) d = d.slice(2);
  if (d.length !== 10 && d.length !== 11) return null;
  if (d[0] === '0' || d[1] === '0') return null;
  if (d.length === 11 && d[2] !== '9') return null;
  return d;
}

const MINUSCULAS = new Set(['de', 'da', 'do', 'das', 'dos', 'e']);
function limparNome(bruto) {
  let n = String(bruto || '').replace(/\s+/g, ' ').trim();
  if (!n || /\d/.test(n) || n.startsWith('+')) return '';
  n = n.replace(/[^\p{L}\s'-]/gu, ' ').replace(/\s+/g, ' ').trim();   // tira emojis, símbolos e parênteses
  return n.length >= 2 ? n : '';
}
function capitalizar(n) {
  return n.toLowerCase().split(' ').map((p, i) => (i > 0 && MINUSCULAS.has(p)) ? p : p.charAt(0).toUpperCase() + p.slice(1)).join(' ');
}
function primeiroNome(n) { return n ? capitalizar(n.split(' ')[0]) : ''; }

// ── Contatos ─────────────────────────────────────────────────────────────────
let _cache = { chave: '', contatos: [] };

function chaveArquivos() {
  const partes = [];
  const add = f => { try { const s = fs.statSync(f); partes.push(`${f}:${s.mtimeMs}:${s.size}`); } catch { /* ausente */ } };
  add(path.join(ENTRADA, 'contacts.csv'));
  if (fs.existsSync(LISTAS)) for (const f of fs.readdirSync(LISTAS).filter(x => /\.csv$/i.test(x))) add(path.join(LISTAS, f));
  return partes.join('|');
}

function lerCsvSimples(arq) {
  let raw = fs.readFileSync(arq, 'utf8');
  if (raw.charCodeAt(0) === 0xFEFF) raw = raw.slice(1);
  const linhas = raw.split('\n');
  const idx = linhas.findIndex(l => l.trimStart().startsWith('pontuacao,') || l.trimStart().startsWith('"pontuacao"'));
  if (idx > 0) raw = linhas.slice(idx).join('\n');
  return parse(raw, { columns: true, skip_empty_lines: true, relax_quotes: true, trim: true, relax_column_count: true });
}

/** Todos os contatos conhecidos, sem repetição de telefone. */
function carregarContatos() {
  const chave = chaveArquivos();
  if (chave === _cache.chave) return _cache.contatos;
  const mapa = new Map();
  const adicionar = (fone, nome, origem, extra = {}) => {
    const n = normalizarFone(fone);
    if (!n) return;
    const nomeOk = limparNome(nome);
    const ex = mapa.get(n);
    if (ex) { if (!ex.nome && nomeOk) ex.nome = nomeOk; return; }
    mapa.set(n, { id: n, numero: n, ddd: n.slice(0, 2), nome: nomeOk, origem, ...extra });
  };

  const contacts = path.join(ENTRADA, 'contacts.csv');
  if (fs.existsSync(contacts)) {
    try {
      for (const r of lerCsvSimples(contacts)) {
        const nome = [r['First Name'], r['Middle Name'], r['Last Name']].filter(Boolean).join(' ') || r['File As'] || r['Nickname'] || '';
        for (const col of ['Phone 1 - Value', 'Phone 2 - Value', 'Phone 3 - Value']) {
          for (const f of String(r[col] || '').split(':::')) adicionar(f, nome, 'contatos');
        }
      }
    } catch { /* arquivo inesperado: ignora */ }
  }
  if (fs.existsSync(LISTAS)) {
    for (const f of fs.readdirSync(LISTAS).filter(x => /\.csv$/i.test(x))) {
      try { for (const r of lerCsvSimples(path.join(LISTAS, f))) adicionar(r.numero, r.nome, 'listas anteriores'); } catch { /* */ }
    }
  }
  _cache = { chave, contatos: [...mapa.values()].sort((a, b) => (a.nome || '~').localeCompare(b.nome || '~', 'pt-BR')) };
  return _cache.contatos;
}

function lerSentLog() { try { return JSON.parse(fs.readFileSync(SENT_LOG, 'utf8')); } catch { return {}; } }

function lerBlacklist() {
  const set = new Set();
  const arq = path.join(ENTRADA, 'blacklist.txt');
  try {
    for (const l of fs.readFileSync(arq, 'utf8').split('\n')) {
      const t = l.trim();
      if (!t || t.startsWith('#')) continue;
      const n = normalizarFone(t) || soDigitos(t);
      if (n) set.add(n);
    }
  } catch { /* sem blacklist */ }
  return set;
}

/** Contatos + situação (blacklist / já recebeu no mês) para a tela. */
function contatosComSituacao() {
  const log = lerSentLog(), bl = lerBlacklist(), mes = mesLocal();
  return carregarContatos().map(c => ({
    ...c,
    blacklist: bl.has(c.numero),
    jaEnviadoMes: !!log[`${c.numero}_${mes}`],
  }));
}

function filtrar(contatos, f = {}) {
  const ddds = new Set((Array.isArray(f.ddds) ? f.ddds : []).map(String).filter(Boolean));
  const q = String(f.q || '').trim().toLowerCase();
  const qd = soDigitos(q);
  return contatos.filter(c => {
    if (ddds.size && !ddds.has(c.ddd)) return false;
    if (f.somenteComNome && !c.nome) return false;
    if (f.ocultarImpedidos && (c.blacklist || c.jaEnviadoMes)) return false;
    if (q && !(c.nome.toLowerCase().includes(q) || (qd && c.numero.includes(qd)))) return false;
    return true;
  });
}

function resumoDdds(contatos) {
  const m = {};
  for (const c of contatos) m[c.ddd] = (m[c.ddd] || 0) + 1;
  return Object.entries(m).sort((a, b) => b[1] - a[1]).map(([ddd, n]) => ({ ddd, n }));
}

// ── Mensagem ─────────────────────────────────────────────────────────────────
function saudacao(d = new Date()) {
  const h = d.getHours();
  return h < 12 ? 'Bom dia' : h < 18 ? 'Boa tarde' : 'Boa noite';
}

/** extras: objeto ou função(contato) com variáveis do CRM ({cidade}, {maps}, {instagram}…). Variável desconhecida fica como está. */
function renderizarMensagem(modelo, contato, agora = new Date(), extras = null) {
  const nomeCompleto = contato.nome ? capitalizar(contato.nome) : '';
  const vars = {
    ...(typeof extras === 'function' ? extras(contato) : (extras || {})),
    nome: primeiroNome(contato.nome),
    nome_completo: nomeCompleto,
    saudacao: saudacao(agora),
    data: `${pad2(agora.getDate())}/${pad2(agora.getMonth() + 1)}/${agora.getFullYear()}`,
  };
  let t = String(modelo || '').replace(/\{([a-z_]+)\}/gi, (m, k) => (vars[k.toLowerCase()] !== undefined ? vars[k.toLowerCase()] : m));
  // Sem nome: arruma "Olá , tudo bem?" / "Olá !" / espaços duplos
  t = t.replace(/\n{3,}/g, '\n\n').replace(/[ \t]+([,!.?:;])/g, '$1').replace(/,\s*([!?.:;])/g, '$1').replace(/,\s*,/g, ',').replace(/^[ \t]*,\s*/gm, '').replace(/[ \t]{2,}/g, ' ');
  return t.trim();
}

// ── Público ──────────────────────────────────────────────────────────────────
/**
 * pub = { modo: 'filtro'|'manual'|'numeros', filtros, ids, excluidos, numeros }
 * Devolve { alvos, removidos: { blacklist, jaEnviadoMes, invalidos, duplicados } }.
 */
function resolverPublico(pub = {}) {
  const todos = contatosComSituacao();
  const porId = new Map(todos.map(c => [c.id, c]));
  const removidos = { blacklist: 0, jaEnviadoMes: 0, invalidos: 0, duplicados: 0 };
  let base = [];

  if (pub.modo === 'numeros') {
    const vistos = new Set();
    const log = lerSentLog(), bl = lerBlacklist(), mes = mesLocal();
    const linhas = String(pub.numeros || '').split(/\r?\n|;/).map(s => s.trim()).filter(Boolean);
    for (const l of linhas) {
      // formato aceito: "número" ou "número, Nome" ou "Nome, número"
      const partes = l.split(/[,\t]/).map(s => s.trim());
      let fone = null, nome = '';
      for (const p of partes) { const n = normalizarFone(p); if (n && !fone) fone = n; else if (!soDigitos(p)) nome = p; }
      if (!fone) { removidos.invalidos++; continue; }
      if (vistos.has(fone)) { removidos.duplicados++; continue; }
      vistos.add(fone);
      const conhecido = porId.get(fone);
      base.push({ id: fone, numero: fone, ddd: fone.slice(0, 2), nome: limparNome(nome) || (conhecido ? conhecido.nome : ''), blacklist: bl.has(fone), jaEnviadoMes: !!log[`${fone}_${mes}`] });
    }
  } else if (pub.modo === 'manual') {
    const ids = new Set((pub.ids || []).map(String));
    base = todos.filter(c => ids.has(c.id));
  } else {
    const excl = new Set((pub.excluidos || []).map(String));
    base = filtrar(todos, pub.filtros || {}).filter(c => !excl.has(c.id));
  }

  const alvos = [];
  for (const c of base) {
    if (c.blacklist) { removidos.blacklist++; continue; }
    if (c.jaEnviadoMes) { removidos.jaEnviadoMes++; continue; }
    alvos.push(c);
  }
  return { alvos, removidos, totalSelecionado: base.length };
}

function previa({ mensagem, publico, contexto }) {
  const { alvos, removidos, totalSelecionado } = resolverPublico(publico);
  const amostra = alvos.find(c => c.nome) || alvos[0] || { nome: 'Maria Silva', ddd: '' };
  const ctx = contexto || {};
  const aval = crm.avaliarMensagem(mensagem, ctx);
  return {
    totalSelecionado, enviaveis: alvos.length, removidos,
    exemplo: { nome: amostra.nome || '(sem nome)', texto: renderizarMensagem(mensagem, amostra, new Date(), crm.extrasPara(ctx)) },
    semNome: alvos.filter(c => !c.nome).length,
    lotes: planejarLotes(alvos.length),
    avisos: aval.avisos, exigeConfirmacaoCFO: aval.exigeConfirmacaoCFO, motivosCFO: aval.motivosCFO,
  };
}

// ── Lotes diários (capacidade dos zaps) ──────────────────────────────────────
/** 4 zaps × 48 = 192 envios por dia (janela móvel de 24h por número). */
function capacidadeDiaria() {
  const cfg = core.lerConfig(), est = core.lerEstado(), porZap = core.limiteEfetivo(cfg);
  const ativos = cfg.chips.filter(c => c.ativo);
  const conectados = ativos.filter(c => core.sessaoExiste(c.id) && !(est[c.id] || {}).precisaQR);
  return { porZap, zapsAtivos: ativos.length, zapsConectados: conectados.length, porDia: ativos.length * porZap, porDiaConectado: conectados.length * porZap, janelaHoras: cfg.janelaHoras };
}
function planejarLotes(total, cap = capacidadeDiaria()) {
  const porLote = Math.max(1, cap.porDia || cap.porZap);
  const lotes = Math.max(0, Math.ceil(total / porLote));
  return { total, porLote, lotes, ultimoLote: lotes ? total - (lotes - 1) * porLote : 0, zapsAtivos: cap.zapsAtivos, zapsConectados: cap.zapsConectados, porZap: cap.porZap };
}

// ── Criação do CSV ───────────────────────────────────────────────────────────
function slug(s) {
  return String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 50);
}

function csvCampo(v) { return `"${String(v == null ? '' : v).replace(/"/g, '""')}"`; }

function validarMensagem(m) {
  const t = String(m || '').trim();
  if (!t) return 'Escreva a mensagem.';
  if (t.length > MAX_MSG) return `Mensagem muito longa (máx. ${MAX_MSG} caracteres).`;
  return null;
}

/** Cria o CSV da campanha. Devolve { arquivo, total, removidos } ou lança Error com texto para o usuário. */
function criarCampanha({ nome, mensagem, publico, contexto, confirmoCFO }) {
  const id = slug(nome);
  if (!id) throw new Error('Dê um nome para a campanha.');
  const erroMsg = validarMensagem(mensagem);
  if (erroMsg) throw new Error(erroMsg);
  const ctx = contexto || {};
  const aval = crm.avaliarMensagem(mensagem, ctx);
  if (aval.exigeConfirmacaoCFO && !confirmoCFO) {
    throw new Error(`Esta mensagem ${aval.motivosCFO.join('; ')}. A publicidade odontológica é restrita pelo CFO/CRO nesses pontos: revise e marque a confirmação para continuar.`);
  }
  const { alvos, removidos } = resolverPublico(publico);
  if (!alvos.length) throw new Error('Nenhum contato elegível: todos estão na blacklist, já receberam neste mês ou o filtro não encontrou ninguém.');

  const d = new Date();
  const data = `${d.getFullYear()}${pad2(d.getMonth() + 1)}${pad2(d.getDate())}`;
  let arquivo = `lista_${id}_WEB_${data}.csv`;
  for (let i = 2; fs.existsSync(path.join(LISTAS, arquivo)); i++) arquivo = `lista_${id}_WEB${i}_${data}.csv`;
  // segmento do nome do arquivo = letras maiúsculas (padrão lista_<campanha>_<SEG>_<data>.csv)
  arquivo = arquivo.replace(/_WEB(\d)_/, (_, n) => `_${'WEB'}${String.fromCharCode(64 + Number(n))}_`);

  const plano = planejarLotes(alvos.length);
  const linhas = ['pontuacao,categoria,ddd,numero,nome,mensagem,lote'];
  alvos.forEach((c, i) => {
    const lote = Math.floor(i / plano.porLote) + 1;   // lote diário: cada lote cabe na capacidade de 24h dos zaps
    linhas.push([100, id, c.ddd, c.numero, c.nome ? capitalizar(c.nome) : 'Contato', renderizarMensagem(mensagem, c, d, crm.extrasPara(ctx)), lote].map(csvCampo).join(','));
  });
  fs.mkdirSync(LISTAS, { recursive: true });
  fs.writeFileSync(path.join(LISTAS, arquivo), '﻿' + linhas.join('\n') + '\n', 'utf8');
  _cache.chave = '';
  return { arquivo, total: alvos.length, removidos, lotes: plano };
}

// ── Agendamentos ─────────────────────────────────────────────────────────────
function lerAgenda() { try { return JSON.parse(fs.readFileSync(AGENDA, 'utf8')); } catch { return []; } }
function salvarAgenda(lista) {
  fs.mkdirSync(path.dirname(AGENDA), { recursive: true });
  fs.writeFileSync(AGENDA, JSON.stringify(lista, null, 2), 'utf8');
}
function adicionarAgendamento({ arquivo, quando, modo, nome, acaoId }) {
  const lista = lerAgenda();
  const ag = {
    id: `ag_${Date.now().toString(36)}`, arquivo: arquivo || null, acaoId: acaoId || null, nome: nome || arquivo,
    quando: quando ? new Date(quando).toISOString() : new Date().toISOString(),
    modo: modo === 'paralelo' ? 'paralelo' : 'sequencial', status: 'pendente', criadoEm: new Date().toISOString(),
  };
  if (Number.isNaN(Date.parse(ag.quando))) throw new Error('Data/hora inválida.');
  lista.push(ag);
  salvarAgenda(lista);
  return ag;
}
function atualizarAgendamento(id, patch) {
  const lista = lerAgenda();
  const a = lista.find(x => x.id === id);
  if (!a) return null;
  Object.assign(a, patch);
  salvarAgenda(lista);
  return a;
}
/** Próximo agendamento pendente que já passou do horário (o mais antigo primeiro). */
function proximoVencido(agora = Date.now()) {
  return lerAgenda().filter(a => a.status === 'pendente' && Date.parse(a.quando) <= agora)
    .sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando))[0] || null;
}

module.exports = {
  normalizarFone, limparNome, primeiroNome, renderizarMensagem, carregarContatos, contatosComSituacao, filtrar, resumoDdds,
  resolverPublico, previa, criarCampanha, capacidadeDiaria, planejarLotes, validarMensagem, lerAgenda, adicionarAgendamento, atualizarAgendamento, proximoVencido, slug,
};
