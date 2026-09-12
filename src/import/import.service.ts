import { Injectable, Logger } from '@nestjs/common'
import { Difficulty } from '@prisma/client'
import * as XLSX from 'xlsx'

import { PrismaService } from '../prisma/prisma.service'
import { buildFourthTriadReceipt, formatFourthTriadReceipt } from '../shared/validators/fourth-triad-receipt'

interface ImportTriad {
	keyword: string
	fullPhrases: string[]
	cues: string[]
}

interface ImportTriadGroup {
	difficulty: Difficulty
	triads: [ImportTriad, ImportTriad, ImportTriad, ImportTriad]
}

@Injectable()
export class ImportService {
	private readonly logger = new Logger(ImportService.name)

	constructor(private readonly prismaService: PrismaService) {}

	/**
	 * Maps sheet name to Difficulty enum value (case-insensitive)
	 * @param sheetName - The name of the Excel sheet
	 * @returns Difficulty enum value or null if sheet name doesn't match
	 */
	private mapSheetNameToDifficulty(sheetName: string): Difficulty | null {
		const normalizedName = sheetName.toLowerCase().trim()
		switch (normalizedName) {
			case 'easy':
				return Difficulty.EASY
			case 'medium':
				return Difficulty.MEDIUM
			case 'hard':
				return Difficulty.HARD
			default:
				return null
		}
	}

	async importTriadsFromExcel(file: Express.Multer.File) {
		// Validate file size to prevent memory issues (limit to 10MB)
		const maxFileSize = 10 * 1024 * 1024 // 10MB
		if (file.buffer.length > maxFileSize) {
			throw new Error('File size exceeds maximum allowed size of 10MB')
		}

		let workbook: XLSX.WorkBook | null = null
		try {
			// Read the Excel file with memory-efficient options
			workbook = XLSX.read(file.buffer, {
				type: 'buffer',
				cellDates: false, // Don't parse dates to reduce memory
				cellNF: false, // Don't parse number formats
				cellStyles: false, // Don't parse styles
			})

			if (!workbook.SheetNames || workbook.SheetNames.length === 0) {
				throw new Error('Excel file does not contain any worksheets')
			}

			// Track statistics per difficulty level
			const stats = {
				easy: 0,
				medium: 0,
				hard: 0,
				total: 0,
			}
			const stagedTriadGroups: ImportTriadGroup[] = []

			// Process each sheet in the workbook
			for (const sheetName of workbook.SheetNames) {
				const difficulty = this.mapSheetNameToDifficulty(sheetName)

				// Skip sheets that don't match Easy/Medium/Hard
				if (!difficulty) {
					this.logger.warn(`Skipping sheet "${sheetName}" - not a recognized difficulty level (Easy/Medium/Hard)`)
					continue
				}

				const worksheet = workbook.Sheets[sheetName]
				if (!worksheet) {
					this.logger.warn(`Sheet "${sheetName}" exists but has no data`)
					continue
				}

				const data = XLSX.utils.sheet_to_json<Record<string, string>>(worksheet, { header: 'A' })

				// Limit processing to prevent memory issues
				const maxRows = 10000
				if (data.length > maxRows) {
					this.logger.warn(`Sheet "${sheetName}" contains ${data.length} rows, processing only first ${maxRows} rows`)
				}

				let importedGroupCount = 0
				let currentTriads: ImportTriad[] = []
				const rowsToProcess = Math.min(data.length, maxRows)

				// Process each row in the current sheet
				for (let i = 0; i < rowsToProcess; i++) {
					const row = data[i]

					// Skip empty rows
					if (!row.A || row.A.toString().trim() === '') continue

					// Convert to uppercase
					const keyword = row.A.toString().trim().toUpperCase()
					const phrase1 = row.B ? row.B.toString().trim().toUpperCase() : ''
					const phrase2 = row.C ? row.C.toString().trim().toUpperCase() : ''
					const phrase3 = row.D ? row.D.toString().trim().toUpperCase() : ''

					// Build a complete triad before any database write.
					const fullPhrases = [phrase1, phrase2, phrase3].filter(Boolean)
					if (fullPhrases.length !== 3) {
						throw new Error(`Sheet "${sheetName}" row ${i + 1} must contain exactly three full phrases`)
					}
					if (!fullPhrases.every((phrase) => phrase.includes(keyword))) {
						throw new Error(`Sheet "${sheetName}" row ${i + 1} has a full phrase that does not contain keyword "${keyword}"`)
					}

					currentTriads.push({
						keyword,
						fullPhrases,
						cues: fullPhrases.map((phrase) => phrase.replace(keyword, '').trim()),
					})

					// Every fourth row is the final triad. Prove its one-to-one links before writes.
					if (currentTriads.length === 4) {
						const [triad1, triad2, triad3, triad4] = currentTriads as ImportTriadGroup['triads']
						const receipt = buildFourthTriadReceipt([triad1.keyword, triad2.keyword, triad3.keyword], triad4)
						if (!receipt.valid) {
							throw new Error(`Sheet "${sheetName}" rows ${i - 2}-${i + 1} have an invalid Triad 4 receipt: ${formatFourthTriadReceipt(receipt)}`)
						}

						triad4.cues = receipt.matches.map((match) => match.keyword)
						stagedTriadGroups.push({ difficulty, triads: [triad1, triad2, triad3, triad4] })
						importedGroupCount++

						// Update statistics
						stats.total++
						if (difficulty === Difficulty.EASY) {
							stats.easy++
						} else if (difficulty === Difficulty.MEDIUM) {
							stats.medium++
						} else if (difficulty === Difficulty.HARD) {
							stats.hard++
						}

						currentTriads = [] // Reset for next group
					}
				}

				if (currentTriads.length > 0) {
					throw new Error(`Sheet "${sheetName}" ends with an incomplete triad group`)
				}

				this.logger.log(`Validated sheet "${sheetName}" (${difficulty}): ${importedGroupCount} triad groups`)
			}

			// Validate that at least one valid sheet was processed
			if (stats.total === 0) {
				throw new Error('No valid sheets found. Expected sheets named Easy, Medium, or Hard (case-insensitive)')
			}

			await this.prismaService.$transaction(async (transaction) => {
				for (const { difficulty, triads } of stagedTriadGroups) {
					const createdTriads: { id: number }[] = []
					for (const triad of triads) {
						createdTriads.push(
							await transaction.triad.create({
								data: triad,
							}),
						)
					}

					await transaction.triadGroup.create({
						data: {
							triad1Id: createdTriads[0].id,
							triad2Id: createdTriads[1].id,
							triad3Id: createdTriads[2].id,
							triad4Id: createdTriads[3].id,
							difficulty,
						},
					})
				}
			})

			// Explicitly clear workbook from memory
			workbook = null

			return {
				success: true,
				message: `Imported ${stats.total} triad groups successfully (Easy: ${stats.easy}, Medium: ${stats.medium}, Hard: ${stats.hard})`,
				statistics: {
					total: stats.total,
					easy: stats.easy,
					medium: stats.medium,
					hard: stats.hard,
				},
			}
		} catch (error) {
			this.logger.error(`Error importing triads: ${error}`)
			// Ensure workbook is cleared even on error
			workbook = null
			throw error
		}
	}
}
