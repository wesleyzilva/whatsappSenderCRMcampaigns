'use strict';
const test   = require('node:test');
const assert = require('node:assert');
const c      = require('../src/campanhas');

test('normalizarFone aceita formatos BR e rejeita lixo', () => {
  assert.strictEqual(c.normalizarFone('+55 16 99721-4286'), '16997214286');
  assert.strictEqual(c.normalizarFone('(46) 3220-1234'), '4632201234');
  assert.strictEqual(c.normalizarFone('+19176095745'), null);
  assert.strictEqual(c.normalizarFone('12345'), null);
});

test('limparNome remove símbolos e rejeita números', () => {
  assert.strictEqual(c.limparNome('( Jeysi) Jesgiscler'), 'Jeysi Jesgiscler');
  assert.strictEqual(c.limparNome('+1(917)6095745'), '');
  assert.strictEqual(c.limparNome('☆Ronaldo'), 'Ronaldo');
});

test('renderizarMensagem usa primeiro nome e arruma pontuação sem nome', () => {
  const m = '{saudacao}, {nome}! Tudo bem?';
  assert.match(c.renderizarMensagem(m, { nome: 'JOÃO DA SILVA' }), /^(Bom dia|Boa tarde|Boa noite), João! Tudo bem\?$/);
  assert.match(c.renderizarMensagem(m, { nome: '' }), /^(Bom dia|Boa tarde|Boa noite)! Tudo bem\?$/);
});

test('público por números remove inválidos e repetidos', () => {
  const r = c.resolverPublico({ modo: 'numeros', numeros: '16 99721-4286\n(16) 99721-4286\nabc\n46 99912-0042, Maria' });
  assert.strictEqual(r.removidos.invalidos, 1);
  assert.strictEqual(r.removidos.duplicados, 1);
  assert.ok(r.alvos.length >= 1);
});

test('criarCampanha exige nome e mensagem', () => {
  assert.throws(() => c.criarCampanha({ nome: '', mensagem: 'x', publico: { modo: 'numeros', numeros: '' } }), /nome/i);
  assert.throws(() => c.criarCampanha({ nome: 'x', mensagem: '  ', publico: { modo: 'numeros', numeros: '' } }), /mensagem/i);
});

test('lotes diários: 4 zaps × 48 = 192 por lote', () => {
  const cap = { porDia: 192, porZap: 48, zapsAtivos: 4, zapsConectados: 4 };
  const p = c.planejarLotes(400, cap);
  assert.deepStrictEqual([p.porLote, p.lotes, p.ultimoLote], [192, 3, 16]);
  assert.strictEqual(c.planejarLotes(192, cap).lotes, 1);
  assert.strictEqual(c.planejarLotes(193, cap).lotes, 2);
  assert.strictEqual(c.planejarLotes(0, cap).lotes, 0);
});
