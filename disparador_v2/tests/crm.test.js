'use strict';
// Testes que NÃO gravam nada em config/ (só funções puras e leitura).
const test   = require('node:test');
const assert = require('node:assert');
const crm    = require('../src/crm');
const camp   = require('../src/campanhas');

const dia = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

test('datas móveis: Páscoa, Dia das Mães, Dia dos Pais e Black Friday de 2026', () => {
  assert.strictEqual(dia(crm.pascoa(2026)), '2026-04-05');
  const t2 = crm.datasDoTrimestre(2026, 2).map(d => [d.id, d.dataEvento]);
  assert.deepStrictEqual(t2.find(x => x[0] === 'dia-maes'), ['dia-maes', '2026-05-10']);
  assert.deepStrictEqual(crm.datasDoTrimestre(2026, 3).find(x => x.id === 'dia-pais'), { id: 'dia-pais', nome: 'Dia dos Pais', dataEvento: '2026-08-09' });
  assert.strictEqual(crm.datasDoTrimestre(2026, 4).find(x => x.id === 'black-friday').dataEvento, '2026-11-27');
});

test('cada data comemorativa cai em exatamente um trimestre', () => {
  const todas = [1, 2, 3, 4].flatMap(t => crm.datasDoTrimestre(2027, t).map(d => d.id));
  assert.strictEqual(new Set(todas).size, crm.DATAS.length);
});

test('preço promocional: percentual e valor fixo', () => {
  assert.strictEqual(crm.precoPromocional({ preco: 200 }, { tipo: 'percent', valor: 25 }), 150);
  assert.strictEqual(crm.precoPromocional({ preco: 200 }, { tipo: 'valor', valor: 149.9 }), 149.9);
});

test('sanear: valida unidade, links e preços', () => {
  const c = crm.sanear('clinica', { nome: 'X', instagram: '@dra.teste', unidades: [{ cidade: 'Pato Branco', uf: 'pr', maps: 'javascript:alert(1)', ddds: '46, 49, abc' }] });
  assert.strictEqual(c.instagram, 'https://www.instagram.com/dra.teste/');
  assert.strictEqual(c.unidades[0].maps, '');            // link perigoso descartado
  assert.deepStrictEqual(c.unidades[0].ddds, ['46', '49']);
  assert.throws(() => crm.sanear('clinica', { nome: 'X', unidades: [] }), /unidade/i);
  const p = crm.sanear('precos', { procedimentos: [{ nome: 'Limpeza', preco: '150,50' }, { nome: '', preco: 5 }] });
  assert.deepStrictEqual(p.procedimentos.map(x => [x.id, x.preco]), [['limpeza', 150.5]]);
});

test('avaliarMensagem: variável inexistente, e trava CFO para preço/desconto', () => {
  const a = crm.avaliarMensagem('Olá {nome}, {nada_aqui}!', {});
  assert.ok(a.avisos.some(x => /nada_aqui/.test(x)));
  assert.strictEqual(a.exigeConfirmacaoCFO, false);
  assert.strictEqual(crm.avaliarMensagem('Limpeza por R$ 99', {}).exigeConfirmacaoCFO, true);
  assert.strictEqual(crm.avaliarMensagem('Ganhe {desconto} de desconto', { promocaoId: 'x' }).exigeConfirmacaoCFO, true);
  assert.strictEqual(crm.avaliarMensagem('{lista_promocoes}', {}).exigeConfirmacaoCFO, false);   // sem promoção escolhida a variável fica vazia
  assert.strictEqual(crm.avaliarMensagem('Clínica nova no bairro, venha conhecer!', {}).exigeConfirmacaoCFO, false);
});

test('criarCampanha recusa mensagem com preço sem confirmação do CFO', () => {
  assert.throws(() => camp.criarCampanha({ nome: 'Teste', mensagem: 'Clareamento por R$ 300', publico: { modo: 'numeros', numeros: '16 99111-2222' } }), /CFO/);
});

test('renderizarMensagem com variáveis do CRM e variável desconhecida preservada', () => {
  const t = camp.renderizarMensagem('Oi {nome}! {cidade} {xyz}', { nome: 'ana', ddd: '46' }, new Date(), () => ({ cidade: 'Pato Branco' }));
  assert.strictEqual(t, 'Oi Ana! Pato Branco {xyz}');
});
