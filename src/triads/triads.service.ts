import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common'
import { Difficulty, Prisma } from '@prisma/client'
import { isEmpty, xor } from 'lodash'

import { PrismaService } from '../prisma/prisma.service'
import { buildFourthTriadReceipt, formatFourthTriadReceipt } from '../shared/validators/fourth-triad-receipt'
import { extractCuesFromPhrases } from './cue-extraction'
import { CreateTriadGroupDto } from './dto/create-triad-group.dto'
import { DifficultyFilter, GetCuesDto } from './dto/get-cues.dto'
import { GetFourthTriadDto } from './dto/get-fourth-triad.dto'
import { GetHintDto } from './dto/get-hint.dto'
import { TriadInputDto } from './dto/triad-input.dto'
import { UpdateTriadGroupDto } from './dto/update-triad-group.dto'
import { TriadsDailyService } from './triads-daily.service'

type TriadCueQueryResult = {
	id: number
	triad1: string[]
	triad2: string[]
	triad3: string[]
	triad1_keyword?: string
	triad2_keyword?: string
	triad3_keyword?: string
	triad1_full_phrases?: string[]
	triad2_full_phrases?: string[]
	triad3_full_phrases?: string[]
}

@Injectable()
export class TriadsService {
	constructor(
		private readonly prismaService: PrismaService,
		private readonly triadsDailyService: TriadsDailyService,
	) {}

	async getCues(getCuesDto: GetCuesDto | undefined, anonymousId: string | undefined) {
		const classicExtra = await this.triadsDailyService.incrementClassicExtraStart(anonymousId ?? '')
		return {
			...(await this.selectRandomCues(getCuesDto)),
			...classicExtra,
		}
	}

	async getStandaloneClassicCues(getCuesDto: GetCuesDto | undefined) {
		return this.selectRandomCues(getCuesDto)
	}

	private async selectRandomCues(getCuesDto: GetCuesDto | undefined) {
		// Determine if we should filter by difficulty
		const difficulty = getCuesDto?.difficulty || DifficultyFilter.RANDOM
		const shouldFilterByDifficulty = difficulty !== DifficultyFilter.RANDOM

		// Optimized query using JOINs instead of nested subqueries for better performance
		// Use parameterized query to prevent SQL injection
		let triadGroups: TriadCueQueryResult[]

		if (shouldFilterByDifficulty) {
			// Use Prisma.sql for safe parameterization
			triadGroups = await this.prismaService.$queryRaw<TriadCueQueryResult[]>(
				Prisma.sql`
					SELECT 
						tg.id,
						t1.cues as triad1,
						t1.keyword as triad1_keyword,
						t1."fullPhrases" as triad1_full_phrases,
						t2.cues as triad2,
						t2.keyword as triad2_keyword,
						t2."fullPhrases" as triad2_full_phrases,
						t3.cues as triad3,
						t3.keyword as triad3_keyword,
						t3."fullPhrases" as triad3_full_phrases
					FROM "triadGroups" tg
					INNER JOIN "triads" t1 ON t1.id = tg."triad1Id"
					INNER JOIN "triads" t2 ON t2.id = tg."triad2Id"
					INNER JOIN "triads" t3 ON t3.id = tg."triad3Id"
					WHERE tg.active = true AND tg.difficulty = ${difficulty}::"Difficulty"
					ORDER BY random()
					LIMIT 1;
				`,
			)
		} else {
			triadGroups = await this.prismaService.$queryRawUnsafe<TriadCueQueryResult[]>(`
				SELECT 
					tg.id,
					t1.cues as triad1,
					t1.keyword as triad1_keyword,
					t1."fullPhrases" as triad1_full_phrases,
					t2.cues as triad2,
					t2.keyword as triad2_keyword,
					t2."fullPhrases" as triad2_full_phrases,
					t3.cues as triad3,
					t3.keyword as triad3_keyword,
					t3."fullPhrases" as triad3_full_phrases
				FROM "triadGroups" tg
				INNER JOIN "triads" t1 ON t1.id = tg."triad1Id"
				INNER JOIN "triads" t2 ON t2.id = tg."triad2Id"
				INNER JOIN "triads" t3 ON t3.id = tg."triad3Id"
				WHERE tg.active = true
				ORDER BY random()
				LIMIT 1;
			`)
		}

		if (!triadGroups || triadGroups.length === 0) {
			const difficultyMessage = shouldFilterByDifficulty ? ` with difficulty ${difficulty}` : ''
			return {
				triadGroupId: null,
				cues: null,
				message: `No active triad groups found${difficultyMessage}`,
			}
		}

		const triadGroup = triadGroups[0]
		if (!triadGroup.triad1 || !triadGroup.triad2 || !triadGroup.triad3) {
			throw new Error('Invalid triad group data')
		}

		return {
			triadGroupId: triadGroup.id,
			cues: [
				...this.getDisplayedCues(triadGroup.triad1, triadGroup.triad1_keyword, triadGroup.triad1_full_phrases),
				...this.getDisplayedCues(triadGroup.triad2, triadGroup.triad2_keyword, triadGroup.triad2_full_phrases),
				...this.getDisplayedCues(triadGroup.triad3, triadGroup.triad3_keyword, triadGroup.triad3_full_phrases),
			].sort(() => Math.random() - 0.5),
		}
	}

	async getMatchedTriad(cues: string[]): Promise<{ id: number; keyword: string; cues: string[]; fullPhrases: string[] } | undefined> {
		const sampleCue = cues[0]
		const sampleCueVariants = [...new Set([sampleCue.toUpperCase(), this.normalizeCueForMatch(sampleCue)])]

		// Limit results to prevent loading all triads into memory
		const triadsContainingSampleCue = await this.prismaService.triad.findMany({
			where: { cues: { hasSome: sampleCueVariants } },
			take: 1000, // Reasonable limit to prevent memory issues
		})

		return triadsContainingSampleCue.find((triad) =>
			isEmpty(
				xor(
					triad.cues.map((cue) => this.normalizeCueForMatch(cue)),
					cues.map((cue) => this.normalizeCueForMatch(cue)),
				),
			),
		)
	}

	checkAnswer(answer: string, triad: { id: number; keyword: string; cues: string[]; fullPhrases: string[] }) {
		return triad.keyword.trim().toUpperCase() === answer.trim().toUpperCase() ? triad : false
	}

	async getHint(getHintDto: GetHintDto) {
		// Pick a sample cue to work with
		const sampleCue = getHintDto.cues[Math.floor(Math.random() * getHintDto.cues.length)]
		const normalizedCues = getHintDto.cues.map((cue) => this.normalizeCueForMatch(cue))
		const sampleCueVariants = [...new Set([sampleCue.toUpperCase(), this.normalizeCueForMatch(sampleCue)])]

		// Get list of triads containing the sample cue with limit to prevent memory issues
		const triadsContainingSampleCue = await this.prismaService.triad.findMany({
			where: { cues: { hasSome: sampleCueVariants } },
			take: 1000, // Reasonable limit to prevent memory issues
		})

		// Find a triad which contains the sample cue word and two other cues from the list of cues received
		const matchedTriad = triadsContainingSampleCue.find((triad) => triad.cues.every((cue) => normalizedCues.includes(this.normalizeCueForMatch(cue))))
		const hint = matchedTriad
			? matchedTriad.cues.map(
					(cue) => getHintDto.cues.find((submittedCue) => this.normalizeCueForMatch(submittedCue) === this.normalizeCueForMatch(cue)) ?? cue,
				)
			: null

		return {
			hint,
			with: getHintDto.with,
			withValue:
				getHintDto.with && matchedTriad
					? getHintDto.with === 'KEYWORD_LENGTH'
						? matchedTriad.keyword.length
						: matchedTriad.keyword.charAt(0)
					: undefined,
		}
	}

	async getFourthTriadCues(getFourthTriadDto: GetFourthTriadDto) {
		const triadGroup = await this.prismaService.triadGroup.findFirst({
			where: {
				id: getFourthTriadDto.triadGroupId,
			},
			select: {
				Triad1: { select: { keyword: true } },
				Triad2: { select: { keyword: true } },
				Triad3: { select: { keyword: true } },
				Triad4: {
					select: {
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
			},
		})

		if (!triadGroup?.Triad4) {
			return undefined
		}

		const receipt = buildFourthTriadReceipt([triadGroup.Triad1.keyword, triadGroup.Triad2.keyword, triadGroup.Triad3.keyword], triadGroup.Triad4)

		return receipt.valid ? receipt.matches.map((match) => match.residual.trim().toUpperCase()) : triadGroup.Triad4.cues
	}

	async getFourthTriadSolution(getFourthTriadDto: GetFourthTriadDto) {
		const triadGroup = await this.prismaService.triadGroup.findFirst({
			where: {
				id: getFourthTriadDto.triadGroupId,
			},
			select: {
				Triad4: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
			},
		})

		if (!triadGroup?.Triad4) {
			throw new NotFoundException(`Fourth triad for group ${getFourthTriadDto.triadGroupId} not found`)
		}

		return triadGroup.Triad4
	}

	async getTriadsByGroupId(id: number) {
		const triadGroup = await this.prismaService.triadGroup.findUnique({
			where: { id },
			select: {
				Triad1: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
				Triad2: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
				Triad3: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
				Triad4: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
			},
		})

		if (!triadGroup) {
			throw new NotFoundException(`Triad group with ID ${id} not found`)
		}

		return [triadGroup.Triad1, triadGroup.Triad2, triadGroup.Triad3, triadGroup.Triad4]
	}

	async getPublicTriadGroups() {
		const triadGroups = await this.prismaService.triadGroup.findMany({
			where: { active: true },
			select: {
				id: true,
				difficulty: true,
				Triad1: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
				Triad2: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
				Triad3: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
				Triad4: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
			},
		})

		return triadGroups.map((group) => ({
			id: group.id,
			difficulty: group.difficulty,
			triads: [
				{ position: 1, isFinal: false, ...group.Triad1 },
				{ position: 2, isFinal: false, ...group.Triad2 },
				{ position: 3, isFinal: false, ...group.Triad3 },
				{ position: 4, isFinal: true, ...group.Triad4 },
			],
		}))
	}

	async getPublicTriadGroupsPage(offset: number, limit: number) {
		const triadGroups = await this.getPublicTriadGroups()

		return [...triadGroups].sort((firstGroup, secondGroup) => firstGroup.id - secondGroup.id).slice(offset, offset + limit)
	}

	async getTriadGroups(offset: number, limit: number, search?: string, difficulty?: Difficulty) {
		// Note: This endpoint returns all groups including deactivated ones for frontend management.
		//
		// Ordering (see docs/adr/0001-raw-sql-for-manage-triads-ordering.md): scheduled groups
		// first, ordered by their assigned puzzleDate, then unscheduled groups by difficulty from
		// easy to hard and id. The ordered+paginated page of group ids is computed with a raw query,
		// then hydrated with a typed select below.
		//
		// Search matches any of the 4 triads' keywords (case-insensitive partial match).
		const whereConditions: Prisma.Sql[] = []
		if (search) {
			whereConditions.push(Prisma.sql`(
					t1.keyword ILIKE ${`%${search}%`}
					OR t2.keyword ILIKE ${`%${search}%`}
					OR t3.keyword ILIKE ${`%${search}%`}
					OR t4.keyword ILIKE ${`%${search}%`}
				)`)
		}
		if (difficulty) {
			whereConditions.push(Prisma.sql`g.difficulty = ${difficulty}::"Difficulty"`)
		}
		const whereClause = whereConditions.length > 0 ? Prisma.sql`WHERE ${Prisma.join(whereConditions, ' AND ')}` : Prisma.empty

		const orderedRows = await this.prismaService.$queryRaw<{ id: number }[]>`
			SELECT g.id
			FROM "triadGroups" g
			JOIN "triads" t1 ON t1.id = g."triad1Id"
			JOIN "triads" t2 ON t2.id = g."triad2Id"
			JOIN "triads" t3 ON t3.id = g."triad3Id"
			JOIN "triads" t4 ON t4.id = g."triad4Id"
			LEFT JOIN "triad_daily_schedules" s ON s."triadGroupId" = g.id
			${whereClause}
			ORDER BY
				(s."puzzleDate" IS NULL) ASC,
				s."puzzleDate" ASC,
				CASE g.difficulty::text
					WHEN 'EASY' THEN 0
					WHEN 'MEDIUM' THEN 1
					WHEN 'HARD' THEN 2
					ELSE 3
				END ASC,
				g.id ASC
			LIMIT ${limit} OFFSET ${offset}
		`

		const orderedIds = orderedRows.map((row) => Number(row.id))
		if (orderedIds.length === 0) {
			return []
		}

		// Hydrate the ordered page with a typed select to only fetch needed fields.
		const triadGroups = await this.prismaService.triadGroup.findMany({
			where: { id: { in: orderedIds } },
			select: {
				id: true,
				active: true,
				difficulty: true,
				Triad1: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
				Triad2: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
				Triad3: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
				Triad4: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
			},
		})

		// Reorder to match the raw query's ordering (findMany does not preserve the `in` order)
		// and transform to the expected format (triad1, triad2, triad3, triad4).
		const groupById = new Map(triadGroups.map((group) => [group.id, group]))
		return orderedIds
			.map((id) => groupById.get(id))
			.filter((group): group is (typeof triadGroups)[number] => group !== undefined)
			.map((group) => ({
				id: group.id,
				active: group.active,
				difficulty: group.difficulty,
				triad1: group.Triad1,
				triad2: group.Triad2,
				triad3: group.Triad3,
				triad4: group.Triad4,
			}))
	}

	async getTriadGroupStats() {
		const groupedCounts = await this.prismaService.triadGroup.groupBy({
			by: ['difficulty'],
			where: { active: true },
			_count: { _all: true },
		})

		const byDifficulty = {
			EASY: 0,
			MEDIUM: 0,
			HARD: 0,
		}

		for (const row of groupedCounts) {
			byDifficulty[row.difficulty] = row._count._all
		}

		return {
			totalActive: byDifficulty.EASY + byDifficulty.MEDIUM + byDifficulty.HARD,
			byDifficulty,
		}
	}

	async deleteTriadGroup(id: number) {
		// Find the triad group
		const triadGroup = await this.prismaService.triadGroup.findUnique({
			where: { id },
			select: {
				triad1Id: true,
				triad2Id: true,
				triad3Id: true,
				triad4Id: true,
			},
		})

		if (!triadGroup) {
			throw new NotFoundException(`Triad group with ID ${id} not found`)
		}

		const triadIds = [triadGroup.triad1Id, triadGroup.triad2Id, triadGroup.triad3Id, triadGroup.triad4Id]

		// Check if each triad is used by other groups
		const triadsToDelete: number[] = []
		for (const triadId of triadIds) {
			const usageCount = await this.prismaService.triadGroup.count({
				where: {
					OR: [{ triad1Id: triadId }, { triad2Id: triadId }, { triad3Id: triadId }, { triad4Id: triadId }],
				},
			})

			// Only delete if this is the only group using the triad
			if (usageCount === 1) {
				triadsToDelete.push(triadId)
			}
		}

		// Delete the triad group FIRST to avoid foreign key constraint violations
		await this.prismaService.triadGroup.delete({
			where: { id },
		})

		// Delete triads that are exclusively used by this group (now safe since group is deleted)
		if (triadsToDelete.length > 0) {
			await this.prismaService.triad.deleteMany({
				where: {
					id: {
						in: triadsToDelete,
					},
				},
			})
		}

		return { success: true, message: `Triad group ${id} deleted successfully` }
	}

	async updateTriadGroupActive(id: number, active: boolean) {
		const triadGroup = await this.prismaService.triadGroup.findUnique({
			where: { id },
		})

		if (!triadGroup) {
			throw new NotFoundException(`Triad group with ID ${id} not found`)
		}

		return await this.prismaService.triadGroup.update({
			where: { id },
			data: { active },
			select: {
				id: true,
				active: true,
			},
		})
	}

	async createTriadGroup(createDto: CreateTriadGroupDto) {
		// Validate each triad
		this.validateKeywordSubstring(createDto.triad1)
		this.validateKeywordSubstring(createDto.triad2)
		this.validateKeywordSubstring(createDto.triad3)
		this.validateKeywordSubstring(createDto.triad4)

		// Validate fourth triad cues and retain the proof for the stored final cues.
		const triad4Receipt = this.validateFourthTriadCues(createDto.triad1, createDto.triad2, createDto.triad3, createDto.triad4)

		// Create all 4 triads
		const triad1 = await this.prismaService.triad.create({
			data: {
				keyword: createDto.triad1.keyword,
				cues: this.extractCues(createDto.triad1.fullPhrases, createDto.triad1.keyword),
				fullPhrases: createDto.triad1.fullPhrases,
			},
		})

		const triad2 = await this.prismaService.triad.create({
			data: {
				keyword: createDto.triad2.keyword,
				cues: this.extractCues(createDto.triad2.fullPhrases, createDto.triad2.keyword),
				fullPhrases: createDto.triad2.fullPhrases,
			},
		})

		const triad3 = await this.prismaService.triad.create({
			data: {
				keyword: createDto.triad3.keyword,
				cues: this.extractCues(createDto.triad3.fullPhrases, createDto.triad3.keyword),
				fullPhrases: createDto.triad3.fullPhrases,
			},
		})

		const triad4 = await this.prismaService.triad.create({
			data: {
				keyword: createDto.triad4.keyword,
				cues: triad4Receipt.matches.map((match) => match.keyword),
				fullPhrases: createDto.triad4.fullPhrases,
			},
		})

		// Create the triad group
		const triadGroup = await this.prismaService.triadGroup.create({
			data: {
				triad1Id: triad1.id,
				triad2Id: triad2.id,
				triad3Id: triad3.id,
				triad4Id: triad4.id,
				active: true,
				difficulty: createDto.difficulty,
			},
			select: {
				id: true,
				active: true,
				difficulty: true,
				Triad1: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
				Triad2: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
				Triad3: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
				Triad4: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
			},
		})

		// Transform the response
		return {
			id: triadGroup.id,
			active: triadGroup.active,
			difficulty: triadGroup.difficulty,
			triad1: triadGroup.Triad1,
			triad2: triadGroup.Triad2,
			triad3: triadGroup.Triad3,
			triad4: triadGroup.Triad4,
		}
	}

	async updateTriadGroup(updateDto: UpdateTriadGroupDto) {
		// Validate each triad
		this.validateKeywordSubstring(updateDto.triad1)
		this.validateKeywordSubstring(updateDto.triad2)
		this.validateKeywordSubstring(updateDto.triad3)
		this.validateKeywordSubstring(updateDto.triad4)

		// Validate fourth triad cues and retain the proof for the stored final cues.
		const triad4Receipt = this.validateFourthTriadCues(updateDto.triad1, updateDto.triad2, updateDto.triad3, updateDto.triad4)

		// Find the triad group
		const triadGroup = await this.prismaService.triadGroup.findUnique({
			where: { id: updateDto.id },
			select: {
				triad1Id: true,
				triad2Id: true,
				triad3Id: true,
				triad4Id: true,
			},
		})

		if (!triadGroup) {
			throw new NotFoundException(`Triad group with ID ${updateDto.id} not found`)
		}

		// Update all 4 triads
		await this.prismaService.triad.update({
			where: { id: triadGroup.triad1Id },
			data: {
				keyword: updateDto.triad1.keyword,
				cues: this.extractCues(updateDto.triad1.fullPhrases, updateDto.triad1.keyword),
				fullPhrases: updateDto.triad1.fullPhrases,
			},
		})

		await this.prismaService.triad.update({
			where: { id: triadGroup.triad2Id },
			data: {
				keyword: updateDto.triad2.keyword,
				cues: this.extractCues(updateDto.triad2.fullPhrases, updateDto.triad2.keyword),
				fullPhrases: updateDto.triad2.fullPhrases,
			},
		})

		await this.prismaService.triad.update({
			where: { id: triadGroup.triad3Id },
			data: {
				keyword: updateDto.triad3.keyword,
				cues: this.extractCues(updateDto.triad3.fullPhrases, updateDto.triad3.keyword),
				fullPhrases: updateDto.triad3.fullPhrases,
			},
		})

		await this.prismaService.triad.update({
			where: { id: triadGroup.triad4Id },
			data: {
				keyword: updateDto.triad4.keyword,
				cues: triad4Receipt.matches.map((match) => match.keyword),
				fullPhrases: updateDto.triad4.fullPhrases,
			},
		})

		// Update the triad group difficulty
		await this.prismaService.triadGroup.update({
			where: { id: updateDto.id },
			data: {
				difficulty: updateDto.difficulty,
			},
		})

		// Fetch and return the updated triad group
		const updated = await this.prismaService.triadGroup.findUnique({
			where: { id: updateDto.id },
			select: {
				id: true,
				active: true,
				difficulty: true,
				Triad1: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
				Triad2: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
				Triad3: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
				Triad4: {
					select: {
						id: true,
						keyword: true,
						cues: true,
						fullPhrases: true,
					},
				},
			},
		})

		// Transform the response
		return {
			id: updated.id,
			active: updated.active,
			difficulty: updated.difficulty,
			triad1: updated.Triad1,
			triad2: updated.Triad2,
			triad3: updated.Triad3,
			triad4: updated.Triad4,
		}
	}

	// Validation helper: Check if keyword is substring of each fullPhrase (case-insensitive)
	private validateKeywordSubstring(triad: TriadInputDto): void {
		if (!triad.fullPhrases || triad.fullPhrases.length === 0) {
			throw new BadRequestException('Triad must have fullPhrases')
		}
		if (!triad.keyword) {
			throw new BadRequestException('Triad must have a keyword')
		}

		// Convert to uppercase for case-insensitive comparison
		const keywordUpper = triad.keyword.toUpperCase()
		const invalidPhrases = triad.fullPhrases.filter((phrase) => !phrase.toUpperCase().includes(keywordUpper))
		if (invalidPhrases.length > 0) {
			throw new BadRequestException(
				`Keyword "${triad.keyword}" must be a substring of each fullPhrase. Invalid fullPhrases: ${invalidPhrases.join(', ')}`,
			)
		}
	}

	// Validation helper: prove each final phrase resolves to one distinct earlier keyword.
	private validateFourthTriadCues(triad1: TriadInputDto, triad2: TriadInputDto, triad3: TriadInputDto, triad4: TriadInputDto) {
		const receipt = buildFourthTriadReceipt([triad1.keyword, triad2.keyword, triad3.keyword], triad4)
		if (!receipt.valid) {
			throw new BadRequestException(`Triad 4 receipt failed: ${formatFourthTriadReceipt(receipt)}`)
		}

		return receipt
	}

	// Helper function to extract cues from fullPhrases by removing the keyword (case-insensitive)
	// Example: keyword="STOCK", fullPhrases=["OVERSTOCK","STOCK EXCHANGE","WOODSTOCK"]
	// Result: cues=["OVER","EXCHANGE","WOOD"]
	private extractCues(fullPhrases: string[], keyword: string): string[] {
		return extractCuesFromPhrases(fullPhrases, keyword)
	}

	private getDisplayedCues(storedCues: string[], keyword?: string, fullPhrases?: string[]): string[] {
		return keyword && fullPhrases?.length ? extractCuesFromPhrases(fullPhrases, keyword) : storedCues
	}

	private normalizeCueForMatch(cue: string): string {
		return cue.replace(/^[\s_-]+|[\s_-]+$/g, '').toUpperCase()
	}
}
