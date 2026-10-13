// Validação local de CNPJ (numérico e alfanumérico, IN RFB 2.229/2024), igual ao cliente oficial apipj-js:
// - 14 caracteres: posições 1 a 12 em [A-Z0-9], posições 13 e 14 (dígitos verificadores) numéricas;
// - valor de cada caractere = código ASCII - 48 ('0'..'9' => 0..9, 'A'..'Z' => 17..42);
// - DV1 com pesos 5,4,3,2,9,8,7,6,5,4,3,2 e DV2 com pesos 6,5,4,3,2,9,8,7,6,5,4,3,2;
// - resto = soma % 11; DV = 0 se resto < 2, senão 11 - resto;
// - '00000000000000' é inválido mesmo com o DV "certo".

const PESOS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const RE_CNPJ = /^[A-Z0-9]{12}[0-9]{2}$/;

/**
 * Remove tudo que não for [0-9A-Za-z] e converte para maiúsculas.
 * Um número (por exemplo vindo de planilha, sem os zeros à esquerda) é completado com zeros até 14 dígitos.
 */
export function normalizarCnpj(entrada: unknown): string {
	if (entrada === null || entrada === undefined) return '';
	if (typeof entrada === 'number' && Number.isInteger(entrada) && entrada >= 0) {
		return String(entrada).padStart(14, '0');
	}
	return String(entrada)
		.replace(/[^0-9A-Za-z]/g, '')
		.toUpperCase();
}

export function calcularDv(base12: string): string {
	let s1 = 0;
	let s2 = 0;
	for (let i = 0; i < 12; i++) {
		const v = base12.charCodeAt(i) - 48;
		s1 += v * PESOS[i + 1];
		s2 += v * PESOS[i];
	}
	const dv1 = s1 % 11 < 2 ? 0 : 11 - (s1 % 11);
	s2 += dv1 * PESOS[12];
	const dv2 = s2 % 11 < 2 ? 0 : 11 - (s2 % 11);
	return `${dv1}${dv2}`;
}

/** Devolve `null` se o CNPJ normalizado é válido, ou o motivo (em português) se não é. */
export function motivoCnpjInvalido(cnpj: string): string | null {
	if (cnpj.length === 0) return 'o CNPJ está vazio';
	if (cnpj.length !== 14) return `o CNPJ deve ter 14 caracteres (recebido ${cnpj.length})`;
	if (!RE_CNPJ.test(cnpj)) {
		return 'os dois últimos caracteres (dígitos verificadores) devem ser numéricos';
	}
	if (cnpj === '00000000000000') return 'CNPJ zerado não é válido';
	if (cnpj.slice(12) !== calcularDv(cnpj.slice(0, 12))) {
		return 'os dígitos verificadores não conferem';
	}
	return null;
}
