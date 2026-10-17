import { Body, Controller, Delete, Get, Headers, Param, ParseIntPipe, Patch, Post, Put, Query } from '@nestjs/common'

import { CheckAnswerDto } from './dto/check-answer.dto'
import { CheckSolutionDto } from './dto/check-solution.dto'
import { CreateTriadGroupDto } from './dto/create-triad-group.dto'
import { GetCuesDto } from './dto/get-cues.dto'
import { GetFourthTriadDto } from './dto/get-fourth-triad.dto'
import { GetHintDto } from './dto/get-hint.dto'
import { GetTriadGroupsDto } from './dto/get-triad-groups.dto'
import { UpdateTriadGroupDto } from './dto/update-triad-group.dto'
import { UpdateTriadGroupActiveDto } from './dto/update-triad-group-active.dto'
import { TriadsService } from './triads.service'

@Controller('triads')
export class TriadsController {
	constructor(private readonly triadsService: TriadsService) {}

	@Get('cues')
	getCues(@Query() getCuesDto: GetCuesDto, @Headers('x-anonymous-id') anonymousId: string | undefined) {
		return this.triadsService.getCues(getCuesDto, anonymousId)
	}

	@Get('standalone-classic/cues')
	getStandaloneClassicCues(@Query() getCuesDto: GetCuesDto) {
		return this.triadsService.getStandaloneClassicCues(getCuesDto)
	}

	@Get('hint')
	getHint(@Query() getHintDto: GetHintDto) {
		return this.triadsService.getHint(getHintDto)
	}

	@Get('check-triad')
	async checkSolution(@Query() checkSolutionDto: CheckSolutionDto) {
		const matchedTriad = await this.triadsService.getMatchedTriad(checkSolutionDto.cues, checkSolutionDto)

		return Boolean(matchedTriad)
	}

	@Get('check-answer')
	async checkAnswer(@Query() checkAnswerDto: CheckAnswerDto) {
		const matchedTriad = await this.triadsService.getMatchedTriad(checkAnswerDto.cues, checkAnswerDto, checkAnswerDto.answer)

		return this.triadsService.checkAnswer(checkAnswerDto.answer, matchedTriad, checkAnswerDto.cues)
	}

	@Get('fourth-triad-cues')
	getFourthTriadCues(@Query() getFourthTriadDto: GetFourthTriadDto) {
		return this.triadsService.getFourthTriadCues(getFourthTriadDto)
	}

	@Get('fourth-triad-solution')
	getFourthTriadSolution(@Query() getFourthTriadDto: GetFourthTriadDto) {
		return this.triadsService.getFourthTriadSolution(getFourthTriadDto)
	}

	@Get('groups/stats')
	async getTriadGroupStats() {
		return this.triadsService.getTriadGroupStats()
	}

	@Get('groups/:id/triads')
	async getTriadsByGroupId(@Param('id', ParseIntPipe) id: number) {
		return this.triadsService.getTriadsByGroupId(id)
	}

	@Get('groups')
	async getTriadGroups(@Query() getTriadGroupsDto: GetTriadGroupsDto) {
		const offset = getTriadGroupsDto.offset ?? 0
		const limit = getTriadGroupsDto.limit ?? 20
		const search = getTriadGroupsDto.search
		return this.triadsService.getTriadGroups(offset, limit, search, getTriadGroupsDto.difficulty)
	}

	@Delete('groups/:id')
	async deleteTriadGroup(@Param('id', ParseIntPipe) id: number) {
		return this.triadsService.deleteTriadGroup(id)
	}

	@Patch('groups/:id/status')
	async updateTriadGroupActive(@Param('id', ParseIntPipe) id: number, @Body() updateDto: Omit<UpdateTriadGroupActiveDto, 'id'>) {
		return this.triadsService.updateTriadGroupActive(id, updateDto.active)
	}

	@Post('groups')
	async createTriadGroup(@Body() createDto: CreateTriadGroupDto) {
		return this.triadsService.createTriadGroup(createDto)
	}

	@Put('groups/:id')
	async updateTriadGroup(@Param('id', ParseIntPipe) id: number, @Body() updateDto: Omit<UpdateTriadGroupDto, 'id'>) {
		return this.triadsService.updateTriadGroup({ ...updateDto, id })
	}
}
