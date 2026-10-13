// Testes do execute() do node com um IExecuteFunctions simulado.
//
//   npm run build && node --test test/
//
// - Testes "mock": respostas HTTP simuladas (429 rate_limited, quota_exceeded, 404, 5xx, continueOnFail).
// - Testes "real": chamam https://apipj.com.br e só rodam com APIPJ_TESTE_REAL=1. Validar e Status não precisam
//   de chave; Consultar exige também APIPJ_KEY (o node em si nunca lê variáveis de ambiente; só este teste).
//
//   APIPJ_TESTE_REAL=1 APIPJ_KEY=apipj_live_... npm test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { Apipj } = require('../dist/nodes/Apipj/Apipj.node.js');
const { normalizarCnpj, motivoCnpjInvalido } = require('../dist/nodes/Apipj/shared/cnpj.js');

const NODE = { id: 'x', name: 'apipj (CNPJ)', type: 'n8n-nodes-apipj.apipj', typeVersion: 1, position: [0, 0], parameters: {} };

/** httpRequest de verdade (fetch), com a mesma semântica usada pelo node. */
async function httpReal(options) {
	const url = new URL(options.url);
	for (const [k, v] of Object.entries(options.qs ?? {})) url.searchParams.set(k, String(v));
	const res = await fetch(url, { method: options.method, headers: options.headers });
	const texto = await res.text();
	let body = texto;
	try {
		body = JSON.parse(texto);
	} catch {}
	return { statusCode: res.status, headers: Object.fromEntries(res.headers), body };
}

function criarContexto({ itens, params, http = httpReal, chave = process.env.APIPJ_KEY, continueOnFail = false, log }) {
	const chamadas = [];
	const registrar = async (options, autenticado) => {
		chamadas.push({ url: options.url, qs: options.qs, autenticado });
		log?.push(options.url);
		return http(options, autenticado);
	};
	return {
		chamadas,
		ctx: {
			getInputData: () => itens.map((json) => ({ json })),
			getNodeParameter: (nome, i, padrao) => {
				const p = typeof params === 'function' ? params(i) : params;
				return nome in p ? p[nome] : padrao;
			},
			getNode: () => NODE,
			continueOnFail: () => continueOnFail,
			helpers: {
				httpRequest: (o) => registrar(o, false),
				async httpRequestWithAuthentication(credencial, o) {
					assert.equal(credencial, 'apipjApi');
					if (!chave) throw new Error('APIPJ_KEY não definida');
					return registrar({ ...o, headers: { ...o.headers, Authorization: `Bearer ${chave}` } }, true);
				},
			},
		},
	};
}

const executar = (ctx) => new Apipj().execute.call(ctx);
const REAL = process.env.APIPJ_TESTE_REAL === '1' ? false : 'defina APIPJ_TESTE_REAL=1 para chamar a API real';

// ------------------------------------------------------------------ local

test('normaliza e valida CNPJ numérico e alfanumérico', () => {
	assert.equal(normalizarCnpj('12.abc.345/01de-35'), '12ABC34501DE35');
	assert.equal(normalizarCnpj(191), '00000000000191');
	assert.equal(motivoCnpjInvalido('12ABC34501DE35'), null);
	assert.equal(motivoCnpjInvalido('00000000000191'), null);
	assert.match(motivoCnpjInvalido('11222333000100'), /verificadores/);
	assert.match(motivoCnpjInvalido('00000000000000'), /zerado/);
	assert.match(motivoCnpjInvalido('123'), /14 caracteres/);
});

// ------------------------------------------------------------------ mock

const resp = (statusCode, body, headers = {}) => ({ statusCode, body, headers });

test('429 rate_limited: espera Retry-After e repete', async () => {
	const fila = [resp(429, { status: 'ERROR', code: 'rate_limited' }, { 'retry-after': '1' }), resp(200, { razao_social: 'X' })];
	const { ctx, chamadas } = criarContexto({
		itens: [{}],
		params: { operation: 'consultar', cnpj: '00000000000191', formato: 'simplificado' },
		http: async () => fila.shift(),
		chave: 'teste',
	});
	const t0 = Date.now();
	const [saida] = await executar(ctx);
	assert.ok(Date.now() - t0 >= 900, 'esperou ~1 s');
	assert.equal(chamadas.length, 2);
	assert.deepEqual(chamadas[0].qs, { formato: 'simplificado' });
	assert.equal(saida[0].json.razao_social, 'X');
	assert.deepEqual(saida[0].pairedItem, { item: 0 });
});

test('429 rate_limited: desiste depois de 3 repetições', async () => {
	const { ctx, chamadas } = criarContexto({
		itens: [{}],
		params: { operation: 'consultar', cnpj: '00000000000191' },
		http: async () => resp(429, { code: 'rate_limited' }, { 'retry-after': '0' }),
		chave: 'teste',
	});
	await assert.rejects(executar(ctx), (e) => {
		assert.equal(e.constructor.name, 'NodeApiError');
		assert.match(e.message, /por minuto/);
		assert.match(e.description, /assinar=pro/);
		return true;
	});
	assert.equal(chamadas.length, 4);
});

test('429 quota_exceeded: não repete e aponta o upgrade', async () => {
	const { ctx, chamadas } = criarContexto({
		itens: [{}],
		params: { operation: 'consultar', cnpj: '00000000000191' },
		http: async () => resp(429, { status: 'ERROR', code: 'quota_exceeded', message: 'Cota mensal esgotada' }),
		chave: 'teste',
	});
	await assert.rejects(executar(ctx), (e) => {
		assert.equal(e.constructor.name, 'NodeApiError');
		assert.match(e.message, /cota mensal/);
		assert.match(e.description, /https:\/\/apipj\.com\.br\/painel\?assinar=dev/);
		assert.equal(e.httpCode, '429');
		return true;
	});
	assert.equal(chamadas.length, 1);
});

test('404 not_found: erro por padrão, { encontrado: false } com a opção', async () => {
	const http = async () => resp(404, { status: 'ERROR', code: 'not_found' });
	const base = { operation: 'consultar', cnpj: '11.222.333/0001-81' };
	const a = criarContexto({ itens: [{}], params: base, http, chave: 'teste' });
	await assert.rejects(executar(a.ctx), /não está na base/);
	const b = criarContexto({ itens: [{}], params: { ...base, quandoNaoEncontrado: 'continuar' }, http, chave: 'teste' });
	const [saida] = await executar(b.ctx);
	assert.deepEqual(saida[0].json, { cnpj: '11222333000181', encontrado: false });
});

test('5xx: repete com backoff e devolve quando a API volta', async () => {
	const fila = [resp(503, { code: 'dataset_unavailable' }), resp(200, { status: 'OK' })];
	const { ctx, chamadas } = criarContexto({ itens: [{}], params: { operation: 'status' }, http: async () => fila.shift() });
	const [saida] = await executar(ctx);
	assert.equal(chamadas.length, 2);
	assert.equal(saida[0].json.status, 'OK');
});

test('CNPJ inválido não chama a API; continueOnFail devolve { error } e segue', async () => {
	const { ctx, chamadas } = criarContexto({
		itens: [{}, {}],
		params: (i) => ({ operation: 'consultar', cnpj: i === 0 ? '11.222.333/0001-00' : '00000000000191' }),
		http: async () => resp(200, { razao_social: 'BANCO DO BRASIL SA' }),
		chave: 'teste',
		continueOnFail: true,
	});
	const [saida] = await executar(ctx);
	assert.equal(chamadas.length, 1);
	assert.match(saida[0].json.error, /não é um CNPJ válido/);
	assert.deepEqual(saida[0].pairedItem, { item: 0 });
	assert.equal(saida[1].json.razao_social, 'BANCO DO BRASIL SA');
});

test('401: mensagem em português com link para criar conta', async () => {
	const { ctx } = criarContexto({
		itens: [{}],
		params: { operation: 'consultar', cnpj: '00000000000191' },
		http: async () => resp(401, { status: 'ERROR', code: 'unauthorized', message: 'Chave de API inválida ou revogada' }),
		chave: 'teste',
	});
	await assert.rejects(executar(ctx), (e) => {
		assert.match(e.message, /recusada/);
		assert.match(e.description, /criar-conta/);
		return true;
	});
});

// ------------------------------------------------------------------ API real

test('real: Validar CNPJ (sem chave)', { skip: REAL }, async () => {
	const { ctx, chamadas } = criarContexto({
		itens: [{}, {}],
		params: (i) => ({ operation: 'validar', cnpj: i === 0 ? '12.ABC.345/01DE-35' : '11.222.333/0001-00' }),
		chave: null,
	});
	const [saida] = await executar(ctx);
	assert.ok(chamadas.every((c) => !c.autenticado));
	console.log('validar ->', JSON.stringify(saida.map((s) => s.json)));
	assert.equal(saida[0].json.valido, true);
	assert.equal(saida[0].json.alfanumerico, true);
	assert.equal(saida[0].json.formatado, '12.ABC.345/01DE-35');
	assert.equal(saida[1].json.valido, false);
});

test('real: Status da base (sem chave)', { skip: REAL }, async () => {
	const { ctx } = criarContexto({ itens: [{}], params: { operation: 'status' }, chave: null });
	const [saida] = await executar(ctx);
	console.log('status ->', JSON.stringify(saida[0].json));
	assert.equal(saida[0].json.status, 'OK');
	assert.match(saida[0].json.dataset_month, /^\d{4}-\d{2}$/);
});

test('real: Consultar CNPJ 00000000000191 (precisa de APIPJ_KEY)', { skip: REAL || (!process.env.APIPJ_KEY && 'APIPJ_KEY não definida') }, async () => {
	const { ctx } = criarContexto({
		itens: [{}],
		params: { operation: 'consultar', cnpj: '00.000.000/0001-91', formato: 'completo' },
	});
	const [saida] = await executar(ctx);
	console.log('consultar ->', saida[0].json.cnpj, saida[0].json.razao_social, JSON.stringify(saida[0].json.situacao_cadastral));
	assert.equal(saida[0].json.razao_social, 'BANCO DO BRASIL SA');
});
