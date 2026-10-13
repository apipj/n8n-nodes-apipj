// Tests for the node's execute() with a mocked IExecuteFunctions.
//
//   npm run build && npm test
//
// - Mock tests: simulated HTTP responses (429 rate_limited, quota_exceeded, 404, 5xx, continueOnFail).
// - Real API tests: call https://apipj.com.br and only run with APIPJ_TESTE_REAL=1. Validate and Status need no key;
//   Look Up also needs APIPJ_KEY (the node itself never reads environment variables; only this test harness does).
//
//   APIPJ_TESTE_REAL=1 APIPJ_KEY=apipj_live_... npm test
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { test } from 'node:test';

const require = createRequire(import.meta.url);
const { Apipj } = require('../dist/nodes/Apipj/Apipj.node.js');
const { normalizeCnpj, invalidCnpjReason } = require('../dist/nodes/Apipj/shared/cnpj.js');

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
					if (!chave) throw new Error('APIPJ_KEY not set');
					return registrar({ ...o, headers: { ...o.headers, Authorization: `Bearer ${chave}` } }, true);
				},
			},
		},
	};
}

const executar = (ctx) => new Apipj().execute.call(ctx);
const REAL = process.env.APIPJ_TESTE_REAL === '1' ? false : 'set APIPJ_TESTE_REAL=1 to call the real API';

// ------------------------------------------------------------------ local

test('normalizes and validates numeric and alphanumeric CNPJs', () => {
	assert.equal(normalizeCnpj('12.abc.345/01de-35'), '12ABC34501DE35');
	assert.equal(normalizeCnpj(191), '00000000000191');
	assert.equal(invalidCnpjReason('12ABC34501DE35'), null);
	assert.equal(invalidCnpjReason('00000000000191'), null);
	assert.match(invalidCnpjReason('11222333000100'), /check digits/);
	assert.match(invalidCnpjReason('00000000000000'), /all-zero/);
	assert.match(invalidCnpjReason('123'), /14 characters/);
});

// ------------------------------------------------------------------ mock

const resp = (statusCode, body, headers = {}) => ({ statusCode, body, headers });

test('429 rate_limited: waits for Retry-After and retries', async () => {
	const fila = [resp(429, { status: 'ERROR', code: 'rate_limited' }, { 'retry-after': '1' }), resp(200, { razao_social: 'X' })];
	const { ctx, chamadas } = criarContexto({
		itens: [{}],
		params: { operation: 'lookup', cnpj: '00000000000191', format: 'simplified' },
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

test('429 rate_limited: gives up after 3 retries', async () => {
	const { ctx, chamadas } = criarContexto({
		itens: [{}],
		params: { operation: 'lookup', cnpj: '00000000000191' },
		http: async () => resp(429, { code: 'rate_limited' }, { 'retry-after': '0' }),
		chave: 'teste',
	});
	await assert.rejects(executar(ctx), (e) => {
		assert.equal(e.constructor.name, 'NodeApiError');
		assert.match(e.message, /per-minute/);
		assert.match(e.description, /assinar=pro/);
		return true;
	});
	assert.equal(chamadas.length, 4);
});

test('429 quota_exceeded: no retry, points to the upgrade link', async () => {
	const { ctx, chamadas } = criarContexto({
		itens: [{}],
		params: { operation: 'lookup', cnpj: '00000000000191' },
		http: async () => resp(429, { status: 'ERROR', code: 'quota_exceeded', message: 'Cota mensal esgotada' }),
		chave: 'teste',
	});
	await assert.rejects(executar(ctx), (e) => {
		assert.equal(e.constructor.name, 'NodeApiError');
		assert.match(e.message, /monthly lookup quota/);
		assert.match(e.description, /https:\/\/apipj\.com\.br\/painel\?assinar=dev/);
		assert.equal(e.httpCode, '429');
		return true;
	});
	assert.equal(chamadas.length, 1);
});

test('404 not_found: fails by default, { found: false } with Continue If Not Found', async () => {
	const http = async () => resp(404, { status: 'ERROR', code: 'not_found' });
	const base = { operation: 'lookup', cnpj: '11.222.333/0001-81' };
	const a = criarContexto({ itens: [{}], params: base, http, chave: 'teste' });
	await assert.rejects(executar(a.ctx), /is not in the Receita Federal dataset/);
	const b = criarContexto({ itens: [{}], params: { ...base, continueIfNotFound: true }, http, chave: 'teste' });
	const [saida] = await executar(b.ctx);
	assert.deepEqual(saida[0].json, { cnpj: '11222333000181', found: false });
});

test('5xx: retries with backoff and returns once the API recovers', async () => {
	const fila = [resp(503, { code: 'dataset_unavailable' }), resp(200, { status: 'OK' })];
	const { ctx, chamadas } = criarContexto({ itens: [{}], params: { operation: 'status' }, http: async () => fila.shift() });
	const [saida] = await executar(ctx);
	assert.equal(chamadas.length, 2);
	assert.equal(saida[0].json.status, 'OK');
});

test('invalid CNPJ skips the API call; continueOnFail returns { error } and goes on', async () => {
	const { ctx, chamadas } = criarContexto({
		itens: [{}, {}],
		params: (i) => ({ operation: 'lookup', cnpj: i === 0 ? '11.222.333/0001-00' : '00000000000191' }),
		http: async () => resp(200, { razao_social: 'BANCO DO BRASIL SA' }),
		chave: 'teste',
		continueOnFail: true,
	});
	const [saida] = await executar(ctx);
	assert.equal(chamadas.length, 1);
	assert.match(saida[0].json.error, /is not a valid CNPJ/);
	assert.deepEqual(saida[0].pairedItem, { item: 0 });
	assert.equal(saida[1].json.razao_social, 'BANCO DO BRASIL SA');
});

test('401: message with the signup link', async () => {
	const { ctx } = criarContexto({
		itens: [{}],
		params: { operation: 'lookup', cnpj: '00000000000191' },
		http: async () => resp(401, { status: 'ERROR', code: 'unauthorized', message: 'Chave de API inválida ou revogada' }),
		chave: 'teste',
	});
	await assert.rejects(executar(ctx), (e) => {
		assert.match(e.message, /rejected/);
		assert.match(e.description, /criar-conta/);
		return true;
	});
});

// ------------------------------------------------------------------ API real

test('real API: Validate CNPJ (no key)', { skip: REAL }, async () => {
	const { ctx, chamadas } = criarContexto({
		itens: [{}, {}],
		params: (i) => ({ operation: 'validate', cnpj: i === 0 ? '12.ABC.345/01DE-35' : '11.222.333/0001-00' }),
		chave: null,
	});
	const [saida] = await executar(ctx);
	assert.ok(chamadas.every((c) => !c.autenticado));
	console.log('validate ->', JSON.stringify(saida.map((s) => s.json)));
	assert.equal(saida[0].json.valido, true);
	assert.equal(saida[0].json.alfanumerico, true);
	assert.equal(saida[0].json.formatado, '12.ABC.345/01DE-35');
	assert.equal(saida[1].json.valido, false);
});

test('real API: Get Dataset Status (no key)', { skip: REAL }, async () => {
	const { ctx } = criarContexto({ itens: [{}], params: { operation: 'status' }, chave: null });
	const [saida] = await executar(ctx);
	console.log('status ->', JSON.stringify(saida[0].json));
	assert.equal(saida[0].json.status, 'OK');
	assert.match(saida[0].json.dataset_month, /^\d{4}-\d{2}$/);
});

test('real API: Look Up CNPJ 00000000000191 (needs APIPJ_KEY)', { skip: REAL || (!process.env.APIPJ_KEY && 'APIPJ_KEY not set') }, async () => {
	const { ctx } = criarContexto({
		itens: [{}],
		params: { operation: 'lookup', cnpj: '00.000.000/0001-91', format: 'full' },
	});
	const [saida] = await executar(ctx);
	console.log('lookup ->', saida[0].json.cnpj, saida[0].json.razao_social, JSON.stringify(saida[0].json.situacao_cadastral));
	assert.equal(saida[0].json.razao_social, 'BANCO DO BRASIL SA');
});
