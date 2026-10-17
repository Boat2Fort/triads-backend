import { Body, Controller, Delete, Get, Headers, Param, ParseIntPipe, Post, Put, Query } from '@nestjs/common'

import { CreateDailyScheduleDto } from './dto/create-daily-schedule.dto'
import { DailyCompleteDto } from './dto/daily-complete.dto'
import { DailyProgressDto } from './dto/daily-progress.dto'
import { GetDailySchedulesDto } from './dto/get-daily-schedules.dto'
import { TriadsDailyService } from './triads-daily.service'

@Controller('triads/daily')
export class TriadsDailyController {
	constructor(private readonly triadsDailyService: TriadsDailyService) {}

	@Get('today')
	getTodayPublicInfo(@Headers('x-anonymous-id') anonymousId: string | undefined) {
		return this.triadsDailyService.getTodayPublicInfo(anonymousId)
	}

	@Get('cues')
	getDailyCues(@Headers('x-anonymous-id') anonymousId: string | undefined) {
		return this.triadsDailyService.getDailyCues(anonymousId ?? '')
	}

	@Post('complete')
	completeDaily(@Headers('x-anonymous-id') anonymousId: string | undefined, @Body() body: DailyCompleteDto) {
		return this.triadsDailyService.completeDaily(anonymousId ?? '', body.outcome, body.score, body.puzzleDate)
	}

	@Put('progress')
	saveDailyProgress(@Headers('x-anonymous-id') anonymousId: string | undefined, @Body() body: DailyProgressDto) {
		return this.triadsDailyService.saveDailyProgress(anonymousId ?? '', body.progress)
	}

	@Get('schedule')
	listSchedules(@Query() query: GetDailySchedulesDto) {
		const offset = query.offset ?? 0
		const limit = query.limit ?? 50
		return this.triadsDailyService.listSchedules(offset, limit)
	}

	@Post('schedule')
	createSchedule(@Body() body: CreateDailyScheduleDto) {
		return this.triadsDailyService.createSchedule(body.puzzleDate, body.triadGroupId)
	}

	@Delete('schedule/:id')
	deleteSchedule(@Param('id', ParseIntPipe) id: number) {
		return this.triadsDailyService.deleteSchedule(id)
	}
}
