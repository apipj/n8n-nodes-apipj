import type {
	IDataObject,
	IExecuteFunctions,
	IHttpRequestOptions,
	IN8nHttpFullResponse,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError, sleep } from 'n8n-workflow';

export const BASE_URL = 'https://apipj.com.br';
/** Mantenha igual ao "version" do package.json (usado só no User-Agent). */
export const VERSAO = '0.1.0';

export const LINK_CRIAR_CONTA = 'https://apipj.com.br/criar-conta';
export const LINK_ASSINAR_DEV = 'https://apipj.com.br/painel?assinar=dev';
export const LINK_ASSINAR_PRO = 'https://apipj.com.br/painel?assinar=pro';

/** Repetições depois da primeira tentativa (429 rate_limited, 5xx e falha de rede). */
const MAX_REPETICOES = 3;
/** Teto de espera por um Retry-After, em segundos (o limite do apipj é por minuto). */
const MAX_ESPERA_S = 65;
const TIMEOUT_MS = 15000;

export interface RespostaApipj {
	statusCode: number;
	body: IDataObject;
}

function comoObjeto(body: unknown): IDataObject {
	if (body && typeof body === 'object' && !Array.isArray(body)) return body as IDataObject;
	if (typeof body === 'string' && body.length > 0) {
		try {
			const parsed = JSON.parse(body) as unknown;
			if (parsed && typeof parsed === 'object' && !Array.isArray(parsed))
				return parsed as IDataObject;
		} catch {
			// corpo não é JSON (por exemplo página HTML de um proxy); devolvido como texto abaixo
		}
		return { message: body.slice(0, 500) };
	}
	return {};
}

function segundosRetryAfter(valor: unknown, corpo: IDataObject): number {
	const bruto = Array.isArray(valor) ? valor[0] : valor;
	if (bruto !== undefined && bruto !== null && bruto !== '') {
		const n = Number(bruto);
		if (Number.isFinite(n)) return Math.min(MAX_ESPERA_S, Math.max(0, n));
		const data = Date.parse(String(bruto));
		if (Number.isFinite(data)) {
			return Math.min(MAX_ESPERA_S, Math.max(0, Math.ceil((data - Date.now()) / 1000)));
		}
	}
	const doCorpo = Number(corpo.retry_after);
	if (Number.isFinite(doCorpo) && doCorpo >= 0) return Math.min(MAX_ESPERA_S, doCorpo);
	return 1;
}

function cabecalho(res: IN8nHttpFullResponse, nome: string): unknown {
	const headers = (res.headers ?? {}) as IDataObject;
	const chave = Object.keys(headers).find((k) => k.toLowerCase() === nome);
	return chave === undefined ? undefined : headers[chave];
}

/**
 * Faz um GET na API do apipj.
 *
 * - `autenticar: true` usa a credencial `apipjApi` (header Authorization: Bearer).
 * - Devolve a resposta para 2xx e para 404 `not_found` (quem chama decide o que fazer).
 * - 429 `rate_limited`: espera o Retry-After e tenta de novo (até 3 vezes).
 * - 429 `quota_exceeded`: não repete; erro com o link para assinar um plano maior.
 * - 5xx e falha de rede: tenta de novo com espera de 1 s, 2 s e 4 s.
 */
export async function apipjRequest(
	this: IExecuteFunctions,
	caminho: string,
	{ autenticar = false, qs }: { autenticar?: boolean; qs?: IDataObject },
	itemIndex: number,
): Promise<RespostaApipj> {
	const options: IHttpRequestOptions = {
		method: 'GET',
		url: `${BASE_URL}${caminho}`,
		qs,
		headers: {
			Accept: 'application/json',
			'User-Agent': `n8n-nodes-apipj/${VERSAO}`,
		},
		json: true,
		returnFullResponse: true,
		ignoreHttpStatusErrors: true,
		timeout: TIMEOUT_MS,
	};

	for (let tentativa = 0; ; tentativa++) {
		const podeRepetir = tentativa < MAX_REPETICOES;
		let res: IN8nHttpFullResponse;
		try {
			res = autenticar
				? ((await this.helpers.httpRequestWithAuthentication.call(
						this,
						'apipjApi',
						options,
					)) as IN8nHttpFullResponse)
				: ((await this.helpers.httpRequest(options)) as IN8nHttpFullResponse);
		} catch (error) {
			if (podeRepetir) {
				await sleep(1000 * 2 ** tentativa);
				continue;
			}
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				itemIndex,
				message: 'A API do apipj não respondeu',
				description:
					'Não foi possível falar com https://apipj.com.br depois de 4 tentativas. Verifique a conexão de saída do n8n e tente de novo em alguns minutos.',
			});
		}

		const statusCode = res.statusCode;
		const body = comoObjeto(res.body);
		const code = typeof body.code === 'string' ? body.code : '';
		const mensagemApi = typeof body.message === 'string' ? body.message : '';

		if (statusCode >= 200 && statusCode < 300) return { statusCode, body };
		if (statusCode === 404 && code === 'not_found') return { statusCode, body };

		if (statusCode === 429 && code === 'quota_exceeded') {
			const upgrade = typeof body.upgrade_url === 'string' ? body.upgrade_url : LINK_ASSINAR_DEV;
			throw new NodeApiError(this.getNode(), body as JsonObject, {
				itemIndex,
				httpCode: '429',
				message: 'A cota mensal de consultas do seu plano apipj acabou',
				description: `Para continuar consultando agora, assine um plano maior: Dev (R$ 12,90/mês, 200.000 consultas) em ${upgrade} ou Pro (R$ 59,90/mês, 600.000 consultas) em ${LINK_ASSINAR_PRO}. A cota renova no início do próximo mês. Validar CNPJ e Status da base continuam funcionando sem cota.`,
			});
		}

		if (statusCode === 429) {
			if (podeRepetir) {
				await sleep(segundosRetryAfter(cabecalho(res, 'retry-after'), body) * 1000);
				continue;
			}
			throw new NodeApiError(this.getNode(), body as JsonObject, {
				itemIndex,
				httpCode: '429',
				message: 'Limite de consultas por minuto do plano apipj atingido',
				description: `O node esperou o tempo pedido pela API e tentou de novo 3 vezes. Reduza o ritmo (por exemplo com o node Loop Over Items + Wait) ou assine um plano com mais consultas por minuto: Dev (30/min) em ${LINK_ASSINAR_DEV} ou Pro (200/min) em ${LINK_ASSINAR_PRO}. O plano grátis permite 10 consultas por minuto.`,
			});
		}

		if (statusCode >= 500 && podeRepetir) {
			await sleep(1000 * 2 ** tentativa);
			continue;
		}

		if (statusCode === 401) {
			throw new NodeApiError(this.getNode(), body as JsonObject, {
				itemIndex,
				httpCode: '401',
				message: 'A chave de API do apipj foi recusada',
				description: `${mensagemApi ? `${mensagemApi}. ` : ''}Confira a chave na credencial 'Apipj API' (ela começa com apipj_live_). Se ainda não tem uma, crie uma conta grátis em ${LINK_CRIAR_CONTA}.`,
			});
		}

		if (statusCode === 400) {
			throw new NodeApiError(this.getNode(), body as JsonObject, {
				itemIndex,
				httpCode: '400',
				message: mensagemApi || 'A API do apipj recusou o pedido',
				description: `Confira o valor do campo 'CNPJ' (código da API: ${code || 'bad_request'}).`,
			});
		}

		throw new NodeApiError(this.getNode(), body as JsonObject, {
			itemIndex,
			httpCode: String(statusCode),
			message: mensagemApi || `A API do apipj respondeu HTTP ${statusCode}`,
			description:
				statusCode >= 500
					? 'A API do apipj está instável no momento (o node já tentou 4 vezes). Veja https://apipj.com.br/v1/status e tente de novo em alguns minutos.'
					: `Código da API: ${code || 'desconhecido'}.`,
		});
	}
}
