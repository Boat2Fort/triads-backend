import 'reflect-metadata'

import { plainToInstance } from 'class-transformer'
import { validate } from 'class-validator'

import { GetPublicTriadGroupsDto } from './get-public-triad-groups.dto'

describe('GetPublicTriadGroupsDto', () => {
	it('accepts a 50-group page request', async () => {
		const dto = plainToInstance(GetPublicTriadGroupsDto, { offset: '0', limit: '50' })

		expect(await validate(dto)).toHaveLength(0)
		expect(dto).toEqual({ offset: 0, limit: 50 })
	})

	it.each([{ offset: '-1' }, { limit: '0' }, { limit: '51' }])('rejects an invalid query', async (query) => {
		const dto = plainToInstance(GetPublicTriadGroupsDto, query)

		expect(await validate(dto)).not.toHaveLength(0)
	})
})
