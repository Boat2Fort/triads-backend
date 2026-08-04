import { Controller, Get, Header, Query } from '@nestjs/common'

import { GetPublicTriadGroupsDto } from './dto/get-public-triad-groups.dto'
import { TriadsService } from './triads.service'

@Controller('public/triad-groups')
export class PublicTriadGroupsController {
	constructor(private readonly triadsService: TriadsService) {}

	@Get()
	@Header('Access-Control-Allow-Origin', '*')
	@Header('Cross-Origin-Resource-Policy', 'cross-origin')
	getPublicTriadGroups(@Query() query: GetPublicTriadGroupsDto) {
		if (query.offset !== undefined || query.limit !== undefined) {
			return this.triadsService.getPublicTriadGroupsPage(query.offset ?? 0, query.limit ?? 50)
		}

		return this.triadsService.getPublicTriadGroups()
	}
}
