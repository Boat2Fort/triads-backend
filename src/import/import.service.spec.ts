import { Difficulty } from '@prisma/client'
import * as XLSX from 'xlsx'

import { PrismaService } from '../prisma/prisma.service'
import { ImportService } from './import.service'

function createWorkbook(rows: string[][]): Buffer {
	const workbook = XLSX.utils.book_new()
	XLSX.utils.book_append_sheet(workbook, XLSX.utils.aoa_to_sheet(rows), 'Easy')
	return XLSX.write(workbook, { type: 'buffer', bookType: 'xlsx' }) as Buffer
}

interface StoredTriad {
	keyword: string
	fullPhrases: string[]
	cues: string[]
}

interface CreateTriadArgs {
	data: StoredTriad
}

interface CreateTriadGroupArgs {
	data: {
		triad1Id: number
		triad2Id: number
		triad3Id: number
		triad4Id: number
		difficulty: Difficulty
	}
}

describe('ImportService', () => {
	it('rejects an invalid final triad before opening a database transaction', async () => {
		const prismaService = {
			$transaction: jest.fn(),
		}
		const service = new ImportService(prismaService as unknown as PrismaService)
		const file = {
			buffer: createWorkbook([
				['ARROW', 'ARROW A', 'ARROW B', 'ARROW C'],
				['EGG', 'EGG A', 'EGG B', 'EGG C'],
				['STONE', 'STONE A', 'STONE B', 'STONE C'],
				['HEAD', 'ARROWHEAD', 'SPEARHEAD', 'HEADSTONE'],
			]),
		} as Express.Multer.File

		await expect(service.importTriadsFromExcel(file)).rejects.toThrow('invalid Triad 4 receipt')
		expect(prismaService.$transaction).not.toHaveBeenCalled()
	})

	it('stores final cues from the validated receipt inside one transaction', async () => {
		let nextId = 1
		const transaction = {
			triad: {
				create: jest.fn(({ data }: CreateTriadArgs) => Promise.resolve({ id: nextId++, ...data })),
			},
			triadGroup: {
				create: jest.fn(({ data }: CreateTriadGroupArgs) => Promise.resolve(data)),
			},
		}
		const prismaService = {
			$transaction: jest.fn((callback: (databaseTransaction: typeof transaction) => Promise<unknown>) => callback(transaction)),
		}
		const service = new ImportService(prismaService as unknown as PrismaService)
		const file = {
			buffer: createWorkbook([
				['BONE', 'BONE A', 'BONE B', 'BONE C'],
				['MOBILE', 'MOBILE A', 'MOBILE B', 'MOBILE C'],
				['REX', 'REX A', 'REX B', 'REX C'],
				['T', 'T-BONE', 'T-MOBILE', 'T-REX'],
			]),
		} as Express.Multer.File

		await expect(service.importTriadsFromExcel(file)).resolves.toMatchObject({
			success: true,
			statistics: { total: 1, easy: 1, medium: 0, hard: 0 },
		})

		expect(prismaService.$transaction).toHaveBeenCalledTimes(1)
		expect(transaction.triad.create).toHaveBeenCalledTimes(4)
		expect(transaction.triad.create.mock.calls[3][0].data).toMatchObject({
			keyword: 'T',
			cues: ['BONE', 'MOBILE', 'REX'],
		})
		expect(transaction.triadGroup.create).toHaveBeenCalledWith({
			data: {
				triad1Id: 1,
				triad2Id: 2,
				triad3Id: 3,
				triad4Id: 4,
				difficulty: Difficulty.EASY,
			},
		})
	})
})
