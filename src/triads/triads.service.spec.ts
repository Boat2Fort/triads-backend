import { Test, TestingModule } from '@nestjs/testing'
import { Difficulty } from '@prisma/client'

import { PrismaService } from '../prisma/prisma.service'
import { DifficultyFilter } from './dto/get-cues.dto'
import { TriadsService } from './triads.service'
import { TriadsDailyService } from './triads-daily.service'

describe('TriadsService', () => {
	let service: TriadsService
	let prismaService: {
		$queryRaw: jest.Mock
		$queryRawUnsafe: jest.Mock
		triad: { findMany: jest.Mock }
		triadGroup: {
			findUnique: jest.Mock
			findFirst: jest.Mock
			findMany: jest.Mock
			groupBy: jest.Mock
		}
	}

	beforeEach(async () => {
		prismaService = {
			$queryRaw: jest.fn(),
			$queryRawUnsafe: jest.fn(),
			triad: { findMany: jest.fn() },
			triadGroup: {
				findUnique: jest.fn(),
				findFirst: jest.fn(),
				findMany: jest.fn(),
				groupBy: jest.fn(),
			},
		}

		const module: TestingModule = await Test.createTestingModule({
			providers: [
				TriadsService,
				{ provide: PrismaService, useValue: prismaService },
				{
					provide: TriadsDailyService,
					useValue: {
						incrementClassicExtraStart: jest.fn().mockResolvedValue({
							classicExtrasUsed: 1,
							classicExtrasRemaining: 2,
							classicExtrasLimit: 3,
							canPlayClassic: true,
							classicBlockedReason: null,
						}),
					},
				},
			],
		}).compile()

		service = module.get<TriadsService>(TriadsService)
	})

	it('should be defined', () => {
		expect(service).toBeDefined()
	})

	describe('getStandaloneClassicCues', () => {
		it('selects active cues without touching Classic Extra usage', async () => {
			prismaService.$queryRawUnsafe.mockResolvedValue([{ id: 7, triad1: ['A', 'B', 'C'], triad2: ['D', 'E', 'F'], triad3: ['G', 'H', 'I'] }])

			const result = await service.getStandaloneClassicCues({ difficulty: DifficultyFilter.RANDOM })

			expect(result.triadGroupId).toBe(7)
			expect(result.cues).toHaveLength(9)
			expect(prismaService.$queryRawUnsafe).toHaveBeenCalled()
		})
	})

	describe('checkAnswer', () => {
		const triad = { id: 1, keyword: 'fish', cues: ['scales', 'fin', 'gill'], fullPhrases: [] }

		it('accepts the exact correct answer', () => {
			expect(service.checkAnswer('fish', triad)).toEqual(triad)
		})

		it('accepts an answer with a trailing space (iOS auto-complete bug)', () => {
			expect(service.checkAnswer('fish ', triad)).toEqual(triad)
		})

		it('accepts an answer with leading whitespace', () => {
			expect(service.checkAnswer(' fish', triad)).toEqual(triad)
		})

		it('rejects a different answer', () => {
			expect(service.checkAnswer('cat', triad)).toBe(false)
		})

		it('returns displayed trailing-hyphen cues for legacy stored cues', () => {
			const buttonTriad = {
				id: 2,
				keyword: 'BUTTON',
				cues: ['PUSH', 'CAMPAIGN', 'PANIC'],
				fullPhrases: ['PUSH-BUTTON', 'CAMPAIGN BUTTON', 'PANIC BUTTON'],
			}

			expect(service.checkAnswer('button', buttonTriad)).toEqual({ ...buttonTriad, cues: ['PUSH-', 'CAMPAIGN', 'PANIC'] })
			expect(buttonTriad.cues).toEqual(['PUSH', 'CAMPAIGN', 'PANIC'])
		})

		it('preserves displayed leading-hyphen cues when the keyword precedes the cue', () => {
			const triad = { id: 3, keyword: 'WELL', cues: ['BEING', 'KNOWN', 'WISHER'], fullPhrases: ['WELL-BEING', 'WELL-KNOWN', 'WELL-WISHER'] }

			expect(service.checkAnswer('well', triad)).toEqual({ ...triad, cues: ['-BEING', '-KNOWN', '-WISHER'] })
		})
	})

	describe('gameplay cue identity and matching', () => {
		const button = { id: 1, keyword: 'BUTTON', cues: ['PUSH', 'CAMPAIGN', 'PANIC'], fullPhrases: ['PUSH-BUTTON', 'CAMPAIGN BUTTON', 'PANIC BUTTON'] }
		const pigeon = { id: 2, keyword: 'PIGEON', cues: ['CARRIER', 'CLAY', 'STOOL'], fullPhrases: ['CARRIER PIGEON', 'CLAY PIGEON', 'STOOL PIGEON'] }
		const port = { id: 3, keyword: 'PORT', cues: ['AUTHORITY', 'AIR', 'WINE'], fullPhrases: ['PORT AUTHORITY', 'AIRPORT', 'PORT WINE'] }
		const final = { id: 4, keyword: 'HOLE', cues: ['BUTTON', 'PIGEON', 'PORT'], fullPhrases: ['BUTTONHOLE', 'PIGEONHOLE', 'PORTHOLE'] }
		const group = { Triad1: button, Triad2: pigeon, Triad3: port, Triad4: final }

		beforeEach(() => {
			prismaService.triadGroup.findUnique.mockResolvedValue(group)
			prismaService.triad.findMany.mockResolvedValue([button, pigeon, port, final])
		})

		it.each([
			['PUSH-', 'CAMPAIGN', 'PANIC'],
			['CAMPAIGN', 'PANIC', 'PUSH-'],
			['PANIC', 'PUSH-', 'CAMPAIGN'],
		])('matches any selected cue order (%s first)', async (...cues) => {
			const result = await service.getMatchedTriad(cues, { triadGroupId: 7 })
			expect(result?.id).toBe(button.id)
			expect(result?.cues).toEqual(['PUSH-', 'CAMPAIGN', 'PANIC'])
		})

		it('returns false for an unmatched answer instead of throwing', () => {
			expect(service.checkAnswer('BUTTON', undefined)).toBe(false)
		})

		it('returns the submitted spelling for Daily sessions loaded before hyphens were preserved', async () => {
			const cues = ['PANIC', 'PUSH', 'CAMPAIGN']
			const matched = await service.getMatchedTriad(cues, { triadGroupId: 7 })
			expect(service.checkAnswer('BUTTON', matched, cues)).toEqual({ ...button, cues })
		})

		it('does not match duplicate selections by treating them as sets', async () => {
			expect(await service.getMatchedTriad(['PUSH-', 'PUSH-', 'PANIC'], { triadGroupId: 7 })).toBeUndefined()
			prismaService.triad.findMany.mockResolvedValue([{ ...button, cues: ['PUSH', 'PANIC', 'PANIC'], fullPhrases: [] }])
			expect(await service.getMatchedTriad(['PUSH-', 'PUSH-', 'PANIC'])).toBeUndefined()
		})

		it('restricts hints and answers to the active group and round', async () => {
			expect(await service.getMatchedTriad(final.cues, { triadGroupId: 7 })).toBeUndefined()
			expect(await service.getMatchedTriad(['PUSH-', 'PANIC', 'CAMPAIGN'], { triadGroupId: 7, triadsStep: 'FINAL' })).toBeUndefined()
			expect((await service.getHint({ cues: ['BUTTON', 'PIGEON', 'PORT'], triadGroupId: 7 })).hint).toBeNull()
			expect(prismaService.triad.findMany).not.toHaveBeenCalled()
		})

		it('uses the final receipt for repeated-keyword bonus phrases', async () => {
			const bonus = { id: 4, keyword: 'AN', cues: ['AAN', 'GRADE', 'TEAM'], fullPhrases: ['ANAAN', 'AN-GRADE', 'TEAM-AN'] }
			const bonusGroup = {
				Triad1: { ...button, keyword: 'ANA' },
				Triad2: { ...pigeon, keyword: 'GRADE' },
				Triad3: { ...port, keyword: 'TEAM' },
				Triad4: bonus,
			}
			prismaService.triadGroup.findUnique.mockResolvedValue(bonusGroup)
			prismaService.triadGroup.findFirst.mockResolvedValue(bonusGroup)
			const cues = await service.getFourthTriadCues({ triadGroupId: 7 })
			const matched = await service.getMatchedTriad(cues, { triadGroupId: 7, triadsStep: 'FINAL' })
			expect(cues).toEqual(['ANA', '-GRADE', 'TEAM-'])
			expect(matched?.id).toBe(4)
			expect((await service.getHint({ cues, triadGroupId: 7, triadsStep: 'FINAL', with: 'FIRST_LETTER' })).withValue).toBe('A')
		})

		it('returns no match for a missing group without falling back to another puzzle', async () => {
			prismaService.triadGroup.findUnique.mockResolvedValue(null)
			expect(await service.getMatchedTriad(button.cues, { triadGroupId: 999 })).toBeUndefined()
			expect((await service.getHint({ cues: button.cues, triadGroupId: 999 })).hint).toBeNull()
		})

		it('supports legacy clients in both directions of hyphen spelling', async () => {
			prismaService.triad.findMany.mockResolvedValue([{ ...button, cues: ['PUSH-', 'CAMPAIGN', 'PANIC'] }])
			expect((await service.getMatchedTriad(['PUSH', 'CAMPAIGN', 'PANIC']))?.id).toBe(button.id)
			const calls = prismaService.triad.findMany.mock.calls as [{ where: { AND: { cues: { hasSome: string[] } }[] } }][]
			const query = calls[0][0]
			expect(query.where.AND[0].cues.hasSome).toContain('PUSH-')
			expect(query.where.AND[0].cues.hasSome).toContain('PUSH')
		})

		it('finds a hint from all available cues, even when one cue belongs to no triad', async () => {
			const cues = ['UNMATCHED', 'PUSH-', 'CAMPAIGN', 'PANIC']
			const result = await service.getHint({ cues, with: 'KEYWORD_LENGTH' })
			expect(result).toEqual({ hint: ['PUSH-', 'CAMPAIGN', 'PANIC'], with: 'KEYWORD_LENGTH', withValue: 6 })
			const calls = prismaService.triad.findMany.mock.calls as [{ where: { cues: { hasSome: string[] } } }][]
			const query = calls[0][0]
			expect(query.where.cues.hasSome).toEqual(expect.arrayContaining(['UNMATCHED', 'PUSH-', 'PANIC']))
		})

		it('disambiguates answers when multiple triads share cues', async () => {
			prismaService.triad.findMany.mockResolvedValue([{ ...button, keyword: 'OTHER', fullPhrases: [] }, button])
			expect((await service.getMatchedTriad(button.cues, {}, ' button '))?.keyword).toBe('BUTTON')
		})

		it('does not confuse leading and trailing hyphens', async () => {
			expect(await service.getMatchedTriad(['-PUSH', 'CAMPAIGN', 'PANIC'], { triadGroupId: 7 })).toBeUndefined()
			expect((await service.getMatchedTriad(['PUSH', 'CAMPAIGN', 'PANIC'], { triadGroupId: 7 }))?.id).toBe(button.id)
		})

		it('finds a one-to-one cue mapping when a legacy spelling could match either hyphen direction', async () => {
			const triad = { ...button, cues: ['PUSH', 'PUSH-', 'PANIC'], fullPhrases: [] }
			prismaService.triad.findMany.mockResolvedValue([triad])
			const cues = ['PUSH-', '-PUSH', 'PANIC']
			expect((await service.getMatchedTriad(cues))?.id).toBe(button.id)
			expect((await service.getHint({ cues })).hint).toEqual(['-PUSH', 'PUSH-', 'PANIC'])
		})

		it('does not use one visible cue twice in a hint', async () => {
			prismaService.triad.findMany.mockResolvedValue([{ ...button, cues: ['PUSH', 'PUSH', 'PANIC'], fullPhrases: [] }])
			expect((await service.getHint({ cues: ['PUSH-', 'PANIC', 'OTHER'] })).hint).toBeNull()
		})
	})

	describe('getPublicTriadGroups', () => {
		it('returns active groups with complete, positioned triads without pagination or sorting', async () => {
			prismaService.triadGroup.findMany.mockResolvedValue([
				{
					id: 7,
					difficulty: Difficulty.HARD,
					Triad1: { id: 71, keyword: 'apple', cues: ['pie'], fullPhrases: ['apple pie'] },
					Triad2: { id: 72, keyword: 'tree', cues: ['oak'], fullPhrases: ['oak tree'] },
					Triad3: { id: 73, keyword: 'juice', cues: ['orange'], fullPhrases: ['orange juice'] },
					Triad4: { id: 74, keyword: 'core', cues: ['fruit'], fullPhrases: ['apple core'] },
				},
			])

			await expect(service.getPublicTriadGroups()).resolves.toEqual([
				{
					id: 7,
					difficulty: Difficulty.HARD,
					triads: [
						{ position: 1, isFinal: false, id: 71, keyword: 'apple', cues: ['pie'], fullPhrases: ['apple pie'] },
						{ position: 2, isFinal: false, id: 72, keyword: 'tree', cues: ['oak'], fullPhrases: ['oak tree'] },
						{ position: 3, isFinal: false, id: 73, keyword: 'juice', cues: ['orange'], fullPhrases: ['orange juice'] },
						{ position: 4, isFinal: true, id: 74, keyword: 'core', cues: ['fruit'], fullPhrases: ['apple core'] },
					],
				},
			])

			expect(prismaService.triadGroup.findMany).toHaveBeenCalledWith({
				where: { active: true },
				select: {
					id: true,
					difficulty: true,
					Triad1: { select: { id: true, keyword: true, cues: true, fullPhrases: true } },
					Triad2: { select: { id: true, keyword: true, cues: true, fullPhrases: true } },
					Triad3: { select: { id: true, keyword: true, cues: true, fullPhrases: true } },
					Triad4: { select: { id: true, keyword: true, cues: true, fullPhrases: true } },
				},
			})
		})

		it('returns an empty inventory when no groups are active', async () => {
			prismaService.triadGroup.findMany.mockResolvedValue([])

			await expect(service.getPublicTriadGroups()).resolves.toEqual([])
		})
	})

	describe('getPublicTriadGroupsPage', () => {
		it('returns a deterministic page without changing the full-export query', async () => {
			jest.spyOn(service, 'getPublicTriadGroups').mockResolvedValue([
				{ id: 9, difficulty: Difficulty.EASY, triads: [] },
				{ id: 3, difficulty: Difficulty.HARD, triads: [] },
				{ id: 6, difficulty: Difficulty.MEDIUM, triads: [] },
			])

			await expect(service.getPublicTriadGroupsPage(1, 1)).resolves.toEqual([{ id: 6, difficulty: Difficulty.MEDIUM, triads: [] }])
		})
	})

	describe('getTriadGroups', () => {
		const group = (id: number, keyword: string, difficulty = 'EASY') => ({
			id,
			active: true,
			difficulty,
			Triad1: { id: id * 10 + 1, keyword, cues: [`${keyword} cue 1`], fullPhrases: [] },
			Triad2: { id: id * 10 + 2, keyword: `${keyword} 2`, cues: [`${keyword} cue 2`], fullPhrases: [] },
			Triad3: { id: id * 10 + 3, keyword: `${keyword} 3`, cues: [`${keyword} cue 3`], fullPhrases: [] },
			Triad4: { id: id * 10 + 4, keyword: `${keyword} 4`, cues: [`${keyword} cue 4`], fullPhrases: [] },
		})

		it('returns scheduled groups before newly created unscheduled groups', async () => {
			const scheduledMarch = group(2, 'march')
			const scheduledMay = group(5, 'may')
			const unscheduledOld = group(1, 'old')
			const unscheduledNew = group(99, 'new')

			prismaService.$queryRaw.mockResolvedValue([{ id: 2 }, { id: 5 }, { id: 1 }, { id: 99 }])
			prismaService.triadGroup.findMany.mockResolvedValue([unscheduledNew, scheduledMay, unscheduledOld, scheduledMarch])

			const result = await service.getTriadGroups(0, 20)

			expect(result.map((g) => g.id)).toEqual([2, 5, 1, 99])
			expect(prismaService.triadGroup.findMany).toHaveBeenCalledWith(
				expect.objectContaining({
					where: { id: { in: [2, 5, 1, 99] } },
				}),
			)
		})

		it('sorts unscheduled groups by difficulty from easy to hard in the raw query', async () => {
			prismaService.$queryRaw.mockResolvedValue([])

			await service.getTriadGroups(0, 20)

			const firstCall = prismaService.$queryRaw.mock.calls[0] as [TemplateStringsArray]
			const sql = firstCall[0].join('')
			expect(sql).toContain('CASE g.difficulty::text')
			expect(sql).toContain("WHEN 'EASY' THEN 0")
			expect(sql).toContain("WHEN 'MEDIUM' THEN 1")
			expect(sql).toContain("WHEN 'HARD' THEN 2")
			expect(sql).toContain('g.id ASC')
		})

		it('preserves the raw-query easy-to-hard order when hydrating unscheduled groups', async () => {
			const scheduled = group(2, 'scheduled', 'HARD')
			const easy = group(8, 'easy', 'EASY')
			const medium = group(3, 'medium', 'MEDIUM')
			const hard = group(1, 'hard', 'HARD')

			prismaService.$queryRaw.mockResolvedValue([{ id: 2 }, { id: 8 }, { id: 3 }, { id: 1 }])
			prismaService.triadGroup.findMany.mockResolvedValue([hard, medium, scheduled, easy])

			const result = await service.getTriadGroups(0, 20)

			expect(result.map((g) => g.id)).toEqual([2, 8, 3, 1])
		})

		it('preserves assigned-puzzle-date order when the raw query orders scheduled groups', async () => {
			const scheduledEarliest = group(7, 'early')
			const scheduledLater = group(3, 'later')
			const unscheduled = group(20, 'unscheduled')

			prismaService.$queryRaw.mockResolvedValue([{ id: 7 }, { id: 3 }, { id: 20 }])
			prismaService.triadGroup.findMany.mockResolvedValue([unscheduled, scheduledLater, scheduledEarliest])

			const result = await service.getTriadGroups(0, 20)

			expect(result.map((g) => g.id)).toEqual([7, 3, 20])
		})

		it('keeps scheduled-first ordering within search results', async () => {
			const scheduled = group(4, 'apple')
			const unscheduled = group(12, 'apple tart')

			prismaService.$queryRaw.mockResolvedValue([{ id: 4 }, { id: 12 }])
			prismaService.triadGroup.findMany.mockResolvedValue([unscheduled, scheduled])

			const result = await service.getTriadGroups(0, 20, 'apple')

			expect(result.map((g) => g.id)).toEqual([4, 12])
			expect(prismaService.$queryRaw).toHaveBeenCalledTimes(1)
		})

		it('combines keyword search with difficulty filtering', async () => {
			prismaService.$queryRaw.mockResolvedValue([])

			await service.getTriadGroups(0, 20, 'apple', Difficulty.MEDIUM)

			const queryRawCall = prismaService.$queryRaw.mock.calls[0] as unknown[]
			const values = queryRawCall.slice(1) as Array<{ strings?: string[] }>
			const whereClause = values.find((value) => value?.strings?.join('').includes('WHERE'))
			const sql = whereClause?.strings?.join('') ?? ''
			expect(sql).toContain('t1.keyword ILIKE')
			expect(sql).toContain('g.difficulty =')
			expect(sql).toContain('AND')
		})
	})

	describe('getTriadGroupStats', () => {
		it('counts only active groups by difficulty', async () => {
			prismaService.triadGroup.groupBy.mockResolvedValue([
				{ difficulty: 'EASY', _count: { _all: 2 } },
				{ difficulty: 'MEDIUM', _count: { _all: 1 } },
				{ difficulty: 'HARD', _count: { _all: 3 } },
			])

			const result = await service.getTriadGroupStats()

			expect(prismaService.triadGroup.groupBy).toHaveBeenCalledWith({
				by: ['difficulty'],
				where: { active: true },
				_count: { _all: true },
			})
			expect(result).toEqual({
				totalActive: 6,
				byDifficulty: {
					EASY: 2,
					MEDIUM: 1,
					HARD: 3,
				},
			})
		})

		it('returns zero counts for difficulties with no active groups', async () => {
			prismaService.triadGroup.groupBy.mockResolvedValue([{ difficulty: 'EASY', _count: { _all: 4 } }])

			const result = await service.getTriadGroupStats()

			expect(result).toEqual({
				totalActive: 4,
				byDifficulty: {
					EASY: 4,
					MEDIUM: 0,
					HARD: 0,
				},
			})
		})
	})
})
