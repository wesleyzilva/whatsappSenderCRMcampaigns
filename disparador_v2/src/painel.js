#!/usr/bin/env node
'use strict';
/**
 * painel.js — painel de operação no navegador (só neste computador: 127.0.0.1)
 *   node painel.js          → abre http://localhost:3737
 * Liga o painel.html ao sender.js: iniciar/parar o modo contínuo, ver zaps e saldo,
 * conectar número (QR), ativar/desativar zap, ajustar margem e horário, ver o log.
 */
const http = require('http');
const fs   = require('fs');
const path = require('path');
const { spawn, execFile } = require('child_process');
const core = require('./zap_core');
const gestao = require('./gestao');
const camp = require('./campanhas');
const crm  = require('./crm');

const DIR = require('path').join(__dirname, '..'); // raiz do projeto
const PORT = Number(process.env.PORTA) || 3737;
const SENT = path.join(DIR, 'logs', 'sent_log.json');
const CHIPS = path.join(DIR, 'config', 'chips.json');
const strip = s => s.replace(/\x1b\[[0-9;?]*[A-Za-z]/g, '');
const node  = (args) => spawn(process.execPath, [path.join(__dirname, 'sender.js'), ...args], { cwd: DIR, windowsHide: true });

// ── Modo contínuo (com reinício automático se cair) ──────────────────────────
let proc = null, querRodar = false, logs = [];
function addLog(s) {
  for (const l of strip(s).split(/\r?\n|\r/)) if (l.trim()) logs.push(`${new Date().toLocaleTimeString('pt-BR')}  ${l}`);
  if (logs.length > 600) logs = logs.slice(-400);
}
function lancar(args) {
  proc = node(args);
  proc.stdout.on('data', d => addLog(d.toString()));
  proc.stderr.on('data', d => addLog(d.toString()));
  proc.on('exit', code => {
    addLog(`— modo contínuo encerrado (código ${code}) —`);
    proc = null;
    if (agAtual && (code === 0 || !querRodar)) {
      const st = querRodar ? 'concluido' : 'interrompido';
      const a = camp.atualizarAgendamento(agAtual, { status: st, fimEm: new Date().toISOString() });
      if (a && a.acaoId) try { crm.salvarAcao(a.acaoId, { status: st === 'concluido' ? 'enviada' : 'agendada' }); } catch { /* */ }
      agAtual = null;
    }
    if (querRodar && code !== 0) {
      addLog('O programa caiu. Reiniciando em 30 s…');
      setTimeout(() => { if (querRodar && !proc) lancar(args); }, 30_000);
    }
  });
}
let agAtual = null;   // agendamento em execução (id)
function iniciar(o) {
  if (proc) return 'O modo contínuo já está rodando.';
  const a = ['--continuo', '--yes'];
  if (o.arquivo) a.unshift(path.join(DIR, 'dados', 'listas', o.arquivo));   // lista específica (campanha criada no painel)
  if (o.ignorarHorario) a.push('--ignorar-horario');
  if (o.modo === 'paralelo' || o.modo === 'sequencial') a.push(`--modo=${o.modo}`);
  if (/^\d{2}$/.test(String(o.ddd || ''))) a.push(`--ddd=${o.ddd}`);
  querRodar = true;
  lancar(a);
  return null;
}
function parar() {
  querRodar = false;
  if (!proc) return;
  try { proc.stdin.write('P\n'); } catch { /* */ }          // parada segura (fecha os Chromes)
  const p = proc; setTimeout(() => { try { if (proc === p) p.kill(); } catch { /* */ } }, 30_000);
}

// ── Agendador: a cada 20 s procura campanha agendada que já passou do horário ─
function verificarAgenda() {
  if (proc || agAtual) return;
  const ag = camp.proximoVencido();
  if (!ag) return;
  // Ação do calendário: a lista é criada AGORA (preços, links e "quem já recebeu no mês" atualizados).
  if (ag.acaoId && !ag.arquivo) {
    try {
      const acao = crm.ler('plano').acoes.find(a => a.id === ag.acaoId);
      if (!acao) throw new Error('Ação do calendário não existe mais.');
      const m = crm.montarDaAcao(acao);
      const r = camp.criarCampanha({ ...m, confirmoCFO: true });
      ag.arquivo = r.arquivo;
      camp.atualizarAgendamento(ag.id, { arquivo: r.arquivo, total: r.total });
      addLog(`📝 Lista criada para "${ag.nome}": ${r.total} contato(s).`);
    } catch (e) {
      camp.atualizarAgendamento(ag.id, { status: 'erro', erro: e.message });
      if (ag.acaoId) try { crm.salvarAcao(ag.acaoId, { status: 'erro' }); } catch { /* */ }
      addLog(`❌ Campanha agendada "${ag.nome}" não foi criada: ${e.message}`);
      return;
    }
  }
  if (!arquivoCsvValido(ag.arquivo)) { camp.atualizarAgendamento(ag.id, { status: 'erro', erro: 'Lista não encontrada' }); return; }
  const erro = iniciar({ arquivo: ag.arquivo, modo: ag.modo });
  if (erro) return;
  agAtual = ag.id;
  if (ag.acaoId) try { crm.salvarAcao(ag.acaoId, { status: 'enviando' }); } catch { /* */ }
  camp.atualizarAgendamento(ag.id, { status: 'rodando', inicioEm: new Date().toISOString() });
  addLog(`⏰ Campanha agendada iniciada: ${ag.nome} (${ag.arquivo})`);
}
setInterval(() => { try { verificarAgenda(); } catch (e) { addLog(`Erro no agendador: ${e.message}`); } }, 20_000);

// ── Conexão de número (QR) ───────────────────────────────────────────────────
const conn = { proc: null, txt: '', chip: null };
function conectar(id) {
  if (conn.proc) return 'Já existe uma conexão em andamento.';
  const cfg = core.lerConfig();
  const i = cfg.chips.findIndex(c => c.id === id);
  if (i < 0) return 'Zap inexistente.';
  conn.txt = ''; conn.chip = id;
  conn.proc = node([`--conectar=${i + 1}`]);
  const on = d => {
    const s = d.toString();
    if (s.includes('Escaneie o QR')) conn.txt = '';          // QR novo substitui o anterior
    conn.txt = (conn.txt + strip(s).replace(/\r/g, '\n')).slice(-8000);
  };
  conn.proc.stdout.on('data', on); conn.proc.stderr.on('data', on);
  conn.proc.on('exit', () => { conn.txt += '\n— conexão encerrada —'; conn.proc = null; });
  return null;
}

// ── Visões de campanha e gestão (gestao.js) ───────────────────────────────
let _acoes = { t: 0, v: { acoes: [] } };
function acoesCache() {
  if (Date.now() - _acoes.t > 10_000) {
    try { _acoes = { t: Date.now(), v: gestao.acoesNecessarias() }; } catch { _acoes = { t: Date.now(), v: { acoes: [] } }; }
  }
  return _acoes.v;
}

function arquivoCsvValido(nome) {
  return /^[\w.-]+\.csv$/.test(String(nome || '')) && fs.existsSync(path.join(DIR, 'dados/listas', nome)) ? nome : null;
}

/** Roda o gestao.js e devolve o texto (sem cores). Argumentos sempre em array: nada passa por shell. */
function rodarGestao(args) {
  return new Promise(resolve => {
    execFile(process.execPath, [path.join(__dirname, 'gestao.js'), ...args], { cwd: DIR, windowsHide: true, timeout: 60_000, maxBuffer: 4e6 },
      (err, out, errOut) => resolve({ ok: !err, texto: strip(String(out || '') + String(errOut || '')).trim() }));
  });
}

// ── Estado para a tela ───────────────────────────────────────────────────────
function estado() {
  const cfg = core.lerConfig();
  let sl = {}; try { sl = JSON.parse(fs.readFileSync(SENT, 'utf8')); } catch { /* sem log ainda */ }
  const est = core.lerEstado(), jan = core.enviadosJanelaPorChip(sl, cfg), ef = core.limiteEfetivo(cfg);
  const tot = { sent: 0, failed: 0, skipped_not_registered: 0 };
  for (const e of Object.values(sl)) if (tot[e.status] !== undefined) tot[e.status]++;
  const zaps = cfg.chips.map((c, i) => {
    const st = est[c.id] || {}, n = jan[c.id] || 0;
    const numero = core.obterNumeroChip(c, est, sl);
    return {
      id: c.id, idx: i + 1, apelido: c.apelido, ativo: c.ativo, numero,
      rotulo: core.identificadorZap({ id: c.id, apelido: c.apelido, numero, slot: i + 1 }),
      sessao: core.sessaoExiste(c.id), precisaQR: !!st.precisaQR,
      bloqueadoAte: st.bloqueadoAte && Date.parse(st.bloqueadoAte) > Date.now() ? st.bloqueadoAte : null,
      enviados: n, cap: ef, liberaEm: n >= ef ? core.quandoTemVagas(c.id, 1, sl, cfg) : null,
    };
  });
  return {
    rodando: !!proc, zaps, tot, log: logs.slice(-200), acoes: acoesCache().acoes,
    cfg: {
      limite: cfg.limiteDiario, margem: cfg.margemSeguranca, ef, janelaHoras: cfg.janelaHoras,
      horarioAtivo: cfg.horario.ativo, horario: core.descreverHorario(cfg),
      dentro: core.dentroDoHorario(cfg), proxima: core.proximaAbertura(cfg),
      podeAdicionar: cfg.chips.length < core.MAX_CHIPS,
    },
  };
}

function salvarCfg(b) {
  const cfg = core.lerConfig();
  const raw = JSON.parse(fs.readFileSync(CHIPS, 'utf8').replace(/^\uFEFF/, ''));
  if (b.margem !== undefined) {
    const m = Math.floor(Number(b.margem));
    if (!Number.isFinite(m) || m < 0 || m >= cfg.limiteDiario) return 'Margem inválida.';
    raw.margemSeguranca = m;
  }
  if (b.horarioAtivo !== undefined) raw.horario = { ...(raw.horario || cfg.horario), ativo: !!b.horarioAtivo };
  if (b.zapId !== undefined) {
    const c = (raw.chips || []).find(x => x.id === b.zapId);
    if (!c) return 'Zap inexistente.';
    c.ativo = !!b.zapAtivo;
  }
  fs.writeFileSync(CHIPS, JSON.stringify(raw, null, 2), 'utf8');
  return null;
}

// ── HTTP ─────────────────────────────────────────────────────────────────────
const json = (res, obj, code = 200) => { res.writeHead(code, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(obj)); };
const corpo = req => new Promise(r => { let s = ''; req.on('data', d => { s += d; if (s.length > 2e6) req.destroy(); }); req.on('end', () => { try { r(JSON.parse(s || '{}')); } catch { r({}); } }); });

http.createServer(async (req, res) => {
  try {
    const url = req.url.split('?')[0];
    if (req.method === 'GET') {
      if (url === '/' || url === '/index.html') { res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }); return res.end(fs.readFileSync(path.join(__dirname, 'painel.html'))); }
      if (url === '/api/estado')  return json(res, estado());
      if (url === '/api/conexao') return json(res, { rodando: !!conn.proc, chip: conn.chip, txt: conn.txt });
      if (url === '/api/campanhas') return json(res, { campanhas: gestao.listarCampanhas(0).slice(0, 12) });
      if (url === '/api/gestao') return json(res, await rodarGestao(['--gestao']));
      if (url === '/crm.js') { res.writeHead(200, { 'Content-Type': 'application/javascript; charset=utf-8', 'Cache-Control': 'no-store' }); return res.end(fs.readFileSync(path.join(__dirname, 'painel_crm.js'))); }
      if (url === '/api/crm') { const ano = Number(new URL(req.url, 'http://x').searchParams.get('ano')) || new Date().getFullYear(); 
        const v = crm.visaoGeral(ano), est = {};
        for (const a of v.plano.acoes) {
          if (['cancelada', 'enviada'].includes(a.status)) continue;
          try { const m = crm.montarDaAcao(a); est[a.id] = camp.planejarLotes(camp.resolverPublico(m.publico).alvos.length); } catch { /* modelo removido */ }
        }
        return json(res, { ...v, capacidade: camp.capacidadeDiaria(), estimativas: est }); }
      if (url === '/api/agendamentos') return json(res, { agendamentos: camp.lerAgenda().slice(-30).reverse(), rodandoAgora: agAtual });
      if (url === '/api/contatos') {
        const q = new URL(req.url, 'http://x').searchParams;
        const todos = camp.contatosComSituacao();
        const f = { ddds: (q.get('ddds') || '').split(',').filter(Boolean), q: q.get('q') || '', somenteComNome: q.get('nome') === '1', ocultarImpedidos: q.get('ocultar') === '1' };
        const achados = camp.filtrar(todos, f);
        return json(res, { total: todos.length, filtrados: achados.length, ddds: camp.resumoDdds(todos), itens: achados.slice(0, 300) });
      }
      if (url === '/api/erros') {
        const erros = gestao.lerJsonl('erros', 7), cont = {};
        for (const e of erros) cont[`${e.tipo} · ${e.evento}`] = (cont[`${e.tipo} · ${e.evento}`] || 0) + 1;
        return json(res, { total: erros.length, porTipo: Object.entries(cont).sort((a, b) => b[1] - a[1]).slice(0, 10), ultimos: erros.slice(-10).reverse().map(e => ({ ts: e.ts, evento: e.evento, tipo: e.tipo, mensagem: String(e.mensagem || '').slice(0, 160), chip: e.chip || null })) });
      }
      return json(res, { erro: 'não encontrado' }, 404);
    }
    if (req.method === 'POST') {
      if (req.headers['x-painel'] !== '1') return json(res, { erro: 'bloqueado' }, 403);   // barra requisições de outros sites
      const b = await corpo(req);
      let erro = null;
      if (url === '/api/campanha/previa') {
        const e = camp.validarMensagem(b.mensagem);
        return json(res, { ...camp.previa({ mensagem: b.mensagem, publico: b.publico, contexto: b.contexto }), avisoMensagem: e });
      }
      else if (url === '/api/campanha/criar') {
        try {
          if (b.quando && Number.isNaN(Date.parse(b.quando))) throw new Error('Data/hora inválida.');
          const r = camp.criarCampanha({ nome: b.nome, mensagem: b.mensagem, publico: b.publico, contexto: b.contexto, confirmoCFO: !!b.confirmoCFO });
          let ag = null;
          if (b.acao === 'agendar' || b.acao === 'agora') ag = camp.adicionarAgendamento({ arquivo: r.arquivo, nome: b.nome, quando: b.acao === 'agora' ? null : b.quando, modo: b.modo });
          if (b.acao === 'agora') setTimeout(() => { try { verificarAgenda(); } catch { /* */ } }, 500);
          return json(res, { ok: true, ...r, agendamento: ag });
        } catch (e) { return json(res, { erro: e.message }, 400); }
      }
      else if (url === '/api/crm/salvar') {
        try {
          if (!['clinica', 'precos', 'promocoes', 'modelos'].includes(b.tipo)) throw new Error('Tipo inválido.');
          crm.gravar(b.tipo, crm.sanear(b.tipo, b.dados));
        } catch (e) { erro = e.message; }
      }
      else if (url === '/api/crm/restaurar-modelos') crm.restaurarModelosPadrao();
      else if (url === '/api/crm/gerar-plano') {
        const ano = Math.floor(Number(b.ano)), t = Math.floor(Number(b.t));
        if (!(ano >= 2024 && ano <= 2100 && t >= 1 && t <= 4)) erro = 'Período inválido.';
        else return json(res, { ok: true, ...crm.gerarPlano(ano, t) });
      }
      else if (url === '/api/crm/acao') { try { crm.salvarAcao(String(b.id), b.patch || {}); } catch (e) { erro = e.message; } }
      else if (url === '/api/crm/acao/aprovar') {
        try {
          const acao = crm.ler('plano').acoes.find(a => a.id === b.id);
          if (!acao) throw new Error('Ação não encontrada.');
          if (acao.status === 'agendada' || acao.status === 'enviando') throw new Error('Esta ação já está agendada.');
          const m = crm.montarDaAcao(acao), av = crm.avaliarMensagem(m.mensagem, m.contexto);
          if (av.avisos.length) throw new Error(`Corrija antes de agendar: ${av.avisos.join(' ')}`);
          if (av.exigeConfirmacaoCFO && !b.confirmoCFO) throw new Error(`Esta mensagem ${av.motivosCFO.join('; ')}. Revise as regras do CFO/CRO e marque a confirmação.`);
          const quando = new Date(acao.enviarEm);
          const ag = camp.adicionarAgendamento({ quando: quando < new Date() ? new Date() : quando, modo: 'sequencial', nome: m.nome, acaoId: acao.id });
          crm.salvarAcao(acao.id, { status: 'agendada', agendamentoId: ag.id });
        } catch (e) { erro = e.message; }
      }
      else if (url === '/api/crm/acao/cancelar') {
        try {
          const acao = crm.ler('plano').acoes.find(a => a.id === b.id);
          if (acao && acao.agendamentoId) camp.atualizarAgendamento(acao.agendamentoId, { status: 'cancelado' });
          crm.salvarAcao(String(b.id), { status: 'cancelada' });
        } catch (e) { erro = e.message; }
      }
      else if (url === '/api/agendamento/cancelar') {
        const a = camp.lerAgenda().find(x => x.id === b.id);
        if (!a || a.status !== 'pendente') erro = 'Só é possível cancelar agendamentos pendentes.';
        else camp.atualizarAgendamento(b.id, { status: 'cancelado' });
      }
      else if (url === '/api/iniciar')  erro = iniciar(b);
      else if (url === '/api/parar')    parar();
      else if (url === '/api/config')   erro = salvarCfg(b);
      else if (url === '/api/conectar') erro = conectar(String(b.id || ''));
      else if (url === '/api/cancelar-conexao') { if (conn.proc) try { conn.proc.stdin.write('\n'); } catch { /* */ } }
      else if (url === '/api/retentar-falhas') {
        const arq = arquivoCsvValido(b.arquivo);
        if (!arq) erro = 'Arquivo inválido.';
        else if (proc) erro = 'Pare o modo contínuo antes de devolver falhas à fila.';
        else { const r = await rodarGestao(['--retentar-falhas', path.join('dados/listas', arq), '--yes']); return json(res, { ok: r.ok, texto: r.texto }); }
      }
      else if (url === '/api/convite-grupo') {
        const r = await rodarGestao(['--convite-grupo', `--link=${String(b.link || '').trim()}`, ...(b.ddd && /^\d{2}$/.test(String(b.ddd)) ? [`--ddd=${b.ddd}`] : [])]);
        return json(res, { ok: r.ok, texto: r.texto });
      }
      else if (url === '/api/adicionar') { try { core.adicionarChip(core.lerConfig(), String(b.apelido || '')); } catch (e) { erro = e.message; } }
      else erro = 'rota desconhecida';
      return json(res, erro ? { erro } : { ok: true }, erro ? 400 : 200);
    }
    json(res, { erro: 'método não permitido' }, 405);
  } catch (e) { json(res, { erro: e.message }, 500); }
}).listen(PORT, '127.0.0.1', () => {
  const u = `http://localhost:${PORT}`;
  console.log(`Painel pronto em ${u}  (Ctrl+C para fechar)`);
  if (process.platform === 'win32') spawn('cmd', ['/c', 'start', '', u], { windowsHide: true });
});

process.on('SIGINT', () => { parar(); if (conn.proc) conn.proc.kill(); setTimeout(() => process.exit(0), 4000); });
process.on('uncaughtException', e => addLog(`Erro interno: ${e.message}`));
