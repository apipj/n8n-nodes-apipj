// Local CNPJ validation (numeric and alphanumeric, IN RFB 2.229/2024), same as the official apipj-js client:
// - 14 characters: positions 1 to 12 in [A-Z0-9], positions 13 and 14 (check digits) numeric;
// - value of each character = ASCII code - 48 ('0'..'9' => 0..9, 'A'..'Z' => 17..42);
// - first check digit with weights 5,4,3,2,9,8,7,6,5,4,3,2; second with 6,5,4,3,2,9,8,7,6,5,4,3,2;
// - remainder = sum % 11; digit = 0 if remainder < 2, else 11 - remainder;
// - '00000000000000' is invalid even though its check digits match.

const WEIGHTS = [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
const CNPJ_PATTERN = /^[A-Z0-9]{12}[0-9]{2}$/;

/**
 * Strips everything that is not [0-9A-Za-z] and uppercases the rest.
 * A number (e.g. from a spreadsheet that dropped the leading zeros) is left-padded with zeros to 14 digits.
 */
export function normalizeCnpj(input: unknown): string {
	if (input === null || input === undefined) return '';
	if (typeof input === 'number' && Number.isInteger(input) && input >= 0) {
		return String(input).padStart(14, '0');
	}
	return String(input)
		.replace(/[^0-9A-Za-z]/g, '')
		.toUpperCase();
}

export function computeCheckDigits(base12: string): string {
	let s1 = 0;
	let s2 = 0;
	for (let i = 0; i < 12; i++) {
		const v = base12.charCodeAt(i) - 48;
		s1 += v * WEIGHTS[i + 1];
		s2 += v * WEIGHTS[i];
	}
	const dv1 = s1 % 11 < 2 ? 0 : 11 - (s1 % 11);
	s2 += dv1 * WEIGHTS[12];
	const dv2 = s2 % 11 < 2 ? 0 : 11 - (s2 % 11);
	return `${dv1}${dv2}`;
}

/** Returns `null` if the normalized CNPJ is valid, or the reason why it is not. */
export function invalidCnpjReason(cnpj: string): string | null {
	if (cnpj.length === 0) return 'the CNPJ is empty';
	if (cnpj.length !== 14) return `a CNPJ has 14 characters (got ${cnpj.length})`;
	if (!CNPJ_PATTERN.test(cnpj)) {
		return 'the last two characters (check digits) must be numeric';
	}
	if (cnpj === '00000000000000') return 'an all-zero CNPJ is not valid';
	if (cnpj.slice(12) !== computeCheckDigits(cnpj.slice(0, 12))) {
		return 'the check digits do not match';
	}
	return null;
}
