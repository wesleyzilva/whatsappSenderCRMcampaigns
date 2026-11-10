'use strict';
/**
 * crm.js — cadastro e calendário de marketing da clínica (tudo editável pelo painel, sem mexer em arquivos).
 *
 *  config/clinica.json     nome, Instagram, assinatura, unidades (cidade, endereço, Google Maps, link de avaliação, DDDs)
 *  config/precos.json      tabela de procedimentos e preços
 *  config/promocoes.json   promoções por período (desconto % ou preço promocional por procedimento)
 *  config/modelos.json     biblioteca de mensagens (variáveis {nome}, {cidade}, {maps}, {instagram}, {avaliacao}…)
 *  config/plano.json       ações do calendário (datas comemorativas por trimestre) — sugeridas → agendadas
 *
 * IMPORTANTE (publicidade odontológica): o Código de Ética Odontológica (CFO) restringe divulgar preços,
 * descontos, serviços gratuitos e condições de pagamento. Mensagens com esses itens exigem confirmação
 * explícita do usuário (ver `avaliarMensagem`). Isto não é orientação jurídica: confirme com o CRO.
 */
const fs   = require('fs');
const path = require('path');

const DIR = path.join(__dirname, '..');
const CFG = path.join(DIR, 'config');
const ARQ = {
  clinica:   path.join(CFG, 'clinica.json'),
  precos:    path.join(CFG, 'precos.json'),
  promocoes: path.join(CFG, 'promocoes.json'),
  modelos:   path.join(CFG, 'modelos.json'),
  plano:     path.join(CFG, 'plano.json'),
};

const pad2 = n => String(n).padStart(2, '0');
const iso  = d => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
const slug = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40);
const brl  = n => Number(n || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const txt  = (v, max = 400) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '').trim().slice(0, max);

// ── Padrões ──────────────────────────────────────────────────────────────────
function padraoClinica() {
  return {
    nome: 'Dra. Daiana Ferraz',
    assinatura: 'Dra. Daiana Ferraz',
    instagram: 'https://www.instagram.com/dradaianaferrazsc/',
    sair: 'Para não receber mais mensagens, responda SAIR.',
    antecedenciaDias: 7,
    horaPadrao: '10:00',
    unidades: [
      { id: 'pato-branco', cidade: 'Pato Branco', uf: 'PR', endereco: '', maps: 'https://share.google/EUJjuMOG9Dpg70I', avaliacao: '', ddds: ['46'] },
      { id: 'sao-carlos', cidade: 'São Carlos', uf: 'SP', endereco: '', maps: '', avaliacao: '', ddds: ['16'] },
    ],
  };
}

function padraoPrecos() {
  const p = (nome, categoria) => ({ id: slug(nome), nome, categoria, preco: 0 });
  return { procedimentos: [
    p('Avaliação odontológica', 'Odontologia'), p('Limpeza (profilaxia)', 'Odontologia'), p('Clareamento dental', 'Odontologia'),
    p('Lentes de contato dental', 'Estética dental'), p('Facetas em resina', 'Estética dental'),
    p('Toxina botulínica', 'Harmonização orofacial'), p('Preenchimento labial', 'Harmonização orofacial'),
    p('Bioestimulador de colágeno', 'Harmonização orofacial'), p('Avaliação de harmonização facial', 'Harmonização orofacial'),
  ] };
}

// Datas comemorativas: [id, nome, regra, abertura (texto da mensagem)]
const DATAS = [
  ['ano-novo',     'Ano Novo',              '01-01',      'Que este novo ano comece com muito sorriso! ✨ Que tal planejar o cuidado com seu sorriso e sua autoestima desde já?'],
  ['dia-mulher',   'Dia Internacional da Mulher', '03-08', 'Hoje é dia de celebrar você! 💐 Separamos um carinho especial pelo Dia da Mulher.'],
  ['saude-bucal',  'Dia Mundial da Saúde Bucal', '03-20', 'Hoje é o Dia Mundial da Saúde Bucal! 🦷 Cuidar do sorriso é cuidar de você.'],
  ['pascoa',       'Páscoa',                'pascoa',     'Feliz Páscoa! 🐣 Que seja um tempo de renovação, inclusive para o seu sorriso.'],
  ['dia-maes',     'Dia das Mães',          'maes',       'Feliz Dia das Mães! 💐 Presenteie quem você ama (ou se presenteie) com cuidado e bem-estar.'],
  ['namorados',    'Dia dos Namorados',     '06-12',      'Feliz Dia dos Namorados! 💕 Um sorriso confiante faz toda a diferença.'],
  ['dia-pais',     'Dia dos Pais',          'pais',       'Feliz Dia dos Pais! 👔 Uma ótima data para cuidar da saúde e da autoestima.'],
  ['dia-cliente',  'Dia do Cliente',        '09-15',      'Hoje é o Dia do Cliente e queremos agradecer pela confiança! 💛'],
  ['dia-criancas', 'Dia das Crianças',      '10-12',      'Feliz Dia das Crianças! 🎈 Sorrisos saudáveis começam cedo.'],
  ['dia-dentista', 'Dia do Dentista',       '10-25',      'Hoje é o Dia do Dentista! 🦷 Obrigada por confiar no nosso trabalho.'],
  ['black-friday', 'Black Friday',          'bf',         'A Black Friday chegou! 🖤 Veja o que preparamos para você.'],
  ['natal',        'Natal',                 '12-25',      'Feliz Natal! 🎄 Que sua casa se encha de paz e de sorrisos.'],
];

const CORPO_DATA = `{saudacao}, {nome}! 😊
{abertura}

{lista_promocoes}

📍 {cidade}: {maps}
📸 Instagram: {instagram}

Para agendar, é só responder esta mensagem.
{assinatura}
{sair}`;

function padraoModelos() {
  const m = (id, categoria, nome, texto) => ({ id, categoria, nome, texto, padrao: true });
  const lista = DATAS.map(([id, nome, , abertura]) =>
    m(`data-${id}`, 'Datas comemorativas', nome, CORPO_DATA.replace('{abertura}', abertura)));
  return [
    ...lista,
    m('apresentacao', 'Procedimentos', 'Apresentar um procedimento',
`{saudacao}, {nome}! 😊
Você já conhece o procedimento de *{procedimento}*?

Posso explicar como funciona, para quem é indicado e tirar suas dúvidas em uma avaliação.

📍 {cidade}: {maps}
📸 Instagram: {instagram}

Quer agendar uma avaliação? É só responder aqui.
{assinatura}
{sair}`),
    m('localizacao', 'Relacionamento', 'Enviar localização (Google Maps)',
`{saudacao}, {nome}! 😊
Segue a nossa localização em {cidade}:

📍 {endereco}
🗺️ {maps}

Qualquer dúvida para chegar, é só falar por aqui.
{assinatura}
{sair}`),
    m('instagram', 'Relacionamento', 'Convidar para o Instagram',
`{saudacao}, {nome}! 😊
Quer acompanhar dicas de cuidado com o sorriso e novidades da clínica?

📸 Siga a gente no Instagram: {instagram}

{assinatura}
{sair}`),
    m('avaliacao-google', 'Relacionamento', 'Pedir avaliação no Google',
`{saudacao}, {nome}! 😊
Foi um prazer cuidar de você! Sua opinião é muito importante para nós.

Se puder, deixe sua avaliação no Google (leva menos de 1 minuto):
⭐ {avaliacao}

Muito obrigada pela confiança!
{assinatura}
{sair}`),
    m('aniversario', 'Relacionamento', 'Aniversário',
`{saudacao}, {nome}! 🎉
Hoje é um dia especial e a equipe {clinica} deseja a você um feliz aniversário, com muita saúde e muitos sorrisos!

{assinatura}
{sair}`),
    m('retorno', 'Relacionamento', 'Convite para retorno / revisão',
`{saudacao}, {nome}! 😊
Faz um tempinho que não nos vemos. Que tal agendar uma avaliação de rotina para cuidar do seu sorriso?

📍 {cidade}: {maps}

É só responder esta mensagem para escolher o melhor horário.
{assinatura}
{sair}`),
    m('boas-vindas', 'Relacionamento', 'Boas-vindas / novo contato',
`{saudacao}, {nome}! 😊
Aqui é da {clinica}. Estamos à disposição para ajudar com odontologia estética e harmonização orofacial.

📍 {cidade}: {maps}
📸 Instagram: {instagram}

Como podemos ajudar?
{assinatura}
{sair}`),
    m('orcamento', 'Relacionamento', 'Orçamento em aberto',
`{saudacao}, {nome}! 😊
Passando para saber se ficou alguma dúvida sobre o seu plano de tratamento. Posso te ajudar a encontrar o melhor momento para começar?

{assinatura}
{sair}`),
  ];
}

// ── Leitura / gravação ───────────────────────────────────────────────────────
function ler(tipo) {
  const padrao = { clinica: padraoClinica, precos: padraoPrecos, promocoes: () => ({ itens: [] }), modelos: padraoModelos, plano: () => ({ acoes: [] }) }[tipo];
  try { return JSON.parse(fs.readFileSync(ARQ[tipo], 'utf8').replace(/^﻿/, '')); }
  catch { return padrao(); }
}
function gravar(tipo, dados) {
  fs.mkdirSync(CFG, { recursive: true });
  fs.writeFileSync(ARQ[tipo], JSON.stringify(dados, null, 2), 'utf8');
}

function urlOk(u) { const s = txt(u, 500); return /^https?:\/\/\S+$/i.test(s) ? s : ''; }
function instagramUrl(v) {
  const s = txt(v, 200);
  if (!s) return '';
  if (/^https?:\/\//i.test(s)) return urlOk(s);
  const user = s.replace(/^@/, '').replace(/[^A-Za-z0-9._]/g, '');
  return user ? `https://www.instagram.com/${user}/` : '';
}

/** Valida e normaliza o que veio da tela (nunca confia no navegador). Lança Error com texto para o usuário. */
function sanear(tipo, d) {
  d = d || {};
  if (tipo === 'clinica') {
    const unidades = (Array.isArray(d.unidades) ? d.unidades : []).slice(0, 12).map(u => ({
      id: slug(u.id || u.cidade) || `unidade-${Math.random().toString(36).slice(2, 6)}`,
      cidade: txt(u.cidade, 60), uf: txt(u.uf, 2).toUpperCase(), endereco: txt(u.endereco, 200),
      maps: urlOk(u.maps), avaliacao: urlOk(u.avaliacao),
      ddds: [...new Set((Array.isArray(u.ddds) ? u.ddds : String(u.ddds || '').split(/[,\s;]+/)).map(x => String(x).replace(/\D/g, '')).filter(x => /^\d{2}$/.test(x)))],
    })).filter(u => u.cidade);
    if (!unidades.length) throw new Error('Cadastre ao menos uma unidade (cidade).');
    const ant = Math.floor(Number(d.antecedenciaDias));
    return {
      nome: txt(d.nome, 80) || 'Clínica', assinatura: txt(d.assinatura, 120), instagram: instagramUrl(d.instagram),
      sair: txt(d.sair, 160), antecedenciaDias: Number.isFinite(ant) && ant >= 0 && ant <= 60 ? ant : 7,
      horaPadrao: /^\d{2}:\d{2}$/.test(String(d.horaPadrao)) ? d.horaPadrao : '10:00', unidades,
    };
  }
  if (tipo === 'precos') {
    const ids = new Set();
    const procedimentos = (Array.isArray(d.procedimentos) ? d.procedimentos : []).slice(0, 300).map(p => {
      let id = slug(p.id || p.nome); while (ids.has(id)) id += '-2'; ids.add(id);
      const preco = Math.round(Number(String(p.preco).replace(',', '.')) * 100) / 100;
      return { id, nome: txt(p.nome, 80), categoria: txt(p.categoria, 60), preco: Number.isFinite(preco) && preco >= 0 ? preco : 0 };
    }).filter(p => p.nome);
    return { procedimentos };
  }
  if (tipo === 'promocoes') {
    const procIds = new Set(ler('precos').procedimentos.map(p => p.id));
    const itens = (Array.isArray(d.itens) ? d.itens : []).slice(0, 100).map(x => ({
      id: slug(x.id || x.titulo) || `promo-${Math.random().toString(36).slice(2, 6)}`,
      titulo: txt(x.titulo, 80), periodo: /^\d{4}-T[1-4]$/.test(String(x.periodo)) ? x.periodo : '',
      validadeAte: /^\d{4}-\d{2}-\d{2}$/.test(String(x.validadeAte)) ? x.validadeAte : '',
      condicoes: txt(x.condicoes, 200),
      itens: (Array.isArray(x.itens) ? x.itens : []).slice(0, 30).filter(i => procIds.has(i.procId)).map(i => {
        const valor = Number(String(i.valor).replace(',', '.'));
        const tipoI = i.tipo === 'valor' ? 'valor' : 'percent';
        return { procId: i.procId, tipo: tipoI, valor: Number.isFinite(valor) && valor >= 0 ? (tipoI === 'percent' ? Math.min(valor, 100) : valor) : 0 };
      }),
    })).filter(x => x.titulo);
    return { itens };
  }
  if (tipo === 'modelos') {
    const ids = new Set();
    const arr = (Array.isArray(d) ? d : d.modelos || []).slice(0, 200).map(m => {
      let id = slug(m.id || m.nome); while (ids.has(id)) id += '-2'; ids.add(id);
      return { id, categoria: txt(m.categoria, 40) || 'Outros', nome: txt(m.nome, 80), texto: String(m.texto || '').slice(0, 4000), padrao: !!m.padrao };
    }).filter(m => m.nome && m.texto.trim());
    return arr;
  }
  throw new Error('Tipo desconhecido.');
}

// ── Tabela de preços e promoções ─────────────────────────────────────────────
function precoPromocional(proc, item) {
  if (!proc || !item) return null;
  const base = Number(proc.preco) || 0;
  if (item.tipo === 'valor') return Math.round(Number(item.valor) * 100) / 100;
  return Math.round(base * (1 - Number(item.valor) / 100) * 100) / 100;
}

function detalhePromocao(promo) {
  if (!promo) return [];
  const procs = new Map(ler('precos').procedimentos.map(p => [p.id, p]));
  return promo.itens.map(i => {
    const p = procs.get(i.procId); if (!p) return null;
    const promoPreco = precoPromocional(p, i);
    const pct = i.tipo === 'percent' ? Number(i.valor) : (p.preco > 0 ? Math.round((1 - promoPreco / p.preco) * 100) : 0);
    return { procId: p.id, nome: p.nome, preco: p.preco, promo: promoPreco, pct, semPreco: !(p.preco > 0) && i.tipo === 'percent' };
  }).filter(Boolean);
}

function textoListaPromocoes(promo) {
  const det = detalhePromocao(promo);
  if (!det.length) return '';
  const linhas = det.map(d => d.semPreco ? `• ${d.nome}: ${d.pct}% de desconto`
    : (d.preco > 0 ? `• ${d.nome}: de ${brl(d.preco)} por *${brl(d.promo)}*${d.pct ? ` (${d.pct}% OFF)` : ''}` : `• ${d.nome}: *${brl(d.promo)}*`));
  const validade = promo.validadeAte ? `\n⏰ Válido até ${promo.validadeAte.split('-').reverse().join('/')}` : '';
  const cond = promo.condicoes ? `\n${promo.condicoes}` : '';
  return `🎁 *${promo.titulo}*\n${linhas.join('\n')}${validade}${cond}`;
}

// ── Variáveis das mensagens ──────────────────────────────────────────────────
const VARIAVEIS_CONTATO = ['nome', 'nome_completo', 'saudacao', 'data'];
const VARIAVEIS_CRM = ['clinica', 'assinatura', 'sair', 'instagram', 'cidade', 'uf', 'endereco', 'maps', 'avaliacao',
  'procedimento', 'promocao', 'lista_promocoes', 'validade', 'desconto', 'preco', 'preco_promo', 'abertura'];
const VARIAVEIS_PRECO = new Set(['lista_promocoes', 'desconto', 'preco', 'preco_promo']);

function unidadeDoContato(clin, ctx, contato) {
  const un = clin.unidades;
  if (ctx.unidadeId && ctx.unidadeId !== 'auto') return un.find(u => u.id === ctx.unidadeId) || un[0];
  return (contato && un.find(u => u.ddds.includes(contato.ddd))) || un[0];
}

/** Devolve uma função (contato) → mapa de variáveis do CRM. ctx = { unidadeId, promocaoId, procedimentoId } */
function extrasPara(ctx = {}) {
  const clin = ler('clinica'), precos = ler('precos'), promos = ler('promocoes');
  const promo = promos.itens.find(p => p.id === ctx.promocaoId) || null;
  const proc = precos.procedimentos.find(p => p.id === ctx.procedimentoId) || null;
  const det = detalhePromocao(promo);
  return contato => {
    const un = unidadeDoContato(clin, ctx, contato);
    const primeiro = det[0] || (proc ? { nome: proc.nome, preco: proc.preco, promo: proc.preco, pct: 0 } : null);
    return {
      clinica: clin.nome, assinatura: clin.assinatura, sair: clin.sair, instagram: clin.instagram,
      cidade: un.cidade, uf: un.uf, endereco: un.endereco || un.cidade, maps: un.maps, avaliacao: un.avaliacao,
      procedimento: proc ? proc.nome : (primeiro ? primeiro.nome : ''),
      promocao: promo ? promo.titulo : '', lista_promocoes: textoListaPromocoes(promo),
      validade: promo && promo.validadeAte ? promo.validadeAte.split('-').reverse().join('/') : '',
      desconto: primeiro && primeiro.pct ? `${primeiro.pct}%` : '',
      preco: primeiro && primeiro.preco > 0 ? brl(primeiro.preco) : '', preco_promo: primeiro && primeiro.promo > 0 ? brl(primeiro.promo) : '',
      abertura: '',
    };
  };
}

/**
 * Confere a mensagem ANTES de criar a campanha. Devolve { avisos: [...], exigeConfirmacaoCFO: bool, motivosCFO: [...] }.
 * Avisos = problemas práticos (variável inexistente, link não cadastrado). CFO = preços/descontos/gratuidade.
 */
function avaliarMensagem(texto, ctx = {}) {
  const clin = ler('clinica'), avisos = [], motivosCFO = [];
  const usadas = [...new Set([...String(texto).matchAll(/\{([a-z_]+)\}/gi)].map(m => m[1].toLowerCase()))];
  const conhecidas = new Set([...VARIAVEIS_CONTATO, ...VARIAVEIS_CRM]);
  for (const v of usadas) if (!conhecidas.has(v)) avisos.push(`A variável {${v}} não existe e aparecerá escrita assim na mensagem.`);

  const unidades = !ctx.unidadeId || ctx.unidadeId === 'auto' ? clin.unidades : clin.unidades.filter(u => u.id === ctx.unidadeId);
  const exige = (v, campo, rotulo) => {
    if (!usadas.includes(v)) return;
    for (const u of unidades) if (!u[campo]) avisos.push(`A unidade ${u.cidade} está sem ${rotulo}. Preencha em "Clínica".`);
  };
  exige('maps', 'maps', 'link do Google Maps'); exige('avaliacao', 'avaliacao', 'link de avaliação do Google');
  if (usadas.includes('instagram') && !clin.instagram) avisos.push('Instagram não cadastrado. Preencha em "Clínica".');
  if (usadas.includes('endereco')) for (const u of unidades) if (!u.endereco) avisos.push(`A unidade ${u.cidade} está sem endereço (será usado só o nome da cidade).`);
  if ((usadas.includes('promocao') || usadas.includes('lista_promocoes') || usadas.includes('desconto')) && !ctx.promocaoId) avisos.push('A mensagem usa promoção, mas nenhuma promoção foi escolhida.');
  if (usadas.includes('procedimento') && !ctx.procedimentoId && !ctx.promocaoId) avisos.push('A mensagem usa {procedimento}, mas nenhum procedimento foi escolhido.');

  for (const v of usadas) {
    if (!VARIAVEIS_PRECO.has(v)) continue;
    const soComPromo = v === 'lista_promocoes' || v === 'desconto';   // sem promoção escolhida essas variáveis ficam vazias
    if (!soComPromo || ctx.promocaoId) motivosCFO.push(`usa {${v}} (preço/desconto)`);
  }
  if (/R\$\s?\d|\d+\s?%\s?(off|de desconto)|gr[aá]tis|gratuit|sorteio|parcel|\d+\s?x\s?(sem juros|de)/i.test(String(texto))) motivosCFO.push('cita valor, desconto, gratuidade, sorteio ou condição de pagamento no texto');
  return { avisos: [...new Set(avisos)], exigeConfirmacaoCFO: motivosCFO.length > 0, motivosCFO: [...new Set(motivosCFO)] };
}

// ── Datas e plano trimestral ─────────────────────────────────────────────────
function pascoa(ano) {   // algoritmo de Meeus/Jones/Butcher
  const a = ano % 19, b = Math.floor(ano / 100), c = ano % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25),
    g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4,
    l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451),
    mes = Math.floor((h + l - 7 * m + 114) / 31), dia = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(ano, mes - 1, dia);
}
function nesimoDia(ano, mes0, diaSemana, n) {   // n-ésimo dia da semana do mês (0=domingo)
  const d = new Date(ano, mes0, 1); const ate = (diaSemana - d.getDay() + 7) % 7;
  return new Date(ano, mes0, 1 + ate + (n - 1) * 7);
}
function dataDe(regra, ano) {
  if (/^\d{2}-\d{2}$/.test(regra)) { const [m, d] = regra.split('-').map(Number); return new Date(ano, m - 1, d); }
  if (regra === 'pascoa') return pascoa(ano);
  if (regra === 'maes') return nesimoDia(ano, 4, 0, 2);
  if (regra === 'pais') return nesimoDia(ano, 7, 0, 2);
  if (regra === 'bf') return nesimoDia(ano, 10, 5, 4);
  return null;
}
const trimestreDe = d => Math.floor(d.getMonth() / 3) + 1;
function nomeTrimestre(ano, t) { const m0 = (t - 1) * 3; const n = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']; return `${t}º trimestre ${ano} (${n[m0]}–${n[m0 + 2]})`; }

function datasDoTrimestre(ano, t) {
  return DATAS.map(([id, nome, regra]) => ({ id, nome, data: dataDe(regra, ano) }))
    .filter(x => x.data && trimestreDe(x.data) === t)
    .sort((a, b) => a.data - b.data)
    .map(x => ({ id: x.id, nome: x.nome, dataEvento: iso(x.data) }));
}

/** Cria (sem duplicar) as ações sugeridas do trimestre: uma por data comemorativa, enviando X dias antes. */
function gerarPlano(ano, t, agora = new Date()) {
  const clin = ler('clinica'), plano = ler('plano'), periodo = `${ano}-T${t}`;
  let novas = 0;
  for (const d of datasDoTrimestre(ano, t)) {
    const id = `${periodo}-${d.id}`;
    if (plano.acoes.some(a => a.id === id)) continue;
    const ev = new Date(`${d.dataEvento}T00:00:00`);
    let envio = new Date(ev); envio.setDate(envio.getDate() - clin.antecedenciaDias);
    const [h, m] = clin.horaPadrao.split(':').map(Number); envio.setHours(h, m, 0, 0);
    if (envio < agora) { envio = new Date(ev); envio.setHours(h, m, 0, 0); }          // já passou da antecedência: envia no dia
    plano.acoes.push({
      id, periodo, nome: d.nome, dataEvento: d.dataEvento, enviarEm: `${iso(envio)}T${pad2(envio.getHours())}:${pad2(envio.getMinutes())}`,
      modeloId: `data-${d.id}`, promocaoId: '', unidadeId: 'auto', status: 'sugerida', atrasada: ev < new Date(agora.getFullYear(), agora.getMonth(), agora.getDate()),
    });
    novas++;
  }
  gravar('plano', plano);
  return { periodo, novas };
}

function salvarAcao(id, patch) {
  const plano = ler('plano'), a = plano.acoes.find(x => x.id === id);
  if (!a) throw new Error('Ação não encontrada.');
  const modelos = ler('modelos'), promos = ler('promocoes'), clin = ler('clinica');
  if (patch.modeloId !== undefined) { if (!modelos.some(m => m.id === patch.modeloId)) throw new Error('Modelo inválido.'); a.modeloId = patch.modeloId; }
  if (patch.promocaoId !== undefined) { if (patch.promocaoId && !promos.itens.some(p => p.id === patch.promocaoId)) throw new Error('Promoção inválida.'); a.promocaoId = patch.promocaoId; }
  if (patch.unidadeId !== undefined) { if (patch.unidadeId !== 'auto' && !clin.unidades.some(u => u.id === patch.unidadeId)) throw new Error('Unidade inválida.'); a.unidadeId = patch.unidadeId; }
  if (patch.enviarEm !== undefined) { if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(patch.enviarEm) || Number.isNaN(Date.parse(patch.enviarEm))) throw new Error('Data/hora inválida.'); a.enviarEm = patch.enviarEm; }
  if (patch.status !== undefined) a.status = patch.status;
  if (patch.agendamentoId !== undefined) a.agendamentoId = patch.agendamentoId;
  gravar('plano', plano);
  return a;
}

/** Texto final de uma ação (modelo + contexto) — usado na hora do envio, com preços/links atuais. */
function montarDaAcao(a) {
  const modelo = ler('modelos').find(m => m.id === a.modeloId);
  if (!modelo) throw new Error('Modelo da mensagem não existe mais.');
  const clin = ler('clinica');
  const un = a.unidadeId === 'auto' ? clin.unidades : clin.unidades.filter(u => u.id === a.unidadeId);
  const ddds = [...new Set(un.flatMap(u => u.ddds))];
  const abertura = (DATAS.find(d => `data-${d[0]}` === a.modeloId) || [])[3] || '';
  return {
    nome: `${a.nome} ${a.periodo || ''}`.trim(), mensagem: modelo.texto.replace('{abertura}', abertura),
    contexto: { unidadeId: a.unidadeId, promocaoId: a.promocaoId },
    publico: { modo: 'filtro', filtros: { ddds, ocultarImpedidos: true }, excluidos: [] },
  };
}

function visaoGeral(ano) {
  const modelos = ler('modelos');
  return {
    clinica: ler('clinica'), precos: ler('precos'), promocoes: ler('promocoes'), modelos,
    plano: ler('plano'), variaveis: [...VARIAVEIS_CONTATO, ...VARIAVEIS_CRM].filter(v => v !== 'abertura'),
    trimestres: [1, 2, 3, 4].map(t => ({ t, id: `${ano}-T${t}`, nome: nomeTrimestre(ano, t), datas: datasDoTrimestre(ano, t) })),
    ano,
  };
}

function restaurarModelosPadrao() {
  const atuais = ler('modelos'), padrao = padraoModelos();
  const editados = atuais.filter(m => !m.padrao);
  gravar('modelos', [...padrao, ...editados.filter(m => !padrao.some(p => p.id === m.id))]);
}

module.exports = {
  ler, gravar, sanear, extrasPara, avaliarMensagem, precoPromocional, detalhePromocao, textoListaPromocoes,
  datasDoTrimestre, gerarPlano, salvarAcao, montarDaAcao, visaoGeral, restaurarModelosPadrao, padraoModelos, padraoClinica,
  VARIAVEIS_CONTATO, VARIAVEIS_CRM, DATAS, brl, pascoa,
};
