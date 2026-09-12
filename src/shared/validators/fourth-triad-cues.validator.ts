import { ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface } from 'class-validator'

import { buildFourthTriadReceipt, formatFourthTriadReceipt } from './fourth-triad-receipt'

interface TriadInputDto {
	keyword: string
	fullPhrases: string[]
}

interface TriadGroupInputObject {
	triad1?: TriadInputDto
	triad2?: TriadInputDto
	triad3?: TriadInputDto
	triad4?: TriadInputDto
}

@ValidatorConstraint({ name: 'isFourthTriadCuesValid', async: false })
export class IsFourthTriadCuesValidConstraint implements ValidatorConstraintInterface {
	validate(value: unknown, args: ValidationArguments): boolean {
		const object = args.object as TriadGroupInputObject
		const triad1 = object.triad1
		const triad2 = object.triad2
		const triad3 = object.triad3
		const triad4 = object.triad4

		// Ensure all triads exist
		if (!triad1 || !triad2 || !triad3 || !triad4) {
			return false
		}

		return buildFourthTriadReceipt([triad1.keyword, triad2.keyword, triad3.keyword], triad4).valid
	}

	defaultMessage(args: ValidationArguments): string {
		const object = args.object as TriadGroupInputObject
		const receipt = buildFourthTriadReceipt([object.triad1?.keyword ?? '', object.triad2?.keyword ?? '', object.triad3?.keyword ?? ''], {
			keyword: object.triad4?.keyword ?? '',
			fullPhrases: object.triad4?.fullPhrases ?? [],
		})
		return `Triad 4 receipt failed: ${formatFourthTriadReceipt(receipt)}`
	}
}
